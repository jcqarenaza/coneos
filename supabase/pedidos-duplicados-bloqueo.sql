-- ══════════════════════════════════════════════════════════════════════
-- BLOQUEO DE PEDIDOS DUPLICADOS EN PEDIDOS ONLINE (delivery + take away) — opción C del CTO (13/11/2026)
-- NO APLICAR en la base compartida sin GO productivo del CTO. Para correr a mano en el SQL Editor de Supabase.
-- ORDEN: va DESPUÉS de pedidos-repetidos.sql y de crear-pedido-stock-v1.7-operacion.sql (los usa; no los modifica).
--
-- QUÉ HACE
--  1. Dos columnas nuevas en empresa_config (la llave, APAGADA por defecto):
--       bloquear_pedidos_duplicados   boolean not null default false   → LLAVE por empresa. Apagada = comportamiento anterior exacto.
--       pedido_activo_ventana_horas   integer not null default 3       → cuánto hacia atrás se busca un "pedido activo" del mismo teléfono
--                                                                        (CHECK 1..24). Sin este tope, los pedidos viejos que quedaron en
--                                                                        PENDING_PAYMENT/READY en la base (hoy: 51 y 24 con más de 12 h) dejarían
--                                                                        al teléfono "con pedido activo" para siempre.
--  2. normalizar_telefono_pedido(text): teléfono normalizado (solo dígitos; sin 00/0 inicial; sin 54; sin el 9 de celular;
--     últimos 10 dígitos). Mínimo 6 dígitos o devuelve NULL.
--  3. reclamar_operacion_pedido() con DOS parámetros nuevos (con default → los llamadores actuales siguen funcionando):
--       p_alcance_bloqueo boolean default false  → el servidor lo manda true SOLO para delivery y take away online.
--       p_confirmar_otro  boolean default false  → la excepción explícita "Es otro pedido, continuar" (solo nivel 2).
--     El MODO BLOQUEO se activa solo si: alcance = true  Y  llave de la empresa = true  Y  prevenir_pedidos_repetidos = true.
--     Fuera de ese modo la función se comporta EXACTAMENTE como antes (kiosco, caja, mesas, y toda empresa con la llave apagada).
--       AVISO (CTO 14/11, D1 — reemplaza al bloqueo duro del 13/11): mismo TELÉFONO NORMALIZADO (ventana pedido_activo_ventana_horas) o, sin
--                 teléfono, misma identidad existente + misma huella (ventana pedidos_repetidos_minutos), con un pedido ACTIVO →
--                 'PEDIDO_ACTIVO' con 'coincidencia' = IDENTICA | DISTINTA. Ya no hay bloqueo duro: el cliente puede continuar con la excepción
--                 explícita (p_confirmar_otro) sobre la MISMA operación que el servidor ya advirtió (estado ADVERTIDA).
--                 Al continuar se registra la relación en pedido_revisiones_duplicado (PENDIENTE) y la COMPUERTA del servidor impide
--                 que ese pedido se cobre, se prepare o se facture hasta que Luci lo resuelva en Vista Caja (LEGITIMO / DUPLICADO).
--                 Esto SOLO es seguro con la compuerta desplegada (api/pedidos/estado, api/mp/webhook, asignar_cadete): activar la llave
--                 DESPUÉS de desplegar el código.
--  4. ATOMICIDAD: en modo bloqueo con teléfono, la función toma un advisory lock por (empresa, sucursal, teléfono normalizado)
--     ANTES del lock por contenido ya existente (orden fijo: teléfono → huella; ninguna otra función los toma al revés).
--     Dos solicitudes simultáneas del mismo teléfono —con igual o distinto contenido— pasan de a una: la segunda ve la operación
--     EN_CURSO de la primera (ya commiteada al volver la RPC) y recibe PEDIDO_ACTIVO.
--  5. PRIVACIDAD (corrección CTO 14/11): la coincidencia de TELÉFONO detecta el pedido activo pero NO autoriza a verlo.
--     'existente' devuelve pedido_id / numero_pedido / estado SOLO si el pedido encontrado es del MISMO VISITANTE (el mismo navegador
--     que lo creó; id_visitante idéntico). Si coincide solo el teléfono —otro visitante, otro navegador, un familiar o alguien que
--     escribió un número ajeno— devuelve únicamente {"mismo_visitante": false}: el servidor no tiene qué entregar y no hay UUID que se filtre.
--     La detección, los bloqueos y la excepción «Es otro pedido, continuar» NO dependen de esto. Si hay varios pedidos activos,
--     se prefiere el del mismo visitante. El id_dispositivo no se usa para esto: en delivery es un único dispositivo compartido por todos.
--
-- "PEDIDO ACTIVO" (decisión CTO 13/11 + revisión de la base real)
--   · Estado del PEDIDO (no de pedido_operaciones): PENDING_PAYMENT, PAID, PREPARING, READY.
--     PAID (pagado, todavía sin preparar) EXISTE en la base real (6 pedidos) y el CTO pidió revisarlo: se INCLUYE.
--   · NO cuentan: CANCELLED (y cualquier rechazado), DELIVERED/finalizado, pedido eliminado (la fila no existe).
--   · Una operación EN_CURSO sin pedido todavía cuenta durante 90 s (es la carrera: la primera ya reclamó y está creando el pedido).
--   · En modo bloqueo el contenido idéntico también compara solo contra pedidos activos (el modo anterior contaba también DELIVERED dentro de la ventana).
--
-- QUÉ NO TOCA: crear_pedido_stock, descontar/devolver_sabores_pedido, el modelo de stock, completar_/liberar_/purgar_,
--   la tabla pedido_operaciones (salvo un índice), la lógica de idempotencia ni el comportamiento fail-closed.
-- IMPORTANTE: reemplaza la función reclamar_operacion_pedido de 8 parámetros por la de 10 (no se pueden tener ambas: la llamada
--   por nombre sería ambigua). La reversión (pedidos-duplicados-bloqueo-REVERSION.sql) restaura la de 8 parámetros EXACTA.
-- ORDEN DE DESPLIEGUE: indistinto. Código nuevo + SQL viejo: el servidor lee la llave, no la encuentra y llama con 8 parámetros.
--   SQL nuevo + código viejo: los parámetros nuevos tienen default. Para ACTIVAR: update empresa_config set bloquear_pedidos_duplicados = true.
-- ══════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

