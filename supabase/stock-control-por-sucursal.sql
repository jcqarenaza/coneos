-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- CONTROL DE STOCK POR PRODUCTO Y SUCURSAL  ·  GO CTO 17/11 (modelo aprobado)  ·  rama feat/stock-habilitar-con-existencia
-- PARA CORRER MANUAL EN EL SQL EDITOR DE SUPABASE (cones-prod) SOLO CON GO ESPECÍFICO DEL CTO. UN SOLO SCRIPT, UNA SOLA TRANSACCIÓN.
--
-- MODELO:  producto_stock.controla  (NOT NULL)  →  la fila (producto, sucursal) decide si ESA sucursal controla ese producto.
--            · sin fila o controla=false  → vende libre, no descuenta       · controla=true y cantidad 0 → SIN_STOCK
--            · controla=true y cantidad>0 → vende y descuenta               · sucursal nueva sin fila     → vende libre
--          productos.controla_stock se CONSERVA como agregado («controla en al menos una sucursal»); ya NO decide la venta.
--
-- QUÉ HACE (en este orden):
--   0. Guarda: aborta si la migración ya se aplicó (no pisar configuración por sucursal).
--   0b. Conjunto EXACTO de compatibilidad aprobado (18 pares empresa/producto/sucursal: cecchetto 17, federal 1, demoburger 0): si el que
--      correspondería por regla no coincide en ambos sentidos, ABORTA antes de modificar nada.
--   1. Respaldo de conteos (tabla TEMPORAL, no deja objetos en la base).
--   2. ALTER producto_stock: columna controla boolean NOT NULL DEFAULT false (el default false = «una fila nueva no activa control»).
--   3. Marca las filas existentes según el comportamiento global anterior: controla = (productos.controla_stock) SOLO modelo 'producto'.
--   4. Filas de compatibilidad: se insertan SOLO las 18 filas de la lista aprobada (cantidad 0 / controla=true, SIN movimientos), que son las que
--      la regla «producto controlado × sucursal sin fila» da hoy en cones-prod (preserva el «agotado» de hoy). No toca cantidades.
--   5. Funciones: crear_pedido_stock (v1.8 viva → v1.9), ajustar_stock, crear_arqueo_stock, iniciar_conteo_stock,
--      _calcular_ajuste_stock, devolver_stock_pedido, y (conversión rama → producto) _restaurar_producto_stock + volver_modelo_producto. Parten de las definiciones VIVAS leídas de cones-prod el 17/11
--      (copias en supabase/versionado/*.vivo-2026-11-17.sql); cada cambio está marcado «v1.9».
--   6. Verificaciones DESPUÉS contra el respaldo: si algo no cuadra, la transacción se ABORTA y no queda nada aplicado.
--
-- NO TOCA: cantidades, movimientos, pedidos, precios, catálogo, stock por RAMA (el trigger trg_stock_ps_guard ya prohíbe filas de rama y
--          acá se excluyen), Compras (articulos.controla_stock), Recetas. Copa Sport / Prueba (5 unidades) queda tal cual (se verifica).
--
-- ORDEN DE DESPLIEGUE: (a) este SQL, (b) inmediatamente el código de la rama. Entre (a) y (b) el código viejo habilita productos solo a nivel
--   producto; para no dejar ventanas, aplicar (a) y (b) juntos y en horario de baja operación.
--
-- ANTES DE APLICAR, correr SOLO esta consulta de lectura (filas que insertaría la migración, por empresa y sucursal):
/*
select e.nombre as empresa, s.nombre as sucursal, s.id as sucursal_id, count(*) as filas_a_insertar
  from productos pr join sucursales s on s.empresa_id = pr.empresa_id join empresas e on e.id = pr.empresa_id
 where pr.controla_stock = true and pr.modelo_stock = 'producto'
   and not exists (select 1 from producto_stock ps where ps.producto_id = pr.id and ps.sucursal_id = s.id)
 group by e.nombre, s.nombre, s.id order by 1, 2, 3;
*/
--
-- REVERSIÓN (si hiciera falta): (i) volver a crear las 8 funciones desde supabase/versionado/*.vivo-2026-11-17.sql;
--   (ii) alter table public.producto_stock drop column controla;  Las filas en 0 insertadas quedan y equivalen al «sin fila = agotado»
--   de antes (solo se crearon para productos con controla_stock=true), así que no cambian el comportamiento anterior.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════

begin;
set local lock_timeout = '15s';

-- 0) GUARDA anti doble aplicación
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'producto_stock' and column_name = 'controla') then
    raise exception 'MIGRACION_YA_APLICADA: producto_stock.controla ya existe; no se vuelve a marcar (pisaría la configuración por sucursal)';
  end if;
end $$;

-- 0b) CONJUNTO EXACTO DE COMPATIBILIDAD APROBADO por el CTO (relevamiento de cones-prod): 18 filas = cecchetto 17 + federal 1 + demoburger 0.
--     La migración solo puede insertar ESTAS filas. Si falta una, sobra una o cambia un identificador (producto, sucursal o empresa), ABORTA
--     antes de modificar nada. No se amplía solo por productos o sucursales creados después del relevamiento.
--     SHARE: congela productos y sucursales (sin altas ni cambios) mientras dura la transacción, para que lo verificado sea lo que se inserta.
lock table public.productos, public.sucursales in share mode;
create temp table _ctl_aprobado (
  empresa_id uuid not null, producto_id uuid not null, sucursal_id uuid not null, primary key (producto_id, sucursal_id)
) on commit drop;
-- >>> LISTA_APROBADA
insert into _ctl_aprobado (empresa_id, producto_id, sucursal_id) values
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', '1cb2edb3-ff60-4936-b52f-aed428f0af36'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', '2b12e277-ed2f-4acb-a6c8-22a2d4ac9824'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', '34d3e753-ef8b-4519-97cd-9a633e004635'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', '445200ac-85b3-4423-b252-61a8c0134a5c'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', '6a9b48be-9991-40e2-aa18-6142602241f0'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', '76ab690b-7ae8-4b0b-bc68-de37cb9e9d8e'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', 'd9093b39-2205-4b91-962f-018a6e647ed9'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', 'e0276f5c-39e8-4e7a-9fa3-d2a04c400d68'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e', 'f1d9b8f8-695a-42a3-9a38-16597fe279c7'),  -- cecchetto · Copa Sport
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', '1cb2edb3-ff60-4936-b52f-aed428f0af36'),  -- cecchetto · Bomboncitos
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', '2b12e277-ed2f-4acb-a6c8-22a2d4ac9824'),  -- cecchetto · Bomboncitos
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', '34d3e753-ef8b-4519-97cd-9a633e004635'),  -- cecchetto · Bomboncitos
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', '445200ac-85b3-4423-b252-61a8c0134a5c'),  -- cecchetto · Bomboncitos
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', '6a9b48be-9991-40e2-aa18-6142602241f0'),  -- cecchetto · Bomboncitos
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', 'd9093b39-2205-4b91-962f-018a6e647ed9'),  -- cecchetto · Bomboncitos
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', 'e0276f5c-39e8-4e7a-9fa3-d2a04c400d68'),  -- cecchetto · Bomboncitos
  ('cdd77401-6b81-474f-b96c-8faaca1476fd', '4f89235e-52b4-41be-9ef9-7a2f9e155b3b', 'f1d9b8f8-695a-42a3-9a38-16597fe279c7'),  -- cecchetto · Bomboncitos
  ('ce000000-0000-0000-0000-000000000001', '75389763-f394-43e2-8e0d-de2fba3fa892', 'ce000000-0000-0000-0000-000000000010');  -- federal · Balde 2 litros · Cecchetto Delivery
-- <<< LISTA_APROBADA

do $$
declare v_falta text; v_sobra text; v_n integer;
begin
  create temp table _ctl_calculado on commit drop as
    select pr.empresa_id, pr.id as producto_id, s.id as sucursal_id
      from public.productos pr join public.sucursales s on s.empresa_id = pr.empresa_id
     where pr.controla_stock = true and pr.modelo_stock = 'producto'
       and not exists (select 1 from public.producto_stock ps where ps.producto_id = pr.id and ps.sucursal_id = s.id);
  select string_agg(a.empresa_id || '/' || a.producto_id || '/' || a.sucursal_id, '; ') into v_falta
    from (select * from _ctl_aprobado except select * from _ctl_calculado) a;
  select string_agg(c.empresa_id || '/' || c.producto_id || '/' || c.sucursal_id, '; ') into v_sobra
    from (select * from _ctl_calculado except select * from _ctl_aprobado) c;
  if v_falta is not null then raise exception 'COMPAT_CONJUNTO_NO_COINCIDE: faltan filas aprobadas (empresa/producto/sucursal): %', v_falta; end if;
  if v_sobra is not null then raise exception 'COMPAT_CONJUNTO_NO_COINCIDE: sobran filas no aprobadas (empresa/producto/sucursal): %', v_sobra; end if;
end $$;

-- >>> CONTEOS_APROBADOS
do $$
declare v_n integer;
begin
  select count(*) into v_n from _ctl_aprobado;
  if v_n <> 18 then raise exception 'COMPAT_CONJUNTO_NO_COINCIDE: la lista aprobada tiene % filas (esperadas 18)', v_n; end if;
  -- por empresa: cecchetto 17, federal 1, demoburger 0 (cualquier otra empresa, 0)
  if (select count(*) from _ctl_calculado where empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd') <> 17
     or (select count(*) from _ctl_calculado where empresa_id = 'ce000000-0000-0000-0000-000000000001') <> 1
     or (select count(*) from _ctl_calculado where empresa_id = '3dffcc70-eff0-4966-885b-a67a0dc1078f') <> 0
     or (select count(*) from _ctl_calculado) <> 18 then
    raise exception 'COMPAT_CONJUNTO_NO_COINCIDE: conteo por empresa distinto de cecchetto 17 / federal 1 / demoburger 0';
  end if;
end $$;
-- <<< CONTEOS_APROBADOS

-- 1) RESPALDO DE CONTEOS (temporal; desaparece al terminar la transacción)
create temp table _ctl_pre on commit drop as
select 'ps_filas'::text k, count(*)::numeric v from public.producto_stock
union all select 'ps_suma_cantidad', coalesce(sum(cantidad), 0) from public.producto_stock
union all select 'ps_filas_rama', count(*) from public.producto_stock ps join public.productos pr on pr.id = ps.producto_id where pr.modelo_stock <> 'producto'
union all select 'movimientos', count(*) from public.stock_movimientos
union all select 'prod_controla_flag', count(*) from public.productos where controla_stock = true
union all select 'prod_flag_rama', count(*) from public.productos where controla_stock = true and modelo_stock <> 'producto'
union all select 'a_insertar', count(*) from public.productos pr join public.sucursales s on s.empresa_id = pr.empresa_id
  where pr.controla_stock = true and pr.modelo_stock = 'producto'
    and not exists (select 1 from public.producto_stock ps where ps.producto_id = pr.id and ps.sucursal_id = s.id)
union all select 'ps_filas_con_flag', count(*) from public.producto_stock ps join public.productos pr on pr.id = ps.producto_id where pr.controla_stock = true and pr.modelo_stock = 'producto'
union all select 'copa_sport_prueba', coalesce(sum(cantidad), 0) from public.producto_stock where producto_id = '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e' and sucursal_id = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b';

-- 2) COLUMNA
alter table public.producto_stock add column controla boolean not null default false;

-- 3) MARCAR filas existentes según el comportamiento global anterior (solo modelo 'producto'; rama no tiene filas y el guard lo prohíbe)
update public.producto_stock ps set controla = true
  from public.productos pr
 where pr.id = ps.producto_id and pr.controla_stock = true and pr.modelo_stock = 'producto';

-- 4) FILAS DE COMPATIBILIDAD (cantidad 0, controla=true, SIN movimientos) para conservar el «sin fila = agotado» de productos ya controlados
-- Se insertan EXACTAMENTE las filas de la lista aprobada (verificada en 0b contra lo que correspondería por regla), nunca un conjunto calculado.
insert into public.producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo, controla, updated_at)
select a.empresa_id, a.producto_id, a.sucursal_id, 0, 0, true, now() from _ctl_aprobado a;

-- 5) FUNCIONES (definiciones vivas + cambios v1.9)
CREATE OR REPLACE FUNCTION public.crear_pedido_stock(p_empresa_id uuid, p_sucursal_id uuid, p_dispositivo_id uuid, p_items jsonb, p_metodo_pago text, p_origen text, p_tipo_pedido text, p_costo_envio numeric, p_datos_delivery jsonb, p_estado text, p_codigo_retiro text, p_mesa_cuenta_id uuid DEFAULT NULL::uuid, p_numero_mesa integer DEFAULT NULL::integer, p_pagado boolean DEFAULT NULL::boolean, p_nombre_cliente text DEFAULT NULL::text, p_operacion_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_fecha date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_numero integer;
  v_total numeric;
  v_pedido_id uuid;
  v_desconto boolean := false;
  v_movs jsonb := '[]'::jsonb;  -- v1.3: descuentos a loguear tras conocer el pedido_id
  r record;
  v_item jsonb;
  v_item_id uuid;
  v_op jsonb;
  -- v1.2
  v_precio_base numeric;
  v_adicionales numeric;
  v_op_precio numeric;
  v_nombre_item text;
  -- v1.5 PROMOS
  v_combo record;
  v_promo record;
  v_slots_cnt integer;
  v_adic_grupo numeric; v_cant_total integer;
  -- v1.6 STOCK V2
  v_factores jsonb;
  -- v1.7 IDEMPOTENCIA
  v_existente record;
  -- v1.8 STOCK POR RAMA
  v_lineas jsonb; v_idx integer := 0; v_hojas jsonb := '{}'::jsonb; v_opv uuid; v_hay_rama boolean := false;
begin
  -- ── v1.7 IDEMPOTENCIA POR OPERACIÓN (GO CTO 8/11) — LO PRIMERO, antes de validar nada ──
  if p_operacion_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('op:' || p_empresa_id::text || ':' || p_operacion_id::text, 0));
    select id, numero_pedido, codigo_retiro into v_existente
      from public.pedidos where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
    if found then
      return jsonb_build_object('id', v_existente.id, 'numero_pedido', v_existente.numero_pedido,
                                'codigo_retiro', v_existente.codigo_retiro, 'reutilizado', true);
    end if;
  end if;

  -- ── SERVER-AUTHORITATIVE (v1.1) ──
  perform 1 from public.sucursales
    where id = p_sucursal_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  perform 1
    from jsonb_array_elements(p_items) i
    left join public.presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
    where coalesce(i->>'presentacion_id', '') <> ''
      and (pres.id is null or pres.empresa_id <> p_empresa_id);
  if found then
    raise exception 'PRESENTACION_INVALIDA' using errcode = 'P0001';
  end if;

  -- ── v1.5: COMBOS/PROMOCIONES — validación set-based por grupo ──
  perform 1 from jsonb_array_elements(p_items) i
    where (coalesce(i->>'combo_ref','') <> '') <> (coalesce(i->>'promo_id','') <> '')
       or (coalesce(i->>'combo_ref','') <> '' and coalesce(i->>'promo_slot_id','') = '');
  if found then
    raise exception 'PROMO_COMPONENTE_INVALIDO' using errcode = 'P0001';
  end if;

  for v_combo in
    select (i->>'combo_ref')::uuid as ref, (i->>'promo_id')::uuid as pid,
           count(*) as n,
           sum((i->>'precio_snap')::numeric) as suma,
           bool_or(coalesce(i->>'presentacion_id','') = '') as sin_pres,
           bool_or(coalesce((i->>'cantidad')::int, 0) <> 1) as mala_cant,
           count(distinct i->>'promo_slot_id') as slots_distintos
      from jsonb_array_elements(p_items) i
     where coalesce(i->>'combo_ref','') <> ''
     group by 1, 2
  loop
    if v_combo.sin_pres or v_combo.mala_cant then
      raise exception 'PROMO_COMPONENTE_INVALIDO' using errcode = 'P0001';
    end if;

    select * into v_promo from public.promociones
     where id = v_combo.pid and empresa_id = p_empresa_id and activo = true;
    if v_promo.id is null then
      raise exception 'PROMO_INVALIDA' using errcode = 'P0001';
    end if;
    if (v_promo.vigencia_desde is not null and v_fecha < v_promo.vigencia_desde)
       or (v_promo.vigencia_hasta is not null and v_fecha > v_promo.vigencia_hasta) then
      raise exception 'PROMO_VENCIDA:%', v_promo.nombre using errcode = 'P0001';
    end if;

    select count(*) into v_slots_cnt from public.promo_slots where promo_id = v_combo.pid; select coalesce(sum(cantidad), 0) into v_cant_total from public.promo_slots where promo_id = v_combo.pid;
    if v_slots_cnt = 0 or (v_cant_total = v_slots_cnt and (v_combo.n <> v_slots_cnt or v_combo.slots_distintos <> v_slots_cnt)) or (v_cant_total <> v_slots_cnt and (v_combo.n <> v_cant_total or exists (select 1 from public.promo_slots s where s.promo_id = v_combo.pid and s.cantidad <> (select count(*) from jsonb_array_elements(p_items) ii where ii->>'combo_ref' = v_combo.ref::text and ii->>'promo_slot_id' = s.id::text)))) then
      raise exception 'PROMO_SLOTS_INVALIDOS:%', v_promo.nombre using errcode = 'P0001';
    end if;

    perform 1
      from jsonb_array_elements(p_items) i
      left join public.promo_slots s
        on s.id = (i->>'promo_slot_id')::uuid and s.promo_id = v_combo.pid
      left join public.promo_slot_presentaciones sp
        on sp.slot_id = s.id and sp.presentacion_id = (i->>'presentacion_id')::uuid
     where (i->>'combo_ref')::uuid = v_combo.ref
       and (s.id is null or sp.id is null);
    if found then
      raise exception 'PROMO_PRESENTACION_NO_PERMITIDA:%', v_promo.nombre using errcode = 'P0001';
    end if;

    select coalesce(sum(o.precio_adicional), 0) into v_adic_grupo
      from jsonb_array_elements(p_items) i
      cross join lateral jsonb_array_elements(coalesce(i->'opciones', '[]'::jsonb)) op
      join public.opciones o on o.id = (op->>'opcion_id')::uuid and o.empresa_id = p_empresa_id
     where (i->>'combo_ref')::uuid = v_combo.ref;
    if v_combo.suma is distinct from (v_promo.precio + v_adic_grupo) then
      raise exception 'PROMO_PRECIO_INVALIDO:%', v_promo.nombre using errcode = 'P0001';
    end if;
  end loop;

  -- ── v1.2: PRECIO + CONTEXTO DE OPCIONES + ACCESORIOS ──
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_nombre_item := coalesce(
      nullif(v_item->>'nombre_presentacion_snap', ''),
      nullif(v_item->>'nombre_producto_snap', ''), 'un producto');

    if coalesce(v_item->>'presentacion_id', '') <> '' then
      select pres.precio into v_precio_base
        from public.presentaciones pres
        where pres.id = (v_item->>'presentacion_id')::uuid;

      v_adicionales := 0;
      for v_op in select * from jsonb_array_elements(coalesce(v_item->'opciones', '[]'::jsonb))
      loop
        select o.precio_adicional into v_op_precio
          from public.opciones o
          join public.grupos_opciones g on g.id = o.grupo_id
            and g.empresa_id = p_empresa_id and g.activo = true
          join public.presentacion_grupos pg on pg.grupo_id = g.id
            and pg.presentacion_id = (v_item->>'presentacion_id')::uuid
          where o.id = (v_op->>'opcion_id')::uuid
            and o.empresa_id = p_empresa_id
            and o.activo = true
            and o.deleted_at is null;
        if not found then
          raise exception 'OPCION_INVALIDA:%',
            coalesce(nullif(v_op->>'nombre_snap',''), 'una opción')
            using errcode = 'P0001';
        end if;
        v_adicionales := v_adicionales + coalesce(v_op_precio, 0);
      end loop;

      if coalesce(v_item->>'combo_ref', '') = '' then
        if (v_item->>'precio_snap')::numeric is distinct from (coalesce(v_precio_base, 0) + v_adicionales) then
          raise exception 'PRECIO_INVALIDO:%', v_nombre_item using errcode = 'P0001';
        end if;
      end if;

    else
      perform 1
        from public.opciones o
        join public.grupos_opciones g on g.id = o.grupo_id
          and g.empresa_id = p_empresa_id
          and g.activo = true
          and g.nombre ilike '%accesorio%'
        where o.empresa_id = p_empresa_id
          and o.activo = true
          and o.deleted_at is null
          and o.precio_adicional > 0
          and (
            o.nombre = v_item->>'nombre_presentacion_snap'
            or regexp_replace(o.nombre, '^toppings?\s+', '', 'i') = v_item->>'nombre_presentacion_snap'
          )
          and o.precio_adicional = (v_item->>'precio_snap')::numeric;
      if not found then
        raise exception 'PRECIO_INVALIDO:%', v_nombre_item using errcode = 'P0001';
      end if;
    end if;

    if coalesce((v_item->>'cantidad')::int, 0) < 1 then
      raise exception 'PRECIO_INVALIDO:%', v_nombre_item using errcode = 'P0001';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext(p_sucursal_id::text || v_fecha::text));

  select coalesce(max(numero_pedido), 0) + 1 into v_numero
    from public.pedidos
    where sucursal_id = p_sucursal_id and fecha_pedido = v_fecha;

  v_total := (
    select coalesce(sum((i->>'precio_snap')::numeric * (i->>'cantidad')::int), 0)
    from jsonb_array_elements(p_items) i
  ) + coalesce(p_costo_envio, 0);

  -- ── v1.6 STOCK V2: factor de consumo por presentación — UNA sola lectura ──
  select coalesce(jsonb_object_agg(f.id::text, f.factor), '{}'::jsonb) into v_factores
    from (
      select distinct pres.id, pres.factor_stock as factor
        from jsonb_array_elements(p_items) i
        join public.presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
          and pres.empresa_id = p_empresa_id
       where coalesce(i->>'presentacion_id', '') <> ''
    ) f;
  if exists (
    select 1 from jsonb_each_text(v_factores) e
     where e.value::numeric <> trunc(e.value::numeric) or e.value::numeric < 1
  ) then
    raise exception 'FACTOR_STOCK_INVALIDO' using errcode = 'P0001';
  end if;

  -- ── v1.8: productos del carrito bloqueados FOR SHARE (orden por id) y líneas con id de ítem prefijado ──
  perform 1 from public.productos
   where id in (select pres.producto_id from jsonb_array_elements(p_items) i
                 join public.presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
                where coalesce(i->>'presentacion_id','') <> '')
   order by id for share;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', gen_random_uuid(), 'presentacion_id', pres.id, 'producto_id', pr.id,
                  'nombre', pr.nombre, 'modelo', pr.modelo_stock, 'cant', (t.i->>'cantidad')::int) order by t.ord), '[]'::jsonb)
    into v_lineas
    from jsonb_array_elements(p_items) with ordinality t(i, ord)
    left join public.presentaciones pres on pres.id = nullif(t.i->>'presentacion_id','')::uuid
    left join public.productos pr on pr.id = pres.producto_id;
  v_hay_rama := exists (select 1 from jsonb_array_elements(v_lineas) l where l->>'modelo' = 'rama');

  -- ── v1.8: STOCK POR RAMA — habilitación activa en la sucursal + descuento de hoja con piso 0 ──
  if v_hay_rama then
    for r in select distinct (l->>'producto_id')::uuid as producto_id, l->>'nombre' as nombre
               from jsonb_array_elements(v_lineas) l where l->>'modelo' = 'rama' order by 1
    loop
      if not exists (select 1 from public.stock_rama_habilitacion h
                      where h.producto_id = r.producto_id and h.sucursal_id = p_sucursal_id and h.estado = 'activa') then
        raise exception 'SUCURSAL_PENDIENTE_ACTIVACION:%', r.nombre using errcode = 'P0001';
      end if;
    end loop;
    perform 1 from public.stock_rama sr
     where sr.sucursal_id = p_sucursal_id
       and sr.presentacion_id in (select (l->>'presentacion_id')::uuid from jsonb_array_elements(v_lineas) l where l->>'modelo' = 'rama')
     order by sr.id for update;
    for r in
      select sr.id as hoja_id, l.pres as presentacion_id, l.nombre, l.q
        from (select (x->>'presentacion_id')::uuid as pres, x->>'nombre' as nombre, sum(c.cantidad) as q
                from jsonb_array_elements(v_lineas) x
                cross join lateral public._calcular_consumo((x->>'presentacion_id')::uuid, (x->>'cant')::numeric) c
               where x->>'modelo' = 'rama' group by 1, 2) l
        left join public.stock_rama sr on sr.sucursal_id = p_sucursal_id and sr.presentacion_id = l.pres
       order by sr.id
    loop
      if r.hoja_id is null then raise exception 'HOJA_NO_INICIALIZADA:%', r.nombre using errcode = 'P0001'; end if;
      update public.stock_rama set cantidad = cantidad - r.q, updated_at = now() where id = r.hoja_id and cantidad >= r.q;
      if not found then raise exception 'SIN_STOCK:%', r.nombre using errcode = 'P0001'; end if;
      v_hojas := v_hojas || jsonb_build_object(r.presentacion_id::text, r.hoja_id);
      v_desconto := true;
    end loop;
  end if;

  -- ── STOCK: descuento atómico por producto contable, SOLO donde la sucursal del pedido lo controla (v1.9) ──
  for r in
    select pr.id as producto_id, pr.nombre,
           sum((i->>'cantidad')::int * (v_factores->>(i->>'presentacion_id'))::numeric::int) as q
    from jsonb_array_elements(p_items) i
    join public.presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
      and pres.empresa_id = p_empresa_id
    join public.productos pr on pr.id = pres.producto_id and pr.modelo_stock = 'producto'
    -- v1.9 CONTROL POR SUCURSAL (GO CTO 17/11): decide la fila (producto, SUCURSAL DEL PEDIDO) con controla = true.
    -- Sin fila o con controla = false → la sucursal vende libre y NO descuenta. productos.controla_stock (agregado) ya no decide acá.
    join public.producto_stock psc on psc.producto_id = pr.id and psc.sucursal_id = p_sucursal_id and psc.controla = true
    where coalesce(i->>'presentacion_id', '') <> ''
    group by pr.id, pr.nombre
    order by pr.id
  loop
    update public.producto_stock
      set cantidad = cantidad - r.q, updated_at = now()
      where producto_id = r.producto_id
        and sucursal_id = p_sucursal_id
        and controla = true
        and cantidad >= r.q;
    if not found then
      raise exception 'SIN_STOCK:%', r.nombre using errcode = 'P0001';
    end if;
    v_desconto := true;
    v_movs := v_movs || jsonb_build_object('producto_id', r.producto_id, 'q', r.q);
  end loop;

  -- ── Pedido ──
  insert into public.pedidos (
    empresa_id, sucursal_id, dispositivo_id, numero_pedido, codigo_retiro,
    estado, metodo_pago, total, fecha_pedido, origen, tipo_pedido,
    costo_envio, datos_delivery, mesa_cuenta_id, numero_mesa, pagado,
    nombre_cliente, stock_descontado, operacion_id
  ) values (
    p_empresa_id, p_sucursal_id, p_dispositivo_id, v_numero, p_codigo_retiro,
    p_estado, p_metodo_pago, v_total, v_fecha, p_origen, p_tipo_pedido,
    coalesce(p_costo_envio, 0), p_datos_delivery, p_mesa_cuenta_id, p_numero_mesa,
    coalesce(p_pagado, true), p_nombre_cliente, v_desconto, p_operacion_id
  ) returning id into v_pedido_id;

  insert into public.stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, pedido_id, detalle)
  select p_empresa_id, p_sucursal_id, (m->>'producto_id')::uuid, -((m->>'q')::int), 'venta', v_pedido_id,
    'Venta pedido #' || v_numero || ' · ' ||
    case
      when p_numero_mesa is not null then 'Mesa ' || p_numero_mesa
      when p_tipo_pedido = 'takeaway' then 'Take Away'
      when p_tipo_pedido = 'delivery' then 'Delivery'
      else 'Kiosco/Caja'
    end
  from jsonb_array_elements(v_movs) m;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_idx := v_idx + 1;
    insert into public.pedido_items (
      id, cantidad_stock_snap, pedido_id, presentacion_id, nombre_producto_snap,
      nombre_presentacion_snap, precio_snap, cantidad, promo_id, combo_ref, promo_nombre_snap, promo_precio_snap,
      factor_stock_snap
    ) values (
      (v_lineas->(v_idx - 1)->>'item_id')::uuid,
      case when v_lineas->(v_idx - 1)->>'modelo' = 'rama' then (v_item->>'cantidad')::int end,
      v_pedido_id,
      nullif(v_item->>'presentacion_id', '')::uuid,
      v_item->>'nombre_producto_snap',
      v_item->>'nombre_presentacion_snap',
      (v_item->>'precio_snap')::numeric,
      (v_item->>'cantidad')::int,
      nullif(v_item->>'promo_id', '')::uuid,
      nullif(v_item->>'combo_ref', '')::uuid,
      case when coalesce(v_item->>'promo_id','') <> '' then (select nombre from public.promociones where id = (v_item->>'promo_id')::uuid) end,
      case when coalesce(v_item->>'promo_id','') <> '' then (select precio from public.promociones where id = (v_item->>'promo_id')::uuid) end,
      case when coalesce(v_item->>'presentacion_id','') <> '' then (v_factores->>(v_item->>'presentacion_id'))::numeric end
    ) returning id into v_item_id;

    for v_op in select * from jsonb_array_elements(coalesce(v_item->'opciones', '[]'::jsonb))
    loop
      insert into public.pedido_item_opciones (pedido_item_id, opcion_id, nombre_snap, emoji_snap, color_snap)
      values (v_item_id, (v_op->>'opcion_id')::uuid, v_op->>'nombre_snap', v_op->>'emoji_snap', v_op->>'color_snap');
    end loop;
  end loop;

  -- ── v1.8: LIBRO de ventas por rama ──
  if v_hay_rama then
    v_opv := gen_random_uuid();
    perform public._registrar_operacion(v_opv, p_empresa_id, 'venta',
      public._huella(jsonb_build_object('empresa_id', p_empresa_id, 'sucursal_id', p_sucursal_id, 'pedido_id', v_pedido_id)), null);
    insert into public.stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, pedido_id, detalle,
                                          rama_id, pedido_item_id, consumo_regla, operacion_id)
    select p_empresa_id, p_sucursal_id, (l->>'producto_id')::uuid, -c.cantidad, 'venta', v_pedido_id,
      'Venta pedido #' || v_numero || ' · ' ||
      case
        when p_numero_mesa is not null then 'Mesa ' || p_numero_mesa
        when p_tipo_pedido = 'takeaway' then 'Take Away'
        when p_tipo_pedido = 'delivery' then 'Delivery'
        else 'Kiosco/Caja'
      end,
      (v_hojas->>(l->>'presentacion_id'))::uuid, (l->>'item_id')::uuid, c.regla, v_opv
    from jsonb_array_elements(v_lineas) l
    cross join lateral public._calcular_consumo((l->>'presentacion_id')::uuid, (l->>'cant')::numeric) c
    where l->>'modelo' = 'rama';
    perform public._completar_operacion(v_opv, jsonb_build_object('pedido_id', v_pedido_id, 'lineas', (select count(*) from jsonb_array_elements(v_lineas) z where z->>'modelo'='rama')));
  end if;

  return jsonb_build_object(
    'id', v_pedido_id,
    'numero_pedido', v_numero,
    'codigo_retiro', p_codigo_retiro
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_stock(p_empresa_id uuid, p_sucursal_id uuid, p_producto_id uuid, p_valor integer, p_modo text DEFAULT 'delta'::text, p_motivo text DEFAULT 'ajuste'::text, p_pedido_id uuid DEFAULT NULL::uuid, p_detalle text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old integer;
  v_new integer;
  v_id uuid;
begin
  if session_user = 'authenticator' and coalesce(auth.role(), '') <> 'service_role' then
    if auth_rol() is distinct from 'SUPER_ADMIN'
       and auth_empresa_id() is distinct from p_empresa_id then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from productos where id = p_producto_id and empresa_id = p_empresa_id) then
    raise exception 'PRODUCTO_INVALIDO' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sucursales where id = p_sucursal_id and empresa_id = p_empresa_id) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  select id, cantidad into v_id, v_old
    from producto_stock
    where producto_id = p_producto_id and sucursal_id = p_sucursal_id
    for update;

  if v_id is null then
    v_old := 0;
    v_new := case when p_modo = 'set' then p_valor else v_old + p_valor end;
    -- v1.9 CONTROL POR SUCURSAL: una fila creada acá (compra, ajuste, arqueo, devolución) NO activa el control (controla = false).
    -- Activarlo es una decisión explícita (habilitar en la sucursal); una fila existente conserva su marca.
    insert into producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo, controla, updated_at)
      values (p_empresa_id, p_producto_id, p_sucursal_id, v_new, 0, false, now())
      returning id into v_id;
  else
    v_new := case when p_modo = 'set' then p_valor else v_old + p_valor end;
    update producto_stock set cantidad = v_new, updated_at = now() where id = v_id;
  end if;

  if v_new <> v_old then
    insert into stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, pedido_id, detalle)
      values (p_empresa_id, p_sucursal_id, p_producto_id, v_new - v_old, p_motivo, p_pedido_id, p_detalle);
  end if;

  return jsonb_build_object('cantidad', v_new, 'anterior', v_old, 'delta', v_new - v_old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_arqueo_stock(p_empresa_id uuid, p_sucursal_id uuid, p_alcance text, p_contado_por text, p_observaciones text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_it      jsonb;
  v_f       numeric;
  v_n       integer;
  v_ok      integer;
  v_arq     uuid;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Defensa en profundidad: solo el servidor (service_role) puede ejecutarla.
  if coalesce(auth.role(), '') <> 'service_role' and session_user = 'authenticator' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_alcance is null or (p_alcance <> 'completo' and p_alcance not like 'categoria:%') then
    raise exception 'ALCANCE_INVALIDO' using errcode = 'P0001';
  end if;
  if p_observaciones is not null and length(p_observaciones) > 500 then
    raise exception 'OBSERVACIONES_INVALIDAS' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > 500 then
    raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';
  end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_it) is distinct from 'object'
       or jsonb_typeof(v_it->'producto_id') is distinct from 'string'
       or (v_it->>'producto_id') !~* v_uuid_re then
      raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_it->'fisico') is distinct from 'number' then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end if;
    v_f := (v_it->>'fisico')::numeric;
    if v_f < 0 or v_f > 1000000 or v_f <> trunc(v_f) then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end if;
  end loop;

  select count(distinct (e->>'producto_id')::uuid) into v_ok from jsonb_array_elements(p_items) e;
  if v_ok <> v_n then
    raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';       -- productos repetidos
  end if;

  if not exists (select 1 from sucursales where id = p_sucursal_id and empresa_id = p_empresa_id) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  select count(*) into v_ok
    from productos pr
   where pr.empresa_id = p_empresa_id and pr.activo = true and pr.deleted_at is null
     -- v1.9: solo productos que ESTA sucursal controla (rama conserva su criterio)
     and ((pr.modelo_stock = 'rama' and pr.controla_stock is true) or exists (select 1 from producto_stock psx where psx.producto_id = pr.id and psx.sucursal_id = p_sucursal_id and psx.controla = true))
     and pr.id in (select (e->>'producto_id')::uuid from jsonb_array_elements(p_items) e);
  if v_ok <> v_n then
    raise exception 'PRODUCTO_INVALIDO' using errcode = 'P0001';
  end if;

  -- El índice único parcial decide la carrera: el segundo pendiente falla acá.
  begin
    insert into arqueos_stock (empresa_id, sucursal_id, alcance, contado_por, observaciones)
    values (p_empresa_id, p_sucursal_id, p_alcance, nullif(trim(p_contado_por), ''), nullif(trim(p_observaciones), ''))
    returning id into v_arq;
  exception when unique_violation then
    raise exception 'ARQUEO_PENDIENTE' using errcode = 'P0001';
  end;

  -- Teórico leído en ESTA transacción (snapshot consistente con el arqueo). Sin fila = 0.
  insert into arqueo_items (arqueo_id, producto_id, teorico, fisico)
  select v_arq,
         (e->>'producto_id')::uuid,
         coalesce(ps.cantidad, 0),
         (e->>'fisico')::numeric
    from jsonb_array_elements(p_items) e
    left join producto_stock ps
           on ps.producto_id = (e->>'producto_id')::uuid
          and ps.sucursal_id = p_sucursal_id
          and ps.empresa_id  = p_empresa_id;

  return jsonb_build_object('ok', true, 'arqueo_id', v_arq, 'cargados', v_n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.iniciar_conteo_stock(p_empresa_id uuid, p_sucursal_id uuid, p_usuario_id uuid, p_usuario_nombre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     where p.empresa_id = p_empresa_id and p.activo is true and p.deleted_at is null
       -- v1.9: solo productos que ESTA sucursal controla (rama conserva su criterio)
       and ((p.modelo_stock = 'rama' and p.controla_stock is true) or exists (select 1 from producto_stock psx where psx.producto_id = p.id and psx.sucursal_id = p_sucursal_id and psx.controla = true));
  return jsonb_build_object('lote_id', v_id, 'iniciado_at', v_ini,
    'items', coalesce((select jsonb_agg(jsonb_build_object('producto_id', b.producto_id, 'nombre', p.nombre, 'base', b.base,
                         'sin_alta', not exists (select 1 from producto_stock ps where ps.producto_id = b.producto_id and ps.sucursal_id = p_sucursal_id))
                       order by p.nombre, b.producto_id)
                 from stock_conteo_base b join productos p on p.id = b.producto_id where b.conteo_id = v_id), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public._calcular_ajuste_stock(p_empresa_id uuid, p_sucursal_id uuid, p_lote_id uuid, p_motivo_tipo text, p_descripcion text, p_items jsonb, p_pct numeric DEFAULT 20, p_min_unid integer DEFAULT 5, p_abs_item integer DEFAULT 50, p_abs_lote integer DEFAULT 100, p_nuevas uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     and p.activo is true and p.deleted_at is null
     -- v1.9: solo productos que ESTA sucursal controla (rama conserva su criterio)
     and ((p.modelo_stock = 'rama' and p.controla_stock is true) or exists (select 1 from producto_stock psx where psx.producto_id = p.id and psx.sucursal_id = p_sucursal_id and psx.controla = true));
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
end $function$;

CREATE OR REPLACE FUNCTION public.devolver_stock_pedido(p_empresa_id uuid, p_pedido_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ped record; r record; v_det text;
  v_movs integer := 0; v_unidades numeric := 0; v_con_libro boolean;
begin
  select id, empresa_id, sucursal_id, numero_pedido, numero_mesa, tipo_pedido, stock_descontado
    into v_ped
    from public.pedidos
   where id = p_pedido_id and empresa_id = p_empresa_id
   for update;
  if v_ped.id is null then
    raise exception 'PEDIDO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  -- Idempotencia: ya devuelto (o nunca descontó) → no-op, sin error.
  -- (revisión CTO 8/11) El flag se evalúa EXPLÍCITAMENTE: solo `true` devuelve stock. Con NULL (columna sin NOT NULL en la base viva, dato
  -- anterior al flag) `not NULL` es NULL y el IF no entraba: la función seguiría y devolvería stock que nadie probó haber descontado. Ahora
  -- NULL = "no se descontó" (igual que el endpoint, que solo llama si es true) y se informa con motivo FLAG_NULL.
  if v_ped.stock_descontado is distinct from true then
    return jsonb_build_object('devuelto', false, 'movimientos', 0, 'unidades', 0,
                              'motivo', case when v_ped.stock_descontado is null then 'FLAG_NULL' else 'YA_DEVUELTO' end);
  end if;

  v_det := 'Devolución por eliminación del pedido #' || v_ped.numero_pedido || ' · ' ||
    case when v_ped.numero_mesa is not null then 'Mesa ' || v_ped.numero_mesa
         when v_ped.tipo_pedido = 'takeaway' then 'Take Away'
         when v_ped.tipo_pedido = 'delivery' then 'Delivery'
         else 'Kiosco/Caja' end;

  -- (revisión CTO 8/11) DECISIÓN HISTÓRICA de qué productos controlaban stock: la toma el LIBRO de la venta (stock_movimientos
  -- motivo 'venta' de este pedido, escrito en la misma transacción que el descuento), NO productos.controla_stock de HOY (que puede
  -- haber cambiado después de la venta y haría omitir —o inventar— una devolución). Para pedidos anteriores al libro (sin
  -- movimientos de venta) se conserva el criterio histórico del sistema (controla_stock actual).
  -- La cantidad sigue siendo la del snapshot (cantidad × factor_stock_snap); si no coincide con lo que el libro dice que se descontó,
  -- se aborta (rollback, el flag sigue en true): jamás se devuelve una cantidad distinta de la descontada.
  select exists (select 1 from public.stock_movimientos m where m.pedido_id = p_pedido_id and m.motivo = 'venta') into v_con_libro;

  for r in
    select pr.id as producto_id,
           sum(it.cantidad * coalesce(it.factor_stock_snap, 1)) as q,
           (select -sum(m.delta) from public.stock_movimientos m where m.pedido_id = p_pedido_id and m.motivo = 'venta' and m.producto_id = pr.id) as q_libro
      from public.pedido_items it
      join public.presentaciones pres on pres.id = it.presentacion_id
      join public.productos pr on pr.id = pres.producto_id
     where it.pedido_id = p_pedido_id and it.presentacion_id is not null
       and (case when v_con_libro
                 then exists (select 1 from public.stock_movimientos m where m.pedido_id = p_pedido_id and m.motivo = 'venta' and m.producto_id = pr.id)
                 -- v1.9: pedido anterior al libro. Modelo 'producto': decide SOLO la fila (producto, sucursal del pedido) con controla = true (el agregado
                 -- productos.controla_stock no interviene). Modelo 'rama': se conserva el criterio histórico (flag del producto), sin exigir fila de producto_stock.
                 else (case when pr.modelo_stock = 'rama' then pr.controla_stock = true
                            else exists (select 1 from public.producto_stock psd where psd.producto_id = pr.id and psd.sucursal_id = v_ped.sucursal_id and psd.controla = true) end) end)
     group by pr.id
     order by pr.id
  loop
    if v_con_libro and r.q is distinct from r.q_libro then
      raise exception 'DEVOLUCION_INCONSISTENTE:% (snapshot %, libro %)', r.producto_id, r.q, r.q_libro using errcode = 'P0001';
    end if;
    if r.q <> trunc(r.q) or r.q <= 0 then
      raise exception 'DEVOLUCION_NO_ENTERA:%', r.producto_id using errcode = 'P0001';
    end if;
    perform public.ajustar_stock(p_empresa_id, v_ped.sucursal_id, r.producto_id, r.q::integer,
                          'delta', 'devolucion', p_pedido_id, v_det);
    v_movs := v_movs + 1; v_unidades := v_unidades + r.q;
  end loop;

  update public.pedidos set stock_descontado = false where id = p_pedido_id;

  return jsonb_build_object('devuelto', true, 'movimientos', v_movs, 'unidades', v_unidades);
end; $function$;

-- _restaurar_producto_stock  (conversión rama → producto; SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public._restaurar_producto_stock(p_empresa uuid, p_sucursal uuid, p_producto uuid, p_cantidad integer, p_detalle text, p_usuario uuid, p_operacion uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_old integer; v_new integer; v_mov uuid;
begin
  if p_cantidad is null or p_cantidad < 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.productos where id = p_producto and empresa_id = p_empresa and modelo_stock = 'producto') then
    raise exception 'RESTAURAR_REQUIERE_MODELO_PRODUCTO' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.sucursales where id = p_sucursal and empresa_id = p_empresa) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001'; end if;
  select id, cantidad into v_id, v_old from public.producto_stock where producto_id = p_producto and sucursal_id = p_sucursal for update;
  if v_id is null then
    v_old := 0;
    if p_cantidad > 0 then
      -- v1.9 CONTROL POR SUCURSAL (conversión rama → producto): una sucursal SIN fila antes de la conversión vendía libre; la fila que se crea
      -- acá guarda el conteo, pero NO activa el control (controla = false explícito). Una fila existente conserva su marca (el UPDATE no la toca).
      insert into public.producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo, controla, updated_at)
      values (p_empresa, p_producto, p_sucursal, p_cantidad, 0, false, now());
    end if;
  else
    update public.producto_stock set cantidad = p_cantidad, updated_at = now() where id = v_id;
  end if;
  select coalesce(max(cantidad), 0) into v_new from public.producto_stock where producto_id = p_producto and sucursal_id = p_sucursal;
  if v_new <> p_cantidad then raise exception 'RESTAURACION_NO_COINCIDE: leido %, esperado %', v_new, p_cantidad using errcode = 'P0001'; end if;
  if v_new <> v_old then
    insert into public.stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, detalle, usuario_id, operacion_id)
    values (p_empresa, p_sucursal, p_producto, v_new - v_old, 'ajuste', p_detalle, p_usuario, p_operacion) returning id into v_mov;
  end if;
  return jsonb_build_object('anterior', v_old, 'cantidad', v_new, 'delta', v_new - v_old, 'movimiento_id', v_mov);
end $function$;

-- volver_modelo_producto  (conversión rama → producto; SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.volver_modelo_producto(p_empresa_id uuid, p_producto_id uuid, p_usuario_id uuid, p_usuario_nombre text, p_motivo text, p_operacion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mot text := btrim(coalesce(p_motivo,'')); v_huella text; v_reg jsonb; v_mod text; v_del timestamptz; v_ctl_prev boolean;
  h record; v_saldo numeric; v_suma numeric; v_desde timestamptz; v_hoja record; v_res jsonb; v_rest jsonb; v_rev uuid;
  v_list jsonb := '[]'::jsonb;
  v_fila boolean; v_ctl_suc boolean; v_n integer; v_ctl2 boolean; v_cant2 numeric;  -- v1.9: estado por sucursal antes/después de restaurar
begin
  perform public._validar_usuario_stock_empresa(p_empresa_id, p_usuario_id);
  if p_operacion_id is null then raise exception 'OPERACION_REQUERIDA' using errcode = 'P0001'; end if;
  if v_mot = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;
  v_huella := public._huella(jsonb_build_object('empresa_id', p_empresa_id, 'producto_id', p_producto_id, 'motivo', v_mot, 'usuario_id', p_usuario_id));
  v_reg := public._registrar_operacion(p_operacion_id, p_empresa_id, 'revertir', v_huella, p_usuario_id);
  if v_reg->>'estado' = 'repetida' then return (v_reg->'resultado') || jsonb_build_object('repetido', true); end if;
  perform public._exigir_read_committed();

  perform public._a0_exclusivo();
  select modelo_stock, deleted_at into v_mod, v_del from public.productos where id = p_producto_id and empresa_id = p_empresa_id for update;
  if v_mod is null then raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_mod <> 'rama' then raise exception 'PRODUCTO_NO_RAMA' using errcode = 'P0001'; end if;
  perform 1 from public.producto_stock where producto_id = p_producto_id order by sucursal_id for update;
  perform 1 from public.stock_rama where producto_id = p_producto_id order by id for update;

  if exists (select 1 from public.stock_rama_habilitacion where producto_id = p_producto_id and estado = 'pendiente') then
    raise exception 'HABILITACION_PENDIENTE: activar o resolver las sucursales pendientes antes de revertir' using errcode = 'P0001'; end if;
  select min(activada_at) into v_desde from public.stock_rama_habilitacion where producto_id = p_producto_id and estado = 'activa';
  if v_desde is null then raise exception 'HABILITACION_INEXISTENTE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.stock_movimientos m where m.producto_id = p_producto_id and m.rama_id is not null and m.motivo <> 'apertura' and m.created_at >= v_desde) then
    raise exception 'REVERSION_BLOQUEADA: hay movimientos posteriores a la apertura (venta, ingreso, devolucion o ajuste); la reversion exacta no es posible' using errcode = 'P0001'; end if;
  if exists (select 1 from public.stock_conteos c join public.stock_conteo_base b on b.conteo_id = c.id
              where c.empresa_id = p_empresa_id and b.producto_id = p_producto_id and c.estado not in ('aplicado','cancelado','anulado'))
     or exists (select 1 from public.arqueos_stock a where a.empresa_id = p_empresa_id and a.estado = 'pendiente'
                 and a.sucursal_id in (select sucursal_id from public.stock_rama_habilitacion where producto_id = p_producto_id and estado = 'activa')) then
    raise exception 'REVERSION_BLOQUEADA: operacion de stock pendiente' using errcode = 'P0001'; end if;

  select controla_stock_previo into v_ctl_prev from (select (resultado->>'controla_stock_previo')::boolean controla_stock_previo from public.stock_operaciones
          where empresa_id = p_empresa_id and tipo = 'habilitar' and resultado->>'producto_id' = p_producto_id::text order by created_at desc limit 1) z;
  if v_ctl_prev is null then raise exception 'CONTROLA_STOCK_PREVIO_DESCONOCIDO' using errcode = 'P0001'; end if;
  -- v1.9 CONTROL POR SUCURSAL (conversión rama → producto): durante el modelo rama las filas de producto_stock están CONGELADAS (trg_stock_ps_guard)
  -- y conservan su marca controla, que es la única fuente del control por sucursal. El agregado previo debe coincidir con ellas
  -- («controla en al menos una sucursal»). Si no coincide, esa habilitación se registró con el modelo global anterior (un solo flag para todas las
  -- sucursales) y el control por sucursal NO se puede reconstruir: se aborta sin cambios en vez de inventarlo (decisión del CTO).
  if v_ctl_prev is distinct from exists (select 1 from public.producto_stock where producto_id = p_producto_id and controla = true) then
    raise exception 'CONTROL_POR_SUCURSAL_NO_RECONSTRUIBLE: controla_stock previo (%) no coincide con las filas congeladas de producto_stock', v_ctl_prev using errcode = 'P0001'; end if;

  for h in select * from public.stock_rama_habilitacion where producto_id = p_producto_id and estado = 'activa' order by sucursal_id loop
    select coalesce((select cantidad from public.producto_stock where producto_id = p_producto_id and sucursal_id = h.sucursal_id), 0) into v_saldo;
    if v_saldo <> h.saldo_anterior then
      raise exception 'CONGELADO_ALTERADO: sucursal %, producto_stock %, esperado %', h.sucursal_id, v_saldo, h.saldo_anterior using errcode = 'P0001'; end if;
    select coalesce(sum(cantidad), 0) into v_suma from public.stock_rama where producto_id = p_producto_id and sucursal_id = h.sucursal_id;
    if v_suma <> h.total_contado then
      raise exception 'HOJAS_NO_COINCIDEN_CON_CONTEO: sucursal %, hojas %, contado %', h.sucursal_id, v_suma, h.total_contado using errcode = 'P0001'; end if;
  end loop;

  for v_hoja in select id, sucursal_id, cantidad from public.stock_rama where producto_id = p_producto_id and cantidad > 0 order by id loop
    update public.stock_rama set cantidad = 0, updated_at = now() where id = v_hoja.id;
    insert into public.stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, detalle, rama_id, operacion_id, usuario_id)
    values (p_empresa_id, v_hoja.sucursal_id, p_producto_id, -v_hoja.cantidad, 'ajuste', 'Reversion a modelo producto · ' || v_mot, v_hoja.id, p_operacion_id, p_usuario_id);
  end loop;

  update public.productos set modelo_stock = 'producto', controla_stock = v_ctl_prev where id = p_producto_id;

  for h in select * from public.stock_rama_habilitacion where producto_id = p_producto_id and estado = 'activa' order by sucursal_id loop
    -- v1.9: estado individual de ESTA sucursal antes de restaurar (la fila congelada es la fuente del control; sin fila = vendía libre)
    select count(*) > 0, coalesce(bool_or(controla), false) into v_fila, v_ctl_suc
      from public.producto_stock where producto_id = p_producto_id and sucursal_id = h.sucursal_id;
    v_rest := public._restaurar_producto_stock(p_empresa_id, h.sucursal_id, p_producto_id, h.total_contado::int,
                'Reversion a modelo producto · ' || v_mot, p_usuario_id, p_operacion_id);
    -- v1.9: verificación POR SUCURSAL. Con fila previa: misma marca controla y cantidad = conteo. Sin fila previa: conteo 0 → sigue sin fila;
    -- conteo > 0 → fila nueva con controla = false. Cualquier otra cosa aborta toda la conversión (rollback completo).
    select count(*), coalesce(bool_or(controla), false), coalesce(max(cantidad), 0) into v_n, v_ctl2, v_cant2
      from public.producto_stock where producto_id = p_producto_id and sucursal_id = h.sucursal_id;
    if not (case when v_fila then v_n = 1 and v_ctl2 = v_ctl_suc and v_cant2 = h.total_contado
                 when h.total_contado = 0 then v_n = 0
                 else v_n = 1 and v_ctl2 = false and v_cant2 = h.total_contado end) then
      raise exception 'RESTAURACION_CONTROL_SUCURSAL_ALTERADA: sucursal %, fila previa %, controla previo %, ahora filas %, controla %, cantidad %',
        h.sucursal_id, v_fila, v_ctl_suc, v_n, v_ctl2, v_cant2 using errcode = 'P0001'; end if;
    select coalesce((select cantidad from public.producto_stock where producto_id = p_producto_id and sucursal_id = h.sucursal_id), 0) into v_saldo;
    insert into public.stock_rama_reversion (empresa_id, habilitacion_id, producto_id, sucursal_id, saldo_anterior_congelado, total_contado, saldo_restaurado, diferencia, operacion_id, usuario_id, movimiento_id)
    values (p_empresa_id, h.id, p_producto_id, h.sucursal_id, h.saldo_anterior, h.total_contado, v_saldo, v_saldo - h.saldo_anterior, p_operacion_id, p_usuario_id,
            nullif(v_rest->>'movimiento_id','')::uuid) returning id into v_rev;
    update public.stock_rama_habilitacion set estado = 'revertida', revertida_at = now() where id = h.id;
    v_list := v_list || jsonb_build_array(jsonb_build_object('sucursal_id', h.sucursal_id, 'saldo_anterior_congelado', h.saldo_anterior,
                'total_contado', h.total_contado, 'saldo_restaurado', v_saldo, 'diferencia', v_saldo - h.saldo_anterior, 'reversion_id', v_rev));
  end loop;

  -- v1.9: el agregado debe seguir siendo «controla en al menos una sucursal» sobre las filas restauradas
  if (select controla_stock from public.productos where id = p_producto_id) is distinct from
     exists (select 1 from public.producto_stock where producto_id = p_producto_id and controla = true) then
    raise exception 'AGREGADO_CONTROL_INCOHERENTE: productos.controla_stock no coincide con las filas restauradas' using errcode = 'P0001'; end if;

  v_res := jsonb_build_object('producto_id', p_producto_id, 'modelo', 'producto', 'controla_stock', v_ctl_prev,
                              'usuario_nombre', btrim(coalesce(p_usuario_nombre,'')), 'sucursales', v_list);
  perform public._completar_operacion(p_operacion_id, v_res);
  return v_res || jsonb_build_object('repetido', false);
end $function$;

-- 6) VERIFICACIONES DESPUÉS (cualquier fallo aborta TODO)
do $$
declare
  pre jsonb := (select jsonb_object_agg(k, v) from _ctl_pre);
  n numeric;
begin
  select count(*) into n from public.producto_stock;
  if n <> (pre->>'ps_filas')::numeric + (pre->>'a_insertar')::numeric then raise exception 'VERIF: filas % <> % + %', n, pre->>'ps_filas', pre->>'a_insertar'; end if;
  select coalesce(sum(cantidad), 0) into n from public.producto_stock;
  if n <> (pre->>'ps_suma_cantidad')::numeric then raise exception 'VERIF: la suma de cantidades cambió (% -> %)', pre->>'ps_suma_cantidad', n; end if;
  select count(*) into n from public.stock_movimientos;
  if n <> (pre->>'movimientos')::numeric then raise exception 'VERIF: cambió la cantidad de movimientos (% -> %)', pre->>'movimientos', n; end if;
  select count(*) into n from public.productos where controla_stock = true;
  if n <> (pre->>'prod_controla_flag')::numeric then raise exception 'VERIF: cambió el agregado productos.controla_stock'; end if;
  select count(*) into n from public.producto_stock ps join public.productos pr on pr.id = ps.producto_id where pr.modelo_stock <> 'producto';
  if n <> (pre->>'ps_filas_rama')::numeric then raise exception 'VERIF: se tocaron filas de productos por rama'; end if;
  -- productos por rama con flag: ni la migración ni sus filas los alteran (el flag de rama sigue exactamente igual)
  select count(*) into n from public.productos where controla_stock = true and modelo_stock <> 'producto';
  if n <> (pre->>'prod_flag_rama')::numeric then raise exception 'VERIF: cambió el flag de productos por rama (% -> %)', pre->>'prod_flag_rama', n; end if;
  -- filas de productos 'producto' con flag: las previas + EXACTAMENTE las insertadas (toda fila insertada pertenece a un producto con flag)
  select count(*) into n from public.producto_stock ps join public.productos pr on pr.id = ps.producto_id where pr.controla_stock = true and pr.modelo_stock = 'producto';
  if n <> (pre->>'ps_filas_con_flag')::numeric + (pre->>'a_insertar')::numeric then raise exception 'VERIF: filas de productos con flag % <> % + %', n, pre->>'ps_filas_con_flag', pre->>'a_insertar'; end if;
  -- el conjunto insertado es EXACTAMENTE el aprobado: 18 filas controla=true, cantidad 0, sin movimientos, y el respaldo coincide con la lista
  if (pre->>'a_insertar')::numeric <> (select count(*) from _ctl_aprobado) then raise exception 'VERIF: a_insertar no coincide con la lista aprobada'; end if;
  select count(*) into n from _ctl_aprobado a join public.producto_stock ps on ps.empresa_id = a.empresa_id and ps.producto_id = a.producto_id and ps.sucursal_id = a.sucursal_id
   where ps.controla = true and ps.cantidad = 0 and ps.stock_minimo = 0
     and not exists (select 1 from public.stock_movimientos m where m.producto_id = a.producto_id and m.sucursal_id = a.sucursal_id);
  if n <> (select count(*) from _ctl_aprobado) then raise exception 'VERIF: % de % filas aprobadas no quedaron controla=true / cantidad 0 / sin movimientos', (select count(*) from _ctl_aprobado) - n, (select count(*) from _ctl_aprobado); end if;
  -- toda fila de producto con flag=true quedó controla=true; toda fila de producto con flag=false quedó controla=false
  select count(*) into n from public.producto_stock ps join public.productos pr on pr.id = ps.producto_id
   where pr.modelo_stock = 'producto' and ps.controla is distinct from pr.controla_stock;
  if n <> 0 then raise exception 'VERIF: % filas con controla distinto del comportamiento global anterior', n; end if;
  -- todo producto ya controlado tiene fila controlada en CADA sucursal de su empresa (mismo «agotado» de hoy)
  select count(*) into n from public.productos pr join public.sucursales s on s.empresa_id = pr.empresa_id
   where pr.controla_stock = true and pr.modelo_stock = 'producto'
     and not exists (select 1 from public.producto_stock ps where ps.producto_id = pr.id and ps.sucursal_id = s.id and ps.controla = true);
  if n <> 0 then raise exception 'VERIF: % pares producto/sucursal controlados sin fila controla=true', n; end if;
  -- Copa Sport / Prueba intacta
  select coalesce(sum(cantidad), 0) into n from public.producto_stock where producto_id = '3925d2d9-e800-4cd7-b615-e1ddc4e4dd5e' and sucursal_id = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b';
  if n <> (pre->>'copa_sport_prueba')::numeric then raise exception 'VERIF: Copa Sport/Prueba cambió'; end if;
  -- la conversión rama → producto quedó con sus guardas por sucursal
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'volver_modelo_producto'
                   and p.prosrc like '%CONTROL_POR_SUCURSAL_NO_RECONSTRUIBLE%' and p.prosrc like '%RESTAURACION_CONTROL_SUCURSAL_ALTERADA%'
                   and p.prosrc like '%AGREGADO_CONTROL_INCOHERENTE%') then raise exception 'VERIF: volver_modelo_producto sin guardas de control por sucursal'; end if;
  -- las 8 funciones quedaron en v1.9
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
        and p.proname in ('crear_pedido_stock','ajustar_stock','crear_arqueo_stock','iniciar_conteo_stock','_calcular_ajuste_stock','devolver_stock_pedido',
                          '_restaurar_producto_stock','volver_modelo_producto')
        and p.prosrc like '%v1.9%') <> 8 then raise exception 'VERIF: faltan funciones v1.9'; end if;
end $$;

-- Resumen para revisar antes del COMMIT (filas insertadas por empresa y sucursal + totales)
select e.nombre as empresa, s.nombre as sucursal, count(*) filter (where ps.controla) as filas_controladas, count(*) as filas_totales,
       coalesce(sum(ps.cantidad), 0) as suma_cantidad
  from public.producto_stock ps join public.sucursales s on s.id = ps.sucursal_id join public.empresas e on e.id = ps.empresa_id
 group by e.nombre, s.nombre order by 1, 2;

commit;
