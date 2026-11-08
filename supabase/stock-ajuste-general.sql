-- ============================================================
-- STOCK ETAPA 1 — AJUSTE GENERAL POR CONTEO (GO CTO 08/11)
-- Correr MANUAL en Supabase SQL Editor. Idempotente. Solo agrega.
-- NO modifica: crear_pedido_stock, ajustar_stock, devolver_stock_pedido,
-- factores de presentación, articulo_stock, ni la política de producto_stock.
--
-- Regla: el ajuste NUNCA reemplaza el stock actual por el contado.
--   diferencia = contado − base          (base = stock congelado POR EL SERVIDOR al INICIAR el conteo
--                                          en stock_conteo_base; el navegador NO envía la base;
--                                          producto sin fila al iniciar → base 0)
--   stock final = max(0, stock actual + diferencia)
-- Si el recorte a 0 ocurre se guarda la diferencia PEDIDA y la APLICADA.
-- Una sola transacción, filas bloqueadas en orden fijo (producto_id),
-- lote con clave única (no se aplica dos veces), segunda confirmación atada
-- a la huella del resumen (incluye stock ACTUAL y FINAL de cada producto: si el
-- resultado que vio el administrador cambia por cualquier motivo, se invalida).
-- Productos sin fila: la fila se crea al aplicar con INSERT … ON CONFLICT DO NOTHING
-- en orden fijo (la restricción única serializa dos altas simultáneas), y recién
-- después se bloquean todas las filas. Nunca se duplica ni se pierde una actualización.
-- Todo el movimiento de stock pasa por ajustar_stock (la única puerta).
-- Las funciones solo las ejecuta service_role (la ruta del servidor valida
-- sesión, rol y sucursal antes de llamarlas).
-- REVERSIÓN al final (comentada).
-- ============================================================
begin;
set local lock_timeout = '5s';

-- ── 0. Conteo iniciado: snapshot de la base, guardado por el SERVIDOR ──
create table if not exists public.stock_conteos (
  id              uuid primary key default gen_random_uuid(),           -- = lote_id
  empresa_id      uuid not null references public.empresas(id),
  sucursal_id     uuid not null references public.sucursales(id),
  usuario_id      uuid not null,                                        -- quien inició (auth.uid())
  usuario_nombre  text,
  iniciado_at     timestamptz not null default clock_timestamp(),
  estado          text not null default 'abierto' check (estado in ('abierto','aplicado')),
  aplicado_at     timestamptz
);
create index if not exists idx_stock_conteos_suc on public.stock_conteos (empresa_id, sucursal_id, iniciado_at desc);
create table if not exists public.stock_conteo_base (
  conteo_id    uuid not null references public.stock_conteos(id),
  producto_id  uuid not null references public.productos(id),
  base         integer not null check (base >= 0),                      -- stock de la sucursal al iniciar (sin fila → 0)
  primary key (conteo_id, producto_id)
);
alter table public.stock_conteos enable row level security;           -- sin políticas: solo service_role
alter table public.stock_conteo_base enable row level security;

-- ── 1. Lotes de ajuste ──────────────────────────────────────
create table if not exists public.stock_ajustes (
  id                uuid primary key references public.stock_conteos(id),  -- lote_id = id del conteo iniciado
  empresa_id        uuid not null references public.empresas(id),
  sucursal_id       uuid not null references public.sucursales(id),
  usuario_id        uuid not null,                                     -- auth.uid() del administrador
  usuario_nombre    text,
  motivo_tipo       text not null check (motivo_tipo in ('conteo','merma','rotura','vencimiento','otro')),
  descripcion       text,
  iniciado_at       timestamptz not null,
  aplicado_at       timestamptz not null default now(),
  huella            text not null,
  items_n           integer not null,
  total_abs         integer not null,                                  -- suma de |diferencia pedida|
  recortes_n        integer not null default 0,
  requirio_confirmacion boolean not null default false,
  constraint stock_ajustes_otro_desc_ck check (motivo_tipo <> 'otro' or length(btrim(coalesce(descripcion,''))) >= 3)
);
create index if not exists idx_stock_ajustes_suc on public.stock_ajustes (empresa_id, sucursal_id, aplicado_at desc);

