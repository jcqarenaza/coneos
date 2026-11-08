-- ══════════════════════════════════════════════════════════════════════
-- PREVENCIÓN CONFIGURABLE DE PEDIDOS REPETIDOS + IDEMPOTENCIA POR OPERACIÓN
-- GO CTO 8/11/2026.   NO APLICAR en la base compartida sin GO productivo.
-- Para correr a mano en el SQL Editor de Supabase (cuando haya GO).
--
-- QUÉ HACE
--  1. Config por empresa en empresa_config: activar/desactivar y minutos
--     (entero entre 1 y 1440 = 24 h, CHECK en la base; default 30 = el comportamiento actual de Federal, decisión JC 8/11;
--     máximo 1440 por decisión CTO 8/11). Hereda RLS y permisos de la tabla.
--  2. Tabla pedido_operaciones: una fila por OPERACIÓN de compra (id generado
--     por el cliente por intento). Sirve a la vez de (a) clave de idempotencia
--     y (b) registro de "pedidos recientes" para detectar repetidos.
--  3. reclamar_operacion_pedido(): decide ATÓMICAMENTE, bajo un advisory lock
--     por empresa+sucursal+contenido, si la operación es NUEVA, un REINTENTO
--     del mismo envío, o un pedido REPETIDO que requiere advertencia.
--  4. completar_ / liberar_operacion_pedido(): registro AUXILIAR del ciclo (revisión CTO 8/11: completar_ controla ROW_COUNT; liberar_ toma el MISMO
--     advisory lock que crear_pedido_stock; reclamar_ recupera el pedido ya creado aun dentro de los 90 s). La garantía de "una operación = un pedido"
--     NO vive acá sino en pedidos.operacion_id (índice único parcial) y en crear_pedido_stock v1.7
--     (crear-pedido-stock-v1.7-operacion.sql), que es la que va DESPUÉS de este script.
--  5. purgar_operaciones_pedido(): limpieza por lotes, FUERA del camino crítico (ya no se purga al reclamar).
--  No toca Stock V1, Compras ni remitos.
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
--  · EN_CURSO dentro de los 90 s: si YA existe un pedido nacido de esa operación (crear_ lo hizo y completar_ falló), reclamar_ lo
--    recupera de inmediato (marca COMPLETADA y devuelve EXISTENTE) en lugar de hacer esperar. Una operación EN_CURSO de más de 90 s sin
--    pedido se considera abandonada (proceso caído): puede retomarse. Esa retoma YA NO puede duplicar el pedido: si el pedido de esa
--    operación se creó pero completar_ falló, crear_pedido_stock v1.7 encuentra pedidos.operacion_id y devuelve el
--    pedido existente (índice único parcial como red de seguridad). Sin v1.7 aplicado, ese riesgo EXISTE: por eso
--    los dos scripts se aplican juntos (este primero).
--  · Retención: 30 días fijos (la ventana máxima es 24 h, así que 30 días cubre cualquier configuración).
--    La limpieza la hace purgar_operaciones_pedido() por lotes con SKIP LOCKED, nunca el camino de compra.
--  · SEGURIDAD: SECURITY DEFINER con search_path = pg_catalog, pg_temp (estas funciones no disparan triggers de otras tablas) y toda referencia calificada (public.*);
--    EXECUTE revocado a public/anon/authenticated y concedido solo a service_role.
--  · PRECHECKS (revisión CTO 8/11): el script ABORTA (todo o nada) si encuentra objetos preexistentes que no coinciden con lo esperado: columnas de
--    config con otro tipo, constraint homónima con otra definición (se busca por conname Y conrelid), tabla pedido_operaciones con otras columnas/tipos/
--    PK/CHECK/FK, funciones homónimas que no son de este script. Lo que crea el script queda MARCADO con un COMMENT ('coneos:...') y la reversión SOLO
--    borra lo marcado: un objeto que ya existía antes se conserva (con un aviso).
-- REVERSIÓN: pedidos-repetidos-REVERSION.sql (DESTRUCTIVA: pierde el registro de operaciones y la configuración).
-- ══════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';