-- 0) PRECHECKS ---------------------------------------------------------------
do $pre$
declare r record; v_n integer;
begin
  if to_regclass('public.pedido_operaciones') is null then raise exception 'PRECHECK: falta pedido_operaciones (aplicar antes pedidos-repetidos.sql)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='pedidos' and column_name='operacion_id') then
    raise exception 'PRECHECK: falta pedidos.operacion_id (aplicar antes crear-pedido-stock-v1.7-operacion.sql)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='empresa_config' and column_name='pedidos_repetidos_minutos') then
    raise exception 'PRECHECK: falta empresa_config.pedidos_repetidos_minutos (aplicar antes pedidos-repetidos.sql)'; end if;
  -- columnas nuevas preexistentes: mismo tipo
  for r in select column_name, data_type from information_schema.columns
            where table_schema='public' and table_name='empresa_config' and column_name in ('bloquear_pedidos_duplicados','pedido_activo_ventana_horas') loop
    if (r.column_name='bloquear_pedidos_duplicados' and r.data_type <> 'boolean') or (r.column_name='pedido_activo_ventana_horas' and r.data_type <> 'integer') then
      raise exception 'PRECHECK: empresa_config.% ya existe con tipo % (otro del esperado)', r.column_name, r.data_type; end if;
  end loop;
  -- la función de reclamo: la vigente tiene que ser la de pedidos-repetidos.sql (8 params, con su marca) o ya la de este script (10 params, su marca)
  for r in select p.oid::regprocedure as f, obj_description(p.oid,'pg_proc') as c, p.pronargs from pg_proc p
            where p.pronamespace='public'::regnamespace and p.proname='reclamar_operacion_pedido' loop
    if not ((r.pronargs = 8 and r.c = 'coneos:pedidos-repetidos-8-11') or (r.pronargs = 10 and r.c = 'coneos:pedidos-bloqueo-13-11')) then
      raise exception 'PRECHECK: reclamar_operacion_pedido existente % no es la de pedidos-repetidos.sql ni la de este script; no se pisa', r.f; end if;
  end loop;
  if not exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='reclamar_operacion_pedido') then
    raise exception 'PRECHECK: no existe reclamar_operacion_pedido (aplicar antes pedidos-repetidos.sql)'; end if;
  -- tabla y funciones de revisión (CTO 14/11): si existen, tienen que ser de este script
  if to_regclass('public.pedido_revisiones_duplicado') is not null
     and coalesce(obj_description(to_regclass('public.pedido_revisiones_duplicado'), 'pg_class'), '') <> 'coneos:pedidos-bloqueo-13-11' then
    raise exception 'PRECHECK: ya existe public.pedido_revisiones_duplicado y NO es de este script; no se pisa'; end if;
  for r in select p.oid::regprocedure as f, obj_description(p.oid,'pg_proc') as c from pg_proc p
            where p.pronamespace='public'::regnamespace and p.proname in ('resolver_revision_duplicado','pedidos_en_revision') loop
    if coalesce(r.c,'') <> 'coneos:pedidos-bloqueo-13-11' then raise exception 'PRECHECK: ya existe % y NO es de este script; no se pisa', r.f; end if;
  end loop;
  -- función auxiliar homónima: solo si es nuestra
  for r in select p.oid::regprocedure as f, obj_description(p.oid,'pg_proc') as c from pg_proc p
            where p.pronamespace='public'::regnamespace and p.proname='normalizar_telefono_pedido' loop
    if coalesce(r.c,'') <> 'coneos:pedidos-bloqueo-13-11' then raise exception 'PRECHECK: ya existe % y NO es de este script; no se pisa', r.f; end if;
  end loop;
  -- índice homónimo de otra tabla
  if exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='idx_pedido_operaciones_tel_reciente'
              and c.relnamespace='public'::regnamespace and i.indrelid <> 'public.pedido_operaciones'::regclass) then
    raise exception 'PRECHECK: idx_pedido_operaciones_tel_reciente existe en otra tabla'; end if;
