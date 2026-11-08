-- ══════════════════════════════════════════════════════════════════════
-- PREVENCIÓN CONFIGURABLE DE PEDIDOS REPETIDOS + IDEMPOTENCIA POR OPERACIÓN
-- GO CTO 8/11/2026.   NO APLICAR en la base compartida sin GO productivo.
-- Para correr a mano en el SQL Editor de Supabase (cuando haya GO).
--
-- QUÉ HACE
--  1. Config por empresa en empresa_config: activar/desactivar y minutos
--     (entero > 0, SIN máximo; default 30 = el comportamiento actual de Federal, decisión JC 8/11). Hereda RLS y permisos de la tabla.
--  2. Tabla pedido_operaciones: una fila por OPERACIÓN de compra (id generado
--     por el cliente por intento). Sirve a la vez de (a) clave de idempotencia
--     y (b) registro de "pedidos recientes" para detectar repetidos.
--  3. reclamar_operacion_pedido(): decide ATÓMICAMENTE, bajo un advisory lock
--     por empresa+sucursal+contenido, si la operación es NUEVA, un REINTENTO
--     del mismo envío, o un pedido REPETIDO que requiere advertencia.
--  4. completar_ / liberar_operacion_pedido(): cierran el ciclo.
--  No toca crear_pedido_stock (RPC aprobada), ni Stock, ni Compras, ni remitos.
--
-- ESTADOS de una operación
--   EN_CURSO   reclamada; el pedido se está creando.
--   COMPLETADA pedido creado (pedido_id).
--   ADVERTIDA  el servidor detectó un repetido y emitió la advertencia; la
--              operación NO tiene pedido. Solo con una fila ADVERTIDA de ESA
--              operación, ese contenido y esa identidad puede el cliente
--              confirmar "Sí, continuar" (un booleano suelto no autoriza nada).
--
-- DECISIONES (documentadas para el CTO)
--  · Estados que cuentan como "pedido activo": todos salvo CANCELLED. Un pedido
--    eliminado (fila borrada) tampoco cuenta (FK on delete set null).
--  · Identidad: si ambos pedidos traen teléfono → se compara SOLO el teléfono
--    (clientes con teléfonos distintos nunca se cruzan). Si no, si ambos traen
--    visitante_id → se compara visitante. Si no, si ambos traen dispositivo →
--    dispositivo (kiosco sin cliente identificado). Sin identidad común → no
--    hay advertencia.
--  · La ventana se mide desde la creación de la operación anterior.
--  · Una operación EN_CURSO de más de 90 s sin completar se considera
--    abandonada (proceso caído): puede retomarse. Riesgo residual documentado:
--    si el proceso murió DESPUÉS de crear el pedido y ANTES de completar_, el
--    retoma podría crear otro (ventana de milisegundos; el aviso de repetido
--    del propio flujo lo cubre).
--  · Retención: filas de más de max(30 días, 2×ventana) se purgan al reclamar.
-- REVERSIÓN: pedidos-repetidos-REVERSION.sql
-- ══════════════════════════════════════════════════════════════════════

-- 1) Configuración por empresa ------------------------------------------
alter table public.empresa_config add column if not exists prevenir_pedidos_repetidos boolean not null default true;
alter table public.empresa_config add column if not exists pedidos_repetidos_minutos integer not null default 30;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'empresa_config_pedidos_repetidos_minutos_pos') then
    alter table public.empresa_config add constraint empresa_config_pedidos_repetidos_minutos_pos
      check (pedidos_repetidos_minutos > 0) not valid;
  end if;
end $$;
alter table public.empresa_config validate constraint empresa_config_pedidos_repetidos_minutos_pos;

-- 2) Operaciones ----------------------------------------------------------
create table if not exists public.pedido_operaciones (
  empresa_id     uuid        not null,
  operacion_id   uuid        not null,
  sucursal_id    uuid        not null,
  huella         text        not null,           -- sha256 del contenido canónico, calculado en el servidor
  id_telefono    text,                           -- solo dígitos; null si no hay
  id_visitante   text,
  id_dispositivo uuid,
  estado         text        not null check (estado in ('EN_CURSO','COMPLETADA','ADVERTIDA')),
  pedido_id      uuid        references public.pedidos(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (empresa_id, operacion_id)
);
create index if not exists idx_pedido_operaciones_huella on public.pedido_operaciones (empresa_id, sucursal_id, huella, created_at desc);
alter table public.pedido_operaciones enable row level security;     -- sin policies: solo service_role (bypass) lo usa
revoke all on public.pedido_operaciones from public, anon, authenticated;

-- 3) Reclamar ---------------------------------------------------------------
create or replace function public.reclamar_operacion_pedido(
  p_empresa_id uuid, p_sucursal_id uuid, p_operacion_id uuid, p_huella text,
  p_telefono text, p_visitante text, p_dispositivo_id uuid, p_confirmar boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_activo boolean := true; v_min integer := 30;
  v_op record; v_dup record; v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), '');
  v_vis text := nullif(p_visitante, '');