-- 0) PRECHECKS: abortan TODO (begin…commit) si hay objetos preexistentes que no coinciden --------------------
do $pre$
declare r record; v_def text;
begin
  if to_regclass('public.empresa_config') is null then raise exception 'PRECHECK: no existe public.empresa_config'; end if;
  if to_regclass('public.pedidos') is null then raise exception 'PRECHECK: no existe public.pedidos'; end if;
  -- columnas de configuración preexistentes: mismo tipo
  for r in select column_name, data_type from information_schema.columns
            where table_schema = 'public' and table_name = 'empresa_config'
              and column_name in ('prevenir_pedidos_repetidos', 'pedidos_repetidos_minutos') loop
    if (r.column_name = 'prevenir_pedidos_repetidos' and r.data_type <> 'boolean')
       or (r.column_name = 'pedidos_repetidos_minutos' and r.data_type <> 'integer') then
      raise exception 'PRECHECK: empresa_config.% ya existe con tipo % (se esperaba %)', r.column_name, r.data_type,
        case r.column_name when 'prevenir_pedidos_repetidos' then 'boolean' else 'integer' end;
    end if;
  end loop;
  -- constraint de rango: se busca por nombre Y por tabla (una homónima en otra tabla no cuenta)
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'empresa_config_pedidos_repetidos_minutos_rango' and c.conrelid = 'public.empresa_config'::regclass;
  if v_def is not null and not (v_def ilike '%pedidos_repetidos_minutos%' and v_def like '%1%' and v_def like '%1440%') then
    raise exception 'PRECHECK: empresa_config_pedidos_repetidos_minutos_rango ya existe con otra definición: %', v_def;
  end if;
  -- pedidos.operacion_id preexistente: uuid
  select data_type into v_def from information_schema.columns where table_schema = 'public' and table_name = 'pedidos' and column_name = 'operacion_id';
  if v_def is not null and v_def <> 'uuid' then raise exception 'PRECHECK: pedidos.operacion_id ya existe con tipo % (se esperaba uuid)', v_def; end if;
  -- funciones homónimas: solo se reemplazan las que lleven la marca de este script (una re-aplicación)
  for r in select p.oid::regprocedure as f, obj_description(p.oid, 'pg_proc') as c from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('reclamar_operacion_pedido', 'completar_operacion_pedido', 'liberar_operacion_pedido', 'purgar_operaciones_pedido') loop
    if coalesce(r.c, '') <> 'coneos:pedidos-repetidos-8-11' then
      raise exception 'PRECHECK: ya existe la función % y NO fue creada por este script; no se pisa', r.f;
    end if;
  end loop;
end $pre$;

-- 1) Configuración por empresa ------------------------------------------
do $cfg$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'empresa_config' and column_name = 'prevenir_pedidos_repetidos') then
    alter table public.empresa_config add column prevenir_pedidos_repetidos boolean not null default true;
    comment on column public.empresa_config.prevenir_pedidos_repetidos is 'coneos:pedidos-repetidos-8-11';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'empresa_config' and column_name = 'pedidos_repetidos_minutos') then
    alter table public.empresa_config add column pedidos_repetidos_minutos integer not null default 30;
    comment on column public.empresa_config.pedidos_repetidos_minutos is 'coneos:pedidos-repetidos-8-11';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresa_config_pedidos_repetidos_minutos_rango' and conrelid = 'public.empresa_config'::regclass) then
    alter table public.empresa_config add constraint empresa_config_pedidos_repetidos_minutos_rango
      check (pedidos_repetidos_minutos between 1 and 1440) not valid;      -- 1 min .. 24 h (decisión CTO 8/11)
    comment on constraint empresa_config_pedidos_repetidos_minutos_rango on public.empresa_config is 'coneos:pedidos-repetidos-8-11';
  end if;
end $cfg$;
alter table public.empresa_config validate constraint empresa_config_pedidos_repetidos_minutos_rango;

-- 1b) pedidos.operacion_id: la identidad de la operación vive EN el pedido. liberar_/completar_ la consultan, por eso la
--     columna nace acá (idempotente, nullable; el índice único parcial y su uso en crear_pedido_stock están en
--     crear-pedido-stock-v1.7-operacion.sql). Si ya existía, no se marca y la reversión no la borra.
do $col$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pedidos' and column_name = 'operacion_id') then
    alter table public.pedidos add column operacion_id uuid;
    comment on column public.pedidos.operacion_id is 'coneos:operacion-id-8-11';
  end if;
end $col$;