end $pre$;

-- 1) Configuración por empresa (la llave nace APAGADA) ----------------------------
do $cfg$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='empresa_config' and column_name='bloquear_pedidos_duplicados') then
    alter table public.empresa_config add column bloquear_pedidos_duplicados boolean not null default false;
    comment on column public.empresa_config.bloquear_pedidos_duplicados is 'coneos:pedidos-bloqueo-13-11';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='empresa_config' and column_name='pedido_activo_ventana_horas') then
    alter table public.empresa_config add column pedido_activo_ventana_horas integer not null default 3;
    comment on column public.empresa_config.pedido_activo_ventana_horas is 'coneos:pedidos-bloqueo-13-11';
  end if;
  if not exists (select 1 from pg_constraint where conname='empresa_config_pedido_activo_horas_rango' and conrelid='public.empresa_config'::regclass) then
    alter table public.empresa_config add constraint empresa_config_pedido_activo_horas_rango check (pedido_activo_ventana_horas between 1 and 24) not valid;
    comment on constraint empresa_config_pedido_activo_horas_rango on public.empresa_config is 'coneos:pedidos-bloqueo-13-11';
  end if;
end $cfg$;
alter table public.empresa_config validate constraint empresa_config_pedido_activo_horas_rango;

-- 2) Normalización de teléfono ---------------------------------------------------
-- Ej.: '+54 9 2302 51-4650' → '2302514650'; '02302514650' → '2302514650'; '2302514650' → '2302514650'.
-- No resuelve el "15" intercalado (el largo del código de área varía): documentado como límite.
create or replace function public.normalizar_telefono_pedido(p_tel text)
 returns text language sql immutable parallel safe set search_path to pg_catalog, pg_temp