create table if not exists public.stock_ajuste_items (
  id             uuid primary key default gen_random_uuid(),
  ajuste_id      uuid not null references public.stock_ajustes(id),
  producto_id    uuid not null references public.productos(id),
  base           integer not null check (base >= 0),
  contado        integer not null check (contado >= 0),
  actual_antes   integer not null check (actual_antes >= 0),
  diff_pedida    integer not null,
  diff_aplicada  integer not null,
  stock_final    integer not null check (stock_final >= 0),
  recortado      boolean not null default false,
  fila_creada    boolean not null default false,
  unique (ajuste_id, producto_id)
);

alter table public.stock_ajustes enable row level security;        -- sin políticas: solo service_role (ruta del servidor)
alter table public.stock_ajuste_items enable row level security;

-- ── 2. Quién y en qué lote, en el libro de movimientos (columnas opcionales) ──
alter table public.stock_movimientos add column if not exists ajuste_id uuid references public.stock_ajustes(id);
alter table public.stock_movimientos add column if not exists usuario_id uuid;
create index if not exists idx_stockmov_ajuste on public.stock_movimientos (ajuste_id) where ajuste_id is not null;

-- ── 3. Iniciar el conteo: el SERVIDOR congela la base ──────
create or replace function public.iniciar_conteo_stock(
  p_empresa_id uuid, p_sucursal_id uuid, p_usuario_id uuid, p_usuario_nombre text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $f$
declare v_id uuid := gen_random_uuid(); v_ini timestamptz;
begin
  if p_usuario_id is null then raise exception 'USUARIO_REQUERIDO' using errcode = 'P0001'; end if;
  if not exists (select 1 from sucursales where id = p_sucursal_id and empresa_id = p_empresa_id) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;
  insert into stock_conteos (id, empresa_id, sucursal_id, usuario_id, usuario_nombre)
    values (v_id, p_empresa_id, p_sucursal_id, p_usuario_id, p_usuario_nombre)
    returning iniciado_at into v_ini;
  -- UNA sola sentencia = un snapshot consistente de todos los productos con control de stock
  insert into stock_conteo_base (conteo_id, producto_id, base)
    select v_id, p.id, coalesce(ps.cantidad, 0)
      from productos p
      left join producto_stock ps on ps.producto_id = p.id and ps.sucursal_id = p_sucursal_id
     where p.empresa_id = p_empresa_id and p.controla_stock is true and p.activo is true and p.deleted_at is null;
  return jsonb_build_object('lote_id', v_id, 'iniciado_at', v_ini,
    'items', coalesce((select jsonb_agg(jsonb_build_object('producto_id', b.producto_id, 'nombre', p.nombre, 'base', b.base,
                         'sin_alta', not exists (select 1 from producto_stock ps where ps.producto_id = b.producto_id and ps.sucursal_id = p_sucursal_id))
                       order by p.nombre, b.producto_id)
                 from stock_conteo_base b join productos p on p.id = b.producto_id where b.conteo_id = v_id), '[]'::jsonb));
end $f$;

-- ── 4. Cálculo común (solo lectura): resumen + huella ───────
-- Los items traen SOLO producto_id y contado. La base sale del snapshot del servidor.
drop function if exists public._calcular_ajuste_stock(uuid, uuid, uuid, text, text, jsonb, numeric, integer, integer, integer);
create or replace function public._calcular_ajuste_stock(
  p_empresa_id uuid, p_sucursal_id uuid, p_lote_id uuid, p_motivo_tipo text, p_descripcion text, p_items jsonb,
  p_pct numeric default 20, p_min_unid integer default 5, p_abs_item integer default 50, p_abs_lote integer default 100,
  p_nuevas uuid[] default null      -- filas creadas por ESTA transacción al aplicar (siguen siendo «alta nueva»)
) returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $f$
declare
  v_n integer; v_d integer; v_mal boolean; v_validos integer; v_en_conteo integer; v_cont record;
  v_items jsonb; v_total integer; v_recortes integer; v_imp integer; v_txt text; v_req boolean; v_motivos jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'AJUSTE_SIN_ITEMS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'AJUSTE_DEMASIADOS_ITEMS' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sucursales where id = p_sucursal_id and empresa_id = p_empresa_id) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;
  select * into v_cont from stock_conteos where id = p_lote_id;
  if not found then raise exception 'CONTEO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_cont.empresa_id <> p_empresa_id or v_cont.sucursal_id <> p_sucursal_id then
    raise exception 'LOTE_DE_OTRO_ALCANCE' using errcode = 'P0001';
  end if;

  select count(*), count(distinct producto_id),
         coalesce(bool_or(producto_id is null or contado is null or contado < 0), false)
    into v_n, v_d, v_mal
    from jsonb_to_recordset(p_items) as x(producto_id uuid, contado integer);
  if v_mal then raise exception 'AJUSTE_ITEM_INVALIDO' using errcode = 'P0001'; end if;
  if v_n <> v_d then raise exception 'AJUSTE_PRODUCTO_REPETIDO' using errcode = 'P0001'; end if;

  select count(*) into v_validos
    from jsonb_to_recordset(p_items) as x(producto_id uuid, contado integer)
    join productos p on p.id = x.producto_id and p.empresa_id = p_empresa_id
     and p.controla_stock is true and p.activo is true and p.deleted_at is null;
  if v_validos <> v_n then raise exception 'PRODUCTO_INVALIDO' using errcode = 'P0001'; end if;

  select count(*) into v_en_conteo
    from jsonb_to_recordset(p_items) as x(producto_id uuid, contado integer)
    join stock_conteo_base b on b.conteo_id = p_lote_id and b.producto_id = x.producto_id;
  if v_en_conteo <> v_n then raise exception 'PRODUCTO_FUERA_DEL_CONTEO' using errcode = 'P0001'; end if;

  with x as (
    select s.producto_id, p.nombre, b.base, s.contado,
           coalesce(ps.cantidad, 0) as actual, (ps.id is null or s.producto_id = any(coalesce(p_nuevas, '{}'::uuid[]))) as fila_nueva,
           (s.contado - b.base) as diff_pedida,
           greatest(0, coalesce(ps.cantidad, 0) + (s.contado - b.base)) as final
      from jsonb_to_recordset(p_items) as s(producto_id uuid, contado integer)
      join productos p on p.id = s.producto_id
      join stock_conteo_base b on b.conteo_id = p_lote_id and b.producto_id = s.producto_id
      left join producto_stock ps on ps.producto_id = s.producto_id and ps.sucursal_id = p_sucursal_id
  ), y as (
    select x.*, (x.final - x.actual) as diff_aplicada,
           (x.actual + x.diff_pedida < 0) as recortado,
           (abs(x.diff_pedida) >= p_abs_item
            or (x.base > 0 and abs(x.diff_pedida) >= p_min_unid and abs(x.diff_pedida) * 100 >= p_pct * x.base)
            or (x.actual + x.diff_pedida < 0)) as importante
      from x
  )
  select jsonb_agg(jsonb_build_object(
           'producto_id', producto_id, 'nombre', nombre, 'base', base, 'contado', contado, 'actual', actual,
           'fila_nueva', fila_nueva, 'diff_pedida', diff_pedida, 'diff_aplicada', diff_aplicada, 'final', final,
           'recortado', recortado, 'importante', importante) order by producto_id),
         coalesce(sum(abs(diff_pedida)), 0)::integer,
         count(*) filter (where recortado)::integer,
         count(*) filter (where importante)::integer,
         -- La huella cubre TODO lo que el administrador vio: base, contado, diferencia pedida, stock ACTUAL,
         -- stock FINAL, diferencia aplicada y recorte. Si entra una venta/compra y cambia actual o final, cambia la huella.
         string_agg(producto_id::text || ':' || base || ':' || contado || ':' || diff_pedida || ':' || actual || ':' || final || ':' ||
                    diff_aplicada || ':' || recortado::text, '|' order by producto_id)
    into v_items, v_total, v_recortes, v_imp, v_txt
    from y;

  v_req := (v_imp > 0) or (v_total >= p_abs_lote);
  if v_recortes > 0 then v_motivos := v_motivos || '"recorte_a_cero"'::jsonb; end if;
  if v_imp - v_recortes > 0 then v_motivos := v_motivos || '"diferencia_grande"'::jsonb; end if;
  if v_total >= p_abs_lote then v_motivos := v_motivos || '"lote_grande"'::jsonb; end if;

  return jsonb_build_object(
    'lote_id', p_lote_id, 'items', v_items,
    'resumen', jsonb_build_object('items_n', v_n, 'total_abs', v_total, 'recortes_n', v_recortes, 'importantes_n', v_imp,
                                  'requiere_confirmacion', v_req, 'motivos_confirmacion', v_motivos),
    'huella', encode(sha256(convert_to(
        p_lote_id::text || '#' || p_empresa_id::text || '#' || p_sucursal_id::text || '#' || p_motivo_tipo || '#' ||
        btrim(coalesce(p_descripcion, '')) || '#' || coalesce(v_txt, ''), 'UTF8')), 'hex'));
end $f$;

-- ── 5. Previsualizar (no escribe nada) ──────────────────────
create or replace function public.previsualizar_ajuste_stock(
  p_empresa_id uuid, p_sucursal_id uuid, p_lote_id uuid, p_motivo_tipo text, p_descripcion text, p_items jsonb,
  p_pct numeric default 20, p_min_unid integer default 5, p_abs_item integer default 50, p_abs_lote integer default 100
) returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $f$
begin
  if p_motivo_tipo is null or p_motivo_tipo not in ('conteo','merma','rotura','vencimiento','otro') then
    raise exception 'MOTIVO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_motivo_tipo = 'otro' and length(btrim(coalesce(p_descripcion, ''))) < 3 then
    raise exception 'MOTIVO_OTRO_SIN_DESCRIPCION' using errcode = 'P0001';
  end if;
  if exists (select 1 from stock_conteos where id = p_lote_id and estado = 'aplicado') then
    raise exception 'CONTEO_YA_APLICADO' using errcode = 'P0001';
  end if;
  return public._calcular_ajuste_stock(p_empresa_id, p_sucursal_id, p_lote_id, p_motivo_tipo, p_descripcion, p_items, p_pct, p_min_unid, p_abs_item, p_abs_lote);
end $f$;

-- ── 6. Aplicar (transaccional, idempotente, atada a la confirmación) ──
drop function if exists public.aplicar_ajuste_stock(uuid, uuid, uuid, uuid, text, text, text, timestamptz, jsonb, text, numeric, integer, integer, integer);
create or replace function public.aplicar_ajuste_stock(
  p_empresa_id uuid, p_sucursal_id uuid, p_lote_id uuid, p_usuario_id uuid, p_usuario_nombre text,
  p_motivo_tipo text, p_descripcion text, p_items jsonb,
  p_huella_confirmada text default null,
  p_pct numeric default 20, p_min_unid integer default 5, p_abs_item integer default 50, p_abs_lote integer default 100
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $f$
declare
  v_cont record; v_calc jsonb; v_it jsonb; v_ids uuid[]; v_nuevas uuid[]; v_tx timestamptz := transaction_timestamp();
  v_delta integer; v_det text; v_det_it text;
begin
  if p_usuario_id is null then raise exception 'USUARIO_REQUERIDO' using errcode = 'P0001'; end if;
  if p_lote_id is null then raise exception 'LOTE_REQUERIDO' using errcode = 'P0001'; end if;
  if p_motivo_tipo is null or p_motivo_tipo not in ('conteo','merma','rotura','vencimiento','otro') then
    raise exception 'MOTIVO_INVALIDO' using errcode = 'P0001';
  end if;
  if p_motivo_tipo = 'otro' and length(btrim(coalesce(p_descripcion, ''))) < 3 then
    raise exception 'MOTIVO_OTRO_SIN_DESCRIPCION' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'AJUSTE_SIN_ITEMS' using errcode = 'P0001'; end if;

  -- Serializa reintentos/doble toque del MISMO lote
  perform pg_advisory_xact_lock(hashtextextended('stock_ajuste:' || p_lote_id::text, 0));
  select * into v_cont from stock_conteos where id = p_lote_id for update;
  if not found then raise exception 'CONTEO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_cont.empresa_id <> p_empresa_id or v_cont.sucursal_id <> p_sucursal_id then
    raise exception 'LOTE_DE_OTRO_ALCANCE' using errcode = 'P0001';
  end if;
  if v_cont.usuario_id <> p_usuario_id then raise exception 'CONTEO_DE_OTRO_USUARIO' using errcode = 'P0001'; end if;
  if v_cont.estado = 'aplicado' then
    -- Solo existe 'aplicado' si TODA la transacción confirmó: un lote incompleto o fallido nunca llega acá (se deshace entero)
    return jsonb_build_object('estado', 'ya_aplicado', 'lote_id', p_lote_id, 'aplicado_at', v_cont.aplicado_at,
      'items', coalesce((select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'base', i.base, 'contado', i.contado,
              'actual', i.actual_antes, 'diff_pedida', i.diff_pedida, 'diff_aplicada', i.diff_aplicada, 'final', i.stock_final,
              'recortado', i.recortado, 'fila_creada', i.fila_creada) order by i.producto_id)
              from stock_ajuste_items i where i.ajuste_id = p_lote_id), '[]'::jsonb));
  end if;

  -- Validación completa ANTES de escribir nada (lanza el error correcto si algo está mal)
  perform public._calcular_ajuste_stock(p_empresa_id, p_sucursal_id, p_lote_id, p_motivo_tipo, p_descripcion, p_items, p_pct, p_min_unid, p_abs_item, p_abs_lote);

  select array_agg(producto_id order by producto_id) into v_ids from jsonb_to_recordset(p_items) as x(producto_id uuid, contado integer);

  -- Filas que todavía no existen: se CREAN (en 0) en orden fijo con ON CONFLICT DO NOTHING. La restricción única
  -- (producto_id, sucursal_id) serializa dos altas simultáneas: la segunda espera a la primera y no duplica.
  with ins as (
    insert into producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo)
      select p_empresa_id, u.id, p_sucursal_id, 0, 0 from unnest(v_ids) as u(id) order by u.id
    on conflict (producto_id, sucursal_id) do nothing
    returning producto_id)
  select coalesce(array_agg(producto_id order by producto_id), '{}'::uuid[]) into v_nuevas from ins;

  -- Bloqueo de TODAS las filas del lote (ya existen todas) en ORDEN FIJO (evita cruces entre ajustes)
  perform 1 from producto_stock where sucursal_id = p_sucursal_id and producto_id = any(v_ids) order by producto_id for update;

  v_calc := public._calcular_ajuste_stock(p_empresa_id, p_sucursal_id, p_lote_id, p_motivo_tipo, p_descripcion, p_items, p_pct, p_min_unid, p_abs_item, p_abs_lote, v_nuevas);

  if (v_calc #>> '{resumen,requiere_confirmacion}')::boolean then
    if p_huella_confirmada is null then
      raise exception 'CONFIRMACION_REQUERIDA' using errcode = 'P0001';
    end if;
    if p_huella_confirmada <> (v_calc ->> 'huella') then
      raise exception 'CONFIRMACION_INVALIDA' using errcode = 'P0001';   -- cambió algo de lo que vio el administrador (incluye stock actual y final)
    end if;
  end if;

  insert into stock_ajustes (id, empresa_id, sucursal_id, usuario_id, usuario_nombre, motivo_tipo, descripcion, iniciado_at,
                             huella, items_n, total_abs, recortes_n, requirio_confirmacion)
  values (p_lote_id, p_empresa_id, p_sucursal_id, p_usuario_id, p_usuario_nombre, p_motivo_tipo, nullif(btrim(coalesce(p_descripcion, '')), ''),
          v_cont.iniciado_at, v_calc ->> 'huella', (v_calc #>> '{resumen,items_n}')::int, (v_calc #>> '{resumen,total_abs}')::int,
          (v_calc #>> '{resumen,recortes_n}')::int, (v_calc #>> '{resumen,requiere_confirmacion}')::boolean);

  v_det := 'Ajuste general (' || p_motivo_tipo || ')' ||
           case when btrim(coalesce(p_descripcion, '')) <> '' then ': ' || btrim(p_descripcion) else '' end;

  for v_it in select * from jsonb_array_elements(v_calc -> 'items') loop
    v_delta := (v_it ->> 'diff_aplicada')::integer;
    -- ÚNICA PUERTA: ajustar_stock (modo delta). La fila ya existe y está bloqueada; con delta 0 no hay nada que mover.
    if v_delta <> 0 then
      v_det_it := v_det || case when (v_it ->> 'recortado')::boolean then ' [recortado a 0: se pidió ' || (v_it ->> 'diff_pedida') || ']' else '' end;
      perform public.ajustar_stock(p_empresa_id, p_sucursal_id, (v_it ->> 'producto_id')::uuid, v_delta, 'delta', 'ajuste', null, v_det_it);
      -- Etiqueta SU movimiento (lote + usuario). La fila de stock está bloqueada por esta transacción, así que
      -- nadie más puede haber escrito un movimiento de este producto/sucursal desde entonces; además se exige
      -- el mismo texto de detalle y created_at de esta transacción.
      update stock_movimientos set ajuste_id = p_lote_id, usuario_id = p_usuario_id
       where id = (select id from stock_movimientos
                    where empresa_id = p_empresa_id and sucursal_id = p_sucursal_id and producto_id = (v_it ->> 'producto_id')::uuid
                      and motivo = 'ajuste' and ajuste_id is null and detalle = v_det_it and created_at = v_tx
                    order by id limit 1);
    end if;
    insert into stock_ajuste_items (ajuste_id, producto_id, base, contado, actual_antes, diff_pedida, diff_aplicada, stock_final, recortado, fila_creada)
    values (p_lote_id, (v_it ->> 'producto_id')::uuid, (v_it ->> 'base')::int, (v_it ->> 'contado')::int, (v_it ->> 'actual')::int,
            (v_it ->> 'diff_pedida')::int, v_delta, (v_it ->> 'final')::int, (v_it ->> 'recortado')::boolean, (v_it ->> 'fila_nueva')::boolean);
  end loop;

  update stock_conteos set estado = 'aplicado', aplicado_at = v_tx where id = p_lote_id;
  return v_calc || jsonb_build_object('estado', 'aplicado');
end $f$;

-- ── 7. Permisos: solo service_role (la ruta del servidor valida sesión, rol y sucursal) ──
revoke all on function public.iniciar_conteo_stock(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._calcular_ajuste_stock(uuid, uuid, uuid, text, text, jsonb, numeric, integer, integer, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.previsualizar_ajuste_stock(uuid, uuid, uuid, text, text, jsonb, numeric, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.aplicar_ajuste_stock(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, numeric, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.iniciar_conteo_stock(uuid, uuid, uuid, text) to service_role;
grant execute on function public._calcular_ajuste_stock(uuid, uuid, uuid, text, text, jsonb, numeric, integer, integer, integer, uuid[]) to service_role;
grant execute on function public.previsualizar_ajuste_stock(uuid, uuid, uuid, text, text, jsonb, numeric, integer, integer, integer) to service_role;
grant execute on function public.aplicar_ajuste_stock(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, numeric, integer, integer, integer) to service_role;

commit;

-- REVERSIÓN (solo si hace falta; si ya hay lotes aplicados, conservar las tablas como auditoría):
-- drop function if exists public.aplicar_ajuste_stock(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, numeric, integer, integer, integer);
-- drop function if exists public.previsualizar_ajuste_stock(uuid, uuid, uuid, text, text, jsonb, numeric, integer, integer, integer);
-- drop function if exists public._calcular_ajuste_stock(uuid, uuid, uuid, text, text, jsonb, numeric, integer, integer, integer, uuid[]);
-- drop function if exists public.iniciar_conteo_stock(uuid, uuid, uuid, text);
-- alter table public.stock_movimientos drop column if exists ajuste_id, drop column if exists usuario_id;
-- drop table if exists public.stock_ajuste_items; drop table if exists public.stock_ajustes;
-- drop table if exists public.stock_conteo_base; drop table if exists public.stock_conteos;