-- 2) Operaciones ----------------------------------------------------------
do $tab$ begin
  if to_regclass('public.pedido_operaciones') is null then
    create table public.pedido_operaciones (
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
    comment on table public.pedido_operaciones is 'coneos:pedidos-repetidos-8-11';
  end if;
end $tab$;

-- 2b) La tabla (nueva O preexistente) debe tener EXACTAMENTE la estructura que usan las funciones: columnas, tipos, NOT NULL, PK, CHECK de estado y FK a pedidos
do $val$
declare r record; v_pk text; v_n integer;
begin
  for r in select e.key as col, e.value->>0 as tipo, (e.value->>1)::boolean as nn
             from jsonb_each('{"empresa_id":["uuid",true],"operacion_id":["uuid",true],"sucursal_id":["uuid",true],"huella":["text",true],
               "id_telefono":["text",false],"id_visitante":["text",false],"id_dispositivo":["uuid",false],"estado":["text",true],
               "pedido_id":["uuid",false],"created_at":["timestamp with time zone",true],"updated_at":["timestamp with time zone",true]}'::jsonb) e loop
    select count(*) into v_n from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'pedido_operaciones' and c.column_name = r.col and c.data_type = r.tipo
       and (not r.nn or c.is_nullable = 'NO');
    if v_n = 0 then raise exception 'PRECHECK: pedido_operaciones.% no existe, o no es % (NOT NULL: %)', r.col, r.tipo, r.nn; end if;
  end loop;
  select count(*) into v_n from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'pedido_operaciones' and c.is_nullable = 'NO' and c.column_default is null
     and c.column_name not in ('empresa_id','operacion_id','sucursal_id','huella','estado');
  if v_n > 0 then raise exception 'PRECHECK: pedido_operaciones tiene columnas extra NOT NULL sin default (los INSERT de las funciones fallarían)'; end if;
  select string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum)) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])
   where i.indrelid = 'public.pedido_operaciones'::regclass and i.indisprimary;
  if v_pk is distinct from 'empresa_id,operacion_id' then raise exception 'PRECHECK: la PK de pedido_operaciones es (%), se esperaba (empresa_id,operacion_id)', v_pk; end if;
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.pedido_operaciones'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%EN_CURSO%' and pg_get_constraintdef(c.oid) like '%COMPLETADA%' and pg_get_constraintdef(c.oid) like '%ADVERTIDA%';
  if v_n = 0 then raise exception 'PRECHECK: pedido_operaciones no tiene el CHECK de estado (EN_CURSO, COMPLETADA, ADVERTIDA)'; end if;
  select count(*) into v_n from pg_constraint c
   where c.conrelid = 'public.pedido_operaciones'::regclass and c.contype = 'f' and c.confrelid = 'public.pedidos'::regclass and c.confdeltype = 'n'
     and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) = array['pedido_id'];
  if v_n = 0 then raise exception 'PRECHECK: pedido_operaciones.pedido_id no referencia pedidos(id) ON DELETE SET NULL'; end if;
  -- un índice homónimo de otra tabla no se pisa
  if exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
              where c.relname = 'idx_pedido_operaciones_huella' and c.relnamespace = 'public'::regnamespace
                and i.indrelid <> 'public.pedido_operaciones'::regclass) then
    raise exception 'PRECHECK: idx_pedido_operaciones_huella existe en otra tabla';
  end if;
end $val$;

do $idx$ begin
  if to_regclass('public.idx_pedido_operaciones_huella') is null then
    create index idx_pedido_operaciones_huella on public.pedido_operaciones (empresa_id, sucursal_id, huella, created_at desc);
    comment on index public.idx_pedido_operaciones_huella is 'coneos:pedidos-repetidos-8-11';
  end if;
end $idx$;
alter table public.pedido_operaciones enable row level security;     -- sin policies: solo service_role (bypass) lo usa
revoke all on public.pedido_operaciones from public, anon, authenticated;

-- 3) Reclamar ---------------------------------------------------------------
create or replace function public.reclamar_operacion_pedido(
  p_empresa_id uuid, p_sucursal_id uuid, p_operacion_id uuid, p_huella text,
  p_telefono text, p_visitante text, p_dispositivo_id uuid, p_confirmar boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to pg_catalog, pg_temp
as $function$
declare
  v_activo boolean := true; v_min integer := 30;
  v_op record; v_dup record; v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), '');
  v_vis text := nullif(p_visitante, ''); v_ped_id uuid;