as $$
  select case when length(d) < 6 then null else right(d, 10) end
    from (
      select case
               when x like '54%' then (case when substr(x, 3) like '9%' and length(substr(x, 3)) > 10 then substr(x, 4) else substr(x, 3) end)
               else x
             end as d
        from (select regexp_replace(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), '^0+', '') as x) a
    ) b
$$;
comment on function public.normalizar_telefono_pedido(text) is 'coneos:pedidos-bloqueo-13-11';

-- 3) Índice para la búsqueda por sucursal + tiempo (la tabla es de una fila por pedido) ----------
do $idx$ begin
  if to_regclass('public.idx_pedido_operaciones_tel_reciente') is null then
    create index idx_pedido_operaciones_tel_reciente on public.pedido_operaciones (empresa_id, sucursal_id, created_at desc) where id_telefono is not null;
    comment on index public.idx_pedido_operaciones_tel_reciente is 'coneos:pedidos-bloqueo-13-11';
  end if;
end $idx$;

-- 3b) REVISIÓN DE POSIBLE DUPLICADO (CTO 14/11) ------------------------------------------------
-- Una fila por operación que el cliente confirmó con «Es otro pedido, continuar» teniendo un pedido activo del mismo teléfono.
-- Se relaciona con el pedido nuevo por pedidos.operacion_id (la fila nace ANTES que el pedido, en el mismo reclamo atómico) y con los
-- candidatos por pedido_operaciones.operacion_id. NO vive en pedido_operaciones porque purgar_operaciones_pedido borra a los 30 días.
-- Solo service_role: ni el navegador ni el cliente leen esta tabla (RLS activada y sin políticas).
create table if not exists public.pedido_revisiones_duplicado (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  sucursal_id uuid not null references public.sucursales(id),
  operacion_id uuid not null,
  candidatos uuid[] not null default '{}',                       -- operacion_id de los pedidos activos detectados (el primero es el mejor candidato)
  coincidencia text not null check (coincidencia in ('IDENTICA','DISTINTA')),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE','LEGITIMO','DUPLICADO')),
  creado_at timestamptz not null default now(),
  resuelto_at timestamptz, resuelto_por uuid, nota text,
  stock_devuelto_at timestamptz,                                 -- DUPLICADO: cuándo se devolvió stock+sabores (null = pendiente / no aplica)
  reanudado_at timestamptz,                                      -- LEGITIMO de un pedido ya pagado por MP: cuándo se reanudó el circuito
  reembolso_pendiente boolean not null default false,            -- DUPLICADO ya pagado por MP: la devolución en Mercado Pago es MANUAL
  reembolso_gestionado_at timestamptz, reembolso_gestionado_por uuid,
  constraint pedido_revisiones_duplicado_resuelto_coherente check ((estado = 'PENDIENTE') = (resuelto_at is null)),
  constraint pedido_revisiones_duplicado_op_uk unique (empresa_id, operacion_id)
);
comment on table public.pedido_revisiones_duplicado is 'coneos:pedidos-bloqueo-13-11';
create index if not exists idx_pedido_revisiones_pendientes on public.pedido_revisiones_duplicado (empresa_id, sucursal_id) where estado = 'PENDIENTE';
create index if not exists idx_pedido_revisiones_reembolso on public.pedido_revisiones_duplicado (empresa_id, sucursal_id) where reembolso_pendiente and reembolso_gestionado_at is null;
alter table public.pedido_revisiones_duplicado enable row level security;
revoke all on table public.pedido_revisiones_duplicado from public, anon, authenticated;
grant select, insert, update on table public.pedido_revisiones_duplicado to service_role;

-- ¿Qué pedidos de la lista están RETENIDOS por una revisión? (compuerta de preparación: api/pedidos/estado, api/mp/webhook, asignar_cadete)
-- PENDIENTE: Luci todavía no decidió. DUPLICADO: decidió que es un duplicado — el pedido conserva su estado pero NUNCA debe cobrarse ni prepararse
-- (por ejemplo, si el cliente igual paga por Mercado Pago después). LEGITIMO libera el pedido y no figura acá.
drop function if exists public.pedidos_en_revision(uuid, uuid[]);
create or replace function public.pedidos_en_revision(p_empresa uuid, p_pedidos uuid[])
 returns table (pedido_id uuid, revision_estado text) language sql stable security definer set search_path to pg_catalog, pg_temp
