-- ============================================================
-- STOCK V1 — RPC crear_pedido_stock v1.1
-- Cambio vs v1 (revisión CTO, punto 2): la RPC deja de confiar
-- en la coherencia empresa/sucursal/presentaciones del cliente.
--  (a) sucursal debe pertenecer a la empresa → si no, RAISE
--  (b) toda presentación referenciada debe pertenecer a la
--      empresa → si no, RAISE (rollback total)
--  (c) el join de stock filtra presentaciones por empresa
-- Todo lo demás idéntico a v1. Correr con or replace, sin
-- cambios de código en /api/pedidos.
-- ============================================================

create or replace function crear_pedido_stock(
  p_empresa_id uuid,
  p_sucursal_id uuid,
  p_dispositivo_id uuid,
  p_items jsonb,
  p_metodo_pago text,
  p_origen text,
  p_tipo_pedido text,
  p_costo_envio numeric,
  p_datos_delivery jsonb,
  p_estado text,
  p_codigo_retiro text,
  p_mesa_cuenta_id uuid default null,
  p_numero_mesa integer default null,
  p_pagado boolean default null,
  p_nombre_cliente text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fecha date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_numero integer;
  v_total numeric;
  v_pedido_id uuid;
  v_desconto boolean := false;
  r record;
  v_item jsonb;
  v_item_id uuid;
  v_op jsonb;
begin
  -- ── SERVER-AUTHORITATIVE (v1.1) ──
  -- (a) La sucursal debe pertenecer a la empresa declarada.
  perform 1 from sucursales
    where id = p_sucursal_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  -- (b) Ninguna presentación del carrito puede ser de otra empresa
  --     (o inexistente: el FK de pedido_items la rechaza después de
  --     todos modos, pero acá cortamos antes de tocar nada).
  perform 1
    from jsonb_array_elements(p_items) i
    left join presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
    where coalesce(i->>'presentacion_id', '') <> ''
      and (pres.id is null or pres.empresa_id <> p_empresa_id);
  if found then
    raise exception 'PRESENTACION_INVALIDA' using errcode = 'P0001';
  end if;

  -- Numeración serializada por sucursal+día (mata la race del MAX+1).
  perform pg_advisory_xact_lock(hashtext(p_sucursal_id::text || v_fecha::text));

  select coalesce(max(numero_pedido), 0) + 1 into v_numero
    from pedidos
    where sucursal_id = p_sucursal_id and fecha_pedido = v_fecha;

  v_total := (
    select coalesce(sum((i->>'precio_snap')::numeric * (i->>'cantidad')::int), 0)
    from jsonb_array_elements(p_items) i
  ) + coalesce(p_costo_envio, 0);

  -- ── STOCK: descuento atómico por producto contable ──
  -- (c) el join exige pres.empresa_id = p_empresa_id.
  for r in
    select pr.id as producto_id, pr.nombre, sum((i->>'cantidad')::int) as q
    from jsonb_array_elements(p_items) i
    join presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
      and pres.empresa_id = p_empresa_id
    join productos pr on pr.id = pres.producto_id and pr.controla_stock = true
    where coalesce(i->>'presentacion_id', '') <> ''
    group by pr.id, pr.nombre
    order by pr.id
  loop
    update producto_stock
      set cantidad = cantidad - r.q, updated_at = now()
      where producto_id = r.producto_id
        and sucursal_id = p_sucursal_id
        and cantidad >= r.q;
    if not found then
      raise exception 'SIN_STOCK:%', r.nombre using errcode = 'P0001';
    end if;
    v_desconto := true;
  end loop;

  -- ── Pedido ──
  insert into pedidos (
    empresa_id, sucursal_id, dispositivo_id, numero_pedido, codigo_retiro,
    estado, metodo_pago, total, fecha_pedido, origen, tipo_pedido,
    costo_envio, datos_delivery, mesa_cuenta_id, numero_mesa, pagado,
    nombre_cliente, stock_descontado
  ) values (
    p_empresa_id, p_sucursal_id, p_dispositivo_id, v_numero, p_codigo_retiro,
    p_estado, p_metodo_pago, v_total, v_fecha, p_origen, p_tipo_pedido,
    coalesce(p_costo_envio, 0), p_datos_delivery, p_mesa_cuenta_id, p_numero_mesa,
    coalesce(p_pagado, true), p_nombre_cliente, v_desconto
  ) returning id into v_pedido_id;

  -- ── Items + opciones (misma transacción, sin EXCEPTION interno:
  --    cualquier fallo aborta TODO — jamás éxito parcial) ──
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into pedido_items (
      pedido_id, presentacion_id, nombre_producto_snap,
      nombre_presentacion_snap, precio_snap, cantidad
    ) values (
      v_pedido_id,
      nullif(v_item->>'presentacion_id', '')::uuid,
      v_item->>'nombre_producto_snap',
      v_item->>'nombre_presentacion_snap',
      (v_item->>'precio_snap')::numeric,
      (v_item->>'cantidad')::int
    ) returning id into v_item_id;

    for v_op in select * from jsonb_array_elements(coalesce(v_item->'opciones', '[]'::jsonb))
    loop
      insert into pedido_item_opciones (pedido_item_id, opcion_id, nombre_snap, emoji_snap, color_snap)
      values (v_item_id, (v_op->>'opcion_id')::uuid, v_op->>'nombre_snap', v_op->>'emoji_snap', v_op->>'color_snap');
    end loop;
  end loop;

  return jsonb_build_object(
    'id', v_pedido_id,
    'numero_pedido', v_numero,
    'codigo_retiro', p_codigo_retiro
  );
end;
$$;

-- Verificación
select proname, prosecdef, proconfig from pg_proc where proname = 'crear_pedido_stock';