begin
  if p_empresa_id is null or p_sucursal_id is null or p_operacion_id is null or coalesce(p_huella,'') = '' then
    raise exception 'OPERACION_DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  -- Serializa TODO lo que tenga el mismo contenido en la misma sucursal: dos solicitudes
  -- simultáneas (misma operación o dos operaciones iguales) pasan de a una por acá.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_sucursal_id::text || ':' || p_huella, 0));

  select coalesce(prevenir_pedidos_repetidos, true), coalesce(pedidos_repetidos_minutos, 30)
    into v_activo, v_min from public.empresa_config where empresa_id = p_empresa_id;
  if not found then v_activo := true; v_min := 30; end if;
  -- (la purga de operaciones viejas ya NO se hace acá: ver purgar_operaciones_pedido)

  -- ¿Esta operación ya existe? (reintento del mismo envío / confirmación)
  select * into v_op from public.pedido_operaciones where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
  if found then
    if v_op.huella <> p_huella or v_op.sucursal_id <> p_sucursal_id
       or v_op.id_telefono is distinct from v_tel or v_op.id_visitante is distinct from v_vis
       or v_op.id_dispositivo is distinct from p_dispositivo_id then
      return jsonb_build_object('estado', 'OPERACION_INVALIDA');   -- mismo id con otro contenido/identidad
    end if;
    if v_op.estado = 'COMPLETADA' then
      return jsonb_build_object('estado', 'EXISTENTE', 'pedido_id', v_op.pedido_id);
    elsif v_op.estado = 'EN_CURSO' then
      -- (revisión CTO 8/11) ¿El pedido de esta operación YA existe? (crear_ commiteó y completar_ falló o aún no corrió):
      -- se recupera AHORA, sin esperar los 90 s: se cierra el registro y se devuelve el pedido existente.
      select p.id into v_ped_id from public.pedidos p where p.empresa_id = p_empresa_id and p.operacion_id = p_operacion_id;
      if found then
        update public.pedido_operaciones set estado = 'COMPLETADA', pedido_id = v_ped_id, updated_at = now()
         where empresa_id = p_empresa_id and operacion_id = p_operacion_id and estado = 'EN_CURSO';
        return jsonb_build_object('estado', 'EXISTENTE', 'pedido_id', v_ped_id);
      end if;
      if v_op.updated_at < now() - interval '90 seconds' then
        update public.pedido_operaciones set updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
        return jsonb_build_object('estado', 'NUEVA');              -- abandonada: se retoma
      end if;
      return jsonb_build_object('estado', 'EN_CURSO');
    end if;
    -- ADVERTIDA: o confirma (válido solo porque el servidor ya la advirtió) o se reevalúa
    if p_confirmar then
      update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
      return jsonb_build_object('estado', 'NUEVA', 'confirmada', true);
    end if;
  end if;

  -- ¿Hay un pedido igual y reciente de la misma persona? (solo con la prevención activa)
  if v_activo then
    select o.operacion_id, o.pedido_id, p.numero_pedido, p.estado as estado_pedido, o.created_at
      into v_dup
      from public.pedido_operaciones o
      left join public.pedidos p on p.id = o.pedido_id
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
        insert into public.pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
        values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'ADVERTIDA');
      end if;
      return jsonb_build_object('estado', 'DUPLICADO', 'ventana_minutos', v_min,
        'existente', jsonb_build_object('pedido_id', v_dup.pedido_id, 'numero_pedido', v_dup.numero_pedido, 'estado', v_dup.estado_pedido));
    end if;
  end if;

  -- Operación nueva (o ADVERTIDA que ya no tiene repetido vigente)
  if v_op.operacion_id is null then
    insert into public.pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
    values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'EN_CURSO');
  else
    update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
  end if;
  return jsonb_build_object('estado', 'NUEVA');
end; $function$;

-- 4) Registro auxiliar del ciclo ------------------------------------------
-- completar_: asocia la operación con SU pedido. Verifica que el pedido exista, sea de la empresa y haya nacido
-- de esa misma operación (pedidos.operacion_id, que escribe crear_pedido_stock v1.7). Un uuid arbitrario no se asocia.
-- (revisión CTO 8/11) Controla ROW_COUNT: si no actualizó ninguna fila NO informa éxito en silencio:
--   · ya COMPLETADA con el MISMO pedido  → idempotente, éxito (un reintento o la recuperación de reclamar_ ya la cerró);
--   · cualquier otro caso (no existe, ADVERTIDA, COMPLETADA con otro pedido) → OPERACION_NO_COMPLETABLE (P0001).
create or replace function public.completar_operacion_pedido(p_empresa_id uuid, p_operacion_id uuid, p_pedido_id uuid)
 returns void language plpgsql security definer set search_path to pg_catalog, pg_temp as $$