as $$
  select p.id, r.estado from public.pedidos p
    join public.pedido_revisiones_duplicado r on r.empresa_id = p.empresa_id and r.operacion_id = p.operacion_id
   where p.empresa_id = p_empresa and p.id = any (p_pedidos) and r.estado in ('PENDIENTE','DUPLICADO')
$$;
comment on function public.pedidos_en_revision(uuid, uuid[]) is 'coneos:pedidos-bloqueo-13-11';
revoke all on function public.pedidos_en_revision(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.pedidos_en_revision(uuid, uuid[]) to service_role;

-- Resolución de Luci. ATÓMICA y de una sola vez: PENDIENTE → LEGITIMO | DUPLICADO bajo FOR UPDATE; un segundo intento no repite nada.
-- NO toca el pedido, el stock, los pagos ni las facturas: eso lo hace el servidor DESPUÉS, con las funciones existentes (ver api/operacion/consulta).
create or replace function public.resolver_revision_duplicado(p_empresa uuid, p_pedido uuid, p_resolucion text, p_operador uuid default null, p_nota text default null)
 returns jsonb language plpgsql security definer set search_path to pg_catalog, pg_temp
as $$
declare v_r public.pedido_revisiones_duplicado%rowtype; v_ped record; v_reemb boolean;
begin
  if p_resolucion is null or p_resolucion not in ('LEGITIMO','DUPLICADO') then raise exception 'RESOLUCION_INVALIDA' using errcode = 'P0001'; end if;
  select p.id, p.estado, p.metodo_pago, p.mp_payment_id, p.operacion_id into v_ped from public.pedidos p where p.id = p_pedido and p.empresa_id = p_empresa;
  if v_ped.id is null then return jsonb_build_object('estado', 'PEDIDO_NO_ENCONTRADO'); end if;
  select * into v_r from public.pedido_revisiones_duplicado r where r.empresa_id = p_empresa and r.operacion_id = v_ped.operacion_id for update;
  if v_r.id is null then return jsonb_build_object('estado', 'SIN_REVISION'); end if;
  if v_r.estado <> 'PENDIENTE' then       -- ya resuelta: idempotente, NO se repite nada
    return jsonb_build_object('estado', case when v_r.estado = p_resolucion then 'YA_RESUELTA' else 'YA_RESUELTA_DISTINTA' end, 'resolucion', v_r.estado,
      'stock_devuelto_at', v_r.stock_devuelto_at, 'reanudado_at', v_r.reanudado_at, 'reembolso_pendiente', v_r.reembolso_pendiente, 'revision_id', v_r.id);
  end if;
  -- 'pagado' nace TRUE en no-mesa aunque MP no haya cobrado: el pago REAL es mp_payment_id (lo graba el webhook al confirmar)
  v_reemb := p_resolucion = 'DUPLICADO' and v_ped.metodo_pago = 'mp' and nullif(btrim(coalesce(v_ped.mp_payment_id, '')), '') is not null;
  update public.pedido_revisiones_duplicado
     set estado = p_resolucion, resuelto_at = now(), resuelto_por = p_operador, nota = nullif(btrim(coalesce(p_nota, '')), ''), reembolso_pendiente = v_reemb
   where id = v_r.id;
  return jsonb_build_object('estado', 'RESUELTA', 'resolucion', p_resolucion, 'reembolso_pendiente', v_reemb, 'revision_id', v_r.id);
end $$;
comment on function public.resolver_revision_duplicado(uuid, uuid, text, uuid, text) is 'coneos:pedidos-bloqueo-13-11';
revoke all on function public.resolver_revision_duplicado(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolver_revision_duplicado(uuid, uuid, text, uuid, text) to service_role;

-- 4) reclamar_operacion_pedido v2 (10 parámetros) ------------------------------------
drop function if exists public.reclamar_operacion_pedido(uuid, uuid, uuid, text, text, text, uuid, boolean);

create or replace function public.reclamar_operacion_pedido(
  p_empresa_id uuid, p_sucursal_id uuid, p_operacion_id uuid, p_huella text,
  p_telefono text, p_visitante text, p_dispositivo_id uuid, p_confirmar boolean default false,
  p_alcance_bloqueo boolean default false, p_confirmar_otro boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to pg_catalog, pg_temp
as $function$
declare
  v_activo boolean := true; v_min integer := 30; v_bloq boolean := false; v_horas integer := 3; v_modo boolean := false;
  v_op record; v_dup record; v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), '');
  v_tel_n text := public.normalizar_telefono_pedido(p_telefono);
  v_vis text := nullif(p_visitante, ''); v_ped_id uuid; v_mismo boolean := false;
  v_cands uuid[] := array[]::uuid[]; v_row record; v_hay boolean := false; v_ident boolean := false;
  v_activos constant text[] := array['PENDING_PAYMENT','PAID','PREPARING','READY'];