begin
  if p_empresa_id is null or p_sucursal_id is null or p_operacion_id is null or coalesce(p_huella,'') = '' then
    raise exception 'OPERACION_DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  -- Serializa TODO lo que tenga el mismo contenido en la misma sucursal: dos solicitudes
  -- simultáneas (misma operación o dos operaciones iguales) pasan de a una por acá.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_sucursal_id::text || ':' || p_huella, 0));

  select coalesce(prevenir_pedidos_repetidos, true), coalesce(pedidos_repetidos_minutos, 30)
    into v_activo, v_min from empresa_config where empresa_id = p_empresa_id;
  if not found then v_activo := true; v_min := 30; end if;

  delete from pedido_operaciones
   where empresa_id = p_empresa_id
     and created_at < now() - greatest(interval '30 days', make_interval(mins => v_min) * 2);

  -- ¿Esta operación ya existe? (reintento del mismo envío / confirmación)
  select * into v_op from pedido_operaciones where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
  if found then
    if v_op.huella <> p_huella or v_op.sucursal_id <> p_sucursal_id
       or v_op.id_telefono is distinct from v_tel or v_op.id_visitante is distinct from v_vis
       or v_op.id_dispositivo is distinct from p_dispositivo_id then
      return jsonb_build_object('estado', 'OPERACION_INVALIDA');   -- mismo id con otro contenido/identidad
    end if;
    if v_op.estado = 'COMPLETADA' then
      return jsonb_build_object('estado', 'EXISTENTE', 'pedido_id', v_op.pedido_id);
    elsif v_op.estado = 'EN_CURSO' then
      if v_op.updated_at < now() - interval '90 seconds' then
        update pedido_operaciones set updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
        return jsonb_build_object('estado', 'NUEVA');              -- abandonada: se retoma
      end if;
      return jsonb_build_object('estado', 'EN_CURSO');
    end if;
    -- ADVERTIDA: o confirma (válido solo porque el servidor ya la advirtió) o se reevalúa
    if p_confirmar then
      update pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
      return jsonb_build_object('estado', 'NUEVA', 'confirmada', true);
    end if;
  end if;

  -- ¿Hay un pedido igual y reciente de la misma persona? (solo con la prevención activa)
  if v_activo then
    select o.operacion_id, o.pedido_id, p.numero_pedido, p.estado as estado_pedido, o.created_at
      into v_dup
      from pedido_operaciones o
      left join pedidos p on p.id = o.pedido_id
     where o.empresa_id = p_empresa_id and o.sucursal_id = p_sucursal_id and o.huella = p_huella
       and o.operacion_id <> p_operacion_id
       and o.estado in ('EN_CURSO','COMPLETADA')
       and o.created_at >= now() - make_interval(mins => v_min)
       and (o.estado = 'EN_CURSO' or (p.id is not null and p.estado is distinct from 'CANCELLED'))
       and case
             when v_tel is not null and o.id_telefono is not null then o.id_telefono = v_tel
             when v_vis is not null and o.id_visitante is not null then o.id_visitante = v_vis
             when p_dispositivo_id is not null and o.id_dispositivo is not null
                  and v_tel is null and v_vis is null and o.id_telefono is null and o.id_visitante is null then o.id_dispositivo = p_dispositivo_id
             else false
           end
     order by o.created_at desc limit 1;
    if found then
      if v_op.operacion_id is null then
        insert into pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
        values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'ADVERTIDA');
      end if;
      return jsonb_build_object('estado', 'DUPLICADO', 'ventana_minutos', v_min,
        'existente', jsonb_build_object('pedido_id', v_dup.pedido_id, 'numero_pedido', v_dup.numero_pedido, 'estado', v_dup.estado_pedido));
    end if;
  end if;

  -- Operación nueva (o ADVERTIDA que ya no tiene repetido vigente)
  if v_op.operacion_id is null then
    insert into pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
    values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'EN_CURSO');
  else
    update pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
  end if;
  return jsonb_build_object('estado', 'NUEVA');
end; $function$;

-- 4) Cerrar el ciclo -------------------------------------------------------
create or replace function public.completar_operacion_pedido(p_empresa_id uuid, p_operacion_id uuid, p_pedido_id uuid)
 returns void language sql security definer set search_path to 'public' as $$
  update pedido_operaciones set estado = 'COMPLETADA', pedido_id = p_pedido_id, updated_at = now()
   where empresa_id = p_empresa_id and operacion_id = p_operacion_id and estado = 'EN_CURSO';
$$;
-- Libera la operación si la creación falló (stock, precio, etc.): el reintento arranca limpio.
create or replace function public.liberar_operacion_pedido(p_empresa_id uuid, p_operacion_id uuid)
 returns void language sql security definer set search_path to 'public' as $$
  delete from pedido_operaciones where empresa_id = p_empresa_id and operacion_id = p_operacion_id and estado = 'EN_CURSO';
$$;

revoke all on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) from public, anon, authenticated;
revoke all on function public.completar_operacion_pedido(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.liberar_operacion_pedido(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) to service_role;
grant execute on function public.completar_operacion_pedido(uuid,uuid,uuid) to service_role;
grant execute on function public.liberar_operacion_pedido(uuid,uuid) to service_role;