declare v_n integer; v_op record;
begin
  if not exists (select 1 from public.pedidos
                  where id = p_pedido_id and empresa_id = p_empresa_id and operacion_id is not distinct from p_operacion_id) then
    raise exception 'PEDIDO_NO_CORRESPONDE_A_LA_OPERACION' using errcode = 'P0001';
  end if;
  update public.pedido_operaciones set estado = 'COMPLETADA', pedido_id = p_pedido_id, updated_at = now()
   where empresa_id = p_empresa_id and operacion_id = p_operacion_id and estado = 'EN_CURSO';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    select estado, pedido_id into v_op from public.pedido_operaciones where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
    if found and v_op.estado = 'COMPLETADA' and v_op.pedido_id is not distinct from p_pedido_id then return; end if;
    raise exception 'OPERACION_NO_COMPLETABLE:%', coalesce(v_op.estado, 'INEXISTENTE') using errcode = 'P0001';
  end if;
end; $$;

-- liberar_: borra la operación SOLO si todavía está EN_CURSO y NO existe ningún pedido nacido de ella.
-- (revisión CTO 8/11) Toma el MISMO advisory lock por (empresa, operación) que crear_pedido_stock v1.7: si una creación
-- está en vuelo (aún sin commit), liberar_ ESPERA a que termine y recién entonces evalúa NOT EXISTS con una instantánea nueva
-- (por eso es plpgsql: dos sentencias, lock y luego delete; en SQL puro la instantánea se tomaría ANTES del lock).
-- El endpoint la llama únicamente ante errores de una lista explícita de rechazos con rollback demostrado; jamás ante timeouts
-- o respuestas ambiguas. El NOT EXISTS es una segunda barrera.
create or replace function public.liberar_operacion_pedido(p_empresa_id uuid, p_operacion_id uuid)
 returns void language plpgsql security definer set search_path to pg_catalog, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('op:' || p_empresa_id::text || ':' || p_operacion_id::text, 0));   -- MISMA clave que crear_pedido_stock v1.7
  delete from public.pedido_operaciones o
   where o.empresa_id = p_empresa_id and o.operacion_id = p_operacion_id and o.estado = 'EN_CURSO'
     and not exists (select 1 from public.pedidos p where p.empresa_id = p_empresa_id and p.operacion_id = p_operacion_id);
end; $$;

-- purgar_: limpieza por LOTES, fuera del camino de compra. SKIP LOCKED: dos purgas simultáneas (o una purga y un
-- reclamo) nunca se esperan entre sí. Devuelve cuántas filas borró. Pensada para correr desde una tarea programada
-- (o, de forma oportunista, desde el endpoint); si no corre, la tabla solo crece (una fila por pedido).
create or replace function public.purgar_operaciones_pedido(p_limite integer default 500)
 returns integer language plpgsql security definer set search_path to pg_catalog, pg_temp as $$
declare v_n integer;
begin
  with viejas as (
    select ctid from public.pedido_operaciones
     where created_at < now() - interval '30 days'
     order by created_at
     limit greatest(1, least(coalesce(p_limite, 500), 5000))
     for update skip locked)
  delete from public.pedido_operaciones o using viejas where o.ctid = viejas.ctid;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

revoke all on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) from public, anon, authenticated;
revoke all on function public.completar_operacion_pedido(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.liberar_operacion_pedido(uuid,uuid) from public, anon, authenticated;
revoke all on function public.purgar_operaciones_pedido(integer) from public, anon, authenticated;
grant execute on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) to service_role;
grant execute on function public.completar_operacion_pedido(uuid,uuid,uuid) to service_role;
grant execute on function public.liberar_operacion_pedido(uuid,uuid) to service_role;
grant execute on function public.purgar_operaciones_pedido(integer) to service_role;

-- Marca de origen: la reversión y los prechecks reconocen estas funciones como propias
comment on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) is 'coneos:pedidos-repetidos-8-11';
comment on function public.completar_operacion_pedido(uuid,uuid,uuid) is 'coneos:pedidos-repetidos-8-11';
comment on function public.liberar_operacion_pedido(uuid,uuid) is 'coneos:pedidos-repetidos-8-11';
comment on function public.purgar_operaciones_pedido(integer) is 'coneos:pedidos-repetidos-8-11';
commit;