begin
  if p_empresa_id is null or p_sucursal_id is null or p_operacion_id is null or coalesce(p_huella,'') = '' then
    raise exception 'OPERACION_DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  select coalesce(prevenir_pedidos_repetidos, true), coalesce(pedidos_repetidos_minutos, 30),
         coalesce(bloquear_pedidos_duplicados, false), coalesce(pedido_activo_ventana_horas, 3)
    into v_activo, v_min, v_bloq, v_horas from public.empresa_config where empresa_id = p_empresa_id;
  if not found then v_activo := true; v_min := 30; v_bloq := false; v_horas := 3; end if;
  -- MODO BLOQUEO: alcance pedido por el servidor (delivery/take away online) + llave de la empresa + prevención activa
  v_modo := coalesce(p_alcance_bloqueo, false) and v_bloq and v_activo;

  -- Orden de locks FIJO: (1) teléfono normalizado, (2) contenido. Dos solicitudes del mismo teléfono (aunque con contenido distinto)
  -- se serializan en (1); las de igual contenido, en (2). Ninguna función toma (2) antes que (1).
  if v_modo and v_tel_n is not null then
    perform pg_advisory_xact_lock(hashtextextended('tel:' || p_empresa_id::text || ':' || p_sucursal_id::text || ':' || v_tel_n, 0));
  end if;
  -- Serializa TODO lo que tenga el mismo contenido en la misma sucursal: dos solicitudes
  -- simultáneas (misma operación o dos operaciones iguales) pasan de a una por acá.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_sucursal_id::text || ':' || p_huella, 0));

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
    -- ADVERTIDA. FUERA del modo bloqueo: confirma como siempre. EN modo bloqueo la confirmación legacy NO vale nada:
    -- se re-evalúa abajo (el nivel 1 vuelve a bloquear; el nivel 2 solo acepta p_confirmar_otro).
    if p_confirmar and not v_modo then
      update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
      return jsonb_build_object('estado', 'NUEVA', 'confirmada', true);
    end if;
  end if;

  if v_modo then
    -- CANDIDATOS (CTO 14/11, D1). Ya NO hay bloqueo duro: contenido idéntico o distinto, el cliente recibe el MISMO aviso y puede continuar con
    -- «Es otro pedido, continuar»; la protección pasa a Vista Caja (pedido_revisiones_duplicado + compuerta de preparación en el servidor).
    -- Candidato = pedido ACTIVO de la misma persona:
    --   · por TELÉFONO normalizado dentro de pedido_activo_ventana_horas (cualquier contenido), o
    --   · por la identidad existente (visitante / dispositivo, sin teléfono) con la MISMA huella dentro de pedidos_repetidos_minutos.
    -- Orden: el del mismo visitante, luego el de contenido idéntico, luego el más reciente. Una operación EN_CURSO sin pedido todavía (carrera)
    -- también es candidata (90 s): la relación se guarda por OPERACIÓN, que existe desde el reclamo, no por pedido.
    for v_row in
      select o.operacion_id, p.id as pedido_id, p.numero_pedido, p.estado as estado_pedido, o.id_visitante as vis_existente,
             (o.huella = p_huella) as misma_huella
        from public.pedido_operaciones o
        left join public.pedidos p on p.empresa_id = o.empresa_id and p.operacion_id = o.operacion_id
       where o.empresa_id = p_empresa_id and o.sucursal_id = p_sucursal_id
         and o.operacion_id <> p_operacion_id
         and o.estado in ('EN_CURSO','COMPLETADA')
         and ((p.id is not null and p.estado = any (v_activos))
              or (p.id is null and o.estado = 'EN_CURSO' and o.updated_at >= now() - interval '90 seconds'))
         and (
              (v_tel_n is not null and o.id_telefono is not null
                 and o.created_at >= now() - make_interval(hours => v_horas)
                 and public.normalizar_telefono_pedido(o.id_telefono) = v_tel_n)
           or (o.huella = p_huella and o.created_at >= now() - make_interval(mins => v_min)
                 and case
                       when v_tel is not null and o.id_telefono is not null
                         then (o.id_telefono = v_tel or public.normalizar_telefono_pedido(o.id_telefono) = v_tel_n)
                       when v_vis is not null and o.id_visitante is not null then o.id_visitante = v_vis
                       when p_dispositivo_id is not null and o.id_dispositivo is not null
                            and v_tel is null and v_vis is null and o.id_telefono is null and o.id_visitante is null then o.id_dispositivo = p_dispositivo_id
                       else false
                     end)
             )
       order by (v_vis is not null and o.id_visitante = v_vis) desc, (o.huella = p_huella) desc, o.created_at desc
    loop
      v_cands := v_cands || v_row.operacion_id;
      if not v_hay then v_dup := v_row; v_hay := true; end if;
      if v_row.misma_huella then v_ident := true; end if;
    end loop;

    if v_hay then
      v_mismo := v_vis is not null and v_dup.vis_existente is not distinct from v_vis;
      -- Excepción explícita ("Es otro pedido, continuar"): vale SOLO si el servidor YA advirtió esta misma operación (ADVERTIDA).
      if coalesce(p_confirmar_otro, false) and v_op.estado = 'ADVERTIDA' then
        update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
        -- Relación pedido nuevo ↔ candidatos: se registra ACÁ, en la misma transacción y bajo los mismos locks (teléfono → contenido) que el reclamo,
        -- antes de que exista el pedido. El pedido se enlaza después por pedidos.operacion_id. Idempotente (reintentos de la misma operación).
        insert into public.pedido_revisiones_duplicado (empresa_id, sucursal_id, operacion_id, candidatos, coincidencia)
        values (p_empresa_id, p_sucursal_id, p_operacion_id, v_cands, case when v_ident then 'IDENTICA' else 'DISTINTA' end)
        on conflict (empresa_id, operacion_id) do nothing;
        return jsonb_build_object('estado', 'NUEVA', 'confirmada_otro', true);
      end if;
      if v_op.operacion_id is null then
        insert into public.pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
        values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'ADVERTIDA');
      end if;
      -- PRIVACIDAD (CTO 14/11): pedido_id / numero_pedido / estado SOLO si el pedido es del mismo visitante.
      return jsonb_build_object('estado', 'PEDIDO_ACTIVO', 'ventana_horas', v_horas,
        'coincidencia', case when v_ident then 'IDENTICA' else 'DISTINTA' end,
        'existente', jsonb_build_object('mismo_visitante', v_mismo) ||
          case when v_mismo then jsonb_build_object('pedido_id', v_dup.pedido_id, 'numero_pedido', v_dup.numero_pedido, 'estado', v_dup.estado_pedido)
               else '{}'::jsonb end);
    end if;
  elsif v_activo then
    -- Comportamiento ANTERIOR, sin cambios (kiosco, caja, mesas, empresas con la llave apagada)
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

revoke all on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean) to service_role;
revoke all on function public.normalizar_telefono_pedido(text) from public, anon, authenticated;
grant execute on function public.normalizar_telefono_pedido(text) to service_role;
comment on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean,boolean) is 'coneos:pedidos-bloqueo-13-11';
commit;
