-- ============================================================
-- RPC crear_pedido_stock v1.2 — PRECIO SERVER-AUTHORITATIVE
-- Ciclo C · GO CTO 17/09/2026 (autorización STOP explícita)
--
-- Novedad respecto de v1.1: bloque de validación de PRECIO y
-- CONTEXTO DE OPCIONES, ubicado ANTES del advisory lock:
-- un rechazo no consume número de pedido, ni stock, ni inserta
-- nada, ni dispara ARCA/MP/beneficios (la excepción aborta todo).
--
-- Reglas (decisiones CTO):
--  · Item CON presentacion_id:
--      - cada opción del item debe ser de la empresa, activa, no
--        borrada, de grupo activo VINCULADO a esa presentación
--        (presentacion_grupos) → si no: OPCION_INVALIDA:{nombre}
--      - precio esperado = presentaciones.precio
--                        + Σ opciones.precio_adicional del item
--        igualdad ESTRICTA contra precio_snap → PRECIO_INVALIDO:{nombre}
--  · Item SIN presentacion_id (flujo ACCESORIOS, hallazgo Q1=108):
--      cadena completa exigida — empresa → grupo activo cuyo nombre
--      contiene 'accesorio' → opción activa no borrada →
--      precio_adicional > 0 → nombre igual al snapshot (directo o
--      con el prefijo 'Toppings ' recortado, replicando el regex
--      exacto del cliente) → precio_adicional = precio_snap.
--      Sin match: PRECIO_INVALIDO:{nombre}.
--  · costo_envio: FUERA de esta versión (decisión 5).
--  · Histórico: intocable (esto solo corre al CREAR).
-- Firma IDÉNTICA a v1.1 → cero cambios en callers.
-- ============================================================

CREATE OR REPLACE FUNCTION public.crear_pedido_stock(
  p_empresa_id uuid, p_sucursal_id uuid, p_dispositivo_id uuid,
  p_items jsonb, p_metodo_pago text, p_origen text, p_tipo_pedido text,
  p_costo_envio numeric, p_datos_delivery jsonb, p_estado text,
  p_codigo_retiro text,
  p_mesa_cuenta_id uuid DEFAULT NULL::uuid,
  p_numero_mesa integer DEFAULT NULL::integer,
  p_pagado boolean DEFAULT NULL::boolean,
  p_nombre_cliente text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  -- v1.2
  v_precio_base numeric;
  v_adicionales numeric;
  v_op_precio numeric;
  v_nombre_item text;
begin
  -- ── SERVER-AUTHORITATIVE (v1.1) ──
  -- (a) La sucursal debe pertenecer a la empresa declarada.
  perform 1 from sucursales
    where id = p_sucursal_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  -- (b) Ninguna presentación del carrito puede ser de otra empresa.
  perform 1
    from jsonb_array_elements(p_items) i
    left join presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
    where coalesce(i->>'presentacion_id', '') <> ''
      and (pres.id is null or pres.empresa_id <> p_empresa_id);
  if found then
    raise exception 'PRESENTACION_INVALIDA' using errcode = 'P0001';
  end if;

  -- ── v1.2: PRECIO + CONTEXTO DE OPCIONES + ACCESORIOS ──
  -- ANTES del advisory lock: un rechazo acá no consume numeración,
  -- stock ni efecto alguno.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_nombre_item := coalesce(
      nullif(v_item->>'nombre_presentacion_snap', ''),
      nullif(v_item->>'nombre_producto_snap', ''), 'un producto');

    if coalesce(v_item->>'presentacion_id', '') <> '' then
      -- ── Item normal: presentación + opciones de SU contexto ──
      select pres.precio into v_precio_base
        from presentaciones pres
        where pres.id = (v_item->>'presentacion_id')::uuid;
      -- (existencia y empresa ya garantizadas por (b))

      v_adicionales := 0;
      for v_op in select * from jsonb_array_elements(coalesce(v_item->'opciones', '[]'::jsonb))
      loop
        -- Cadena de contexto completa: opción de la empresa, viva,
        -- de grupo activo VINCULADO a esta presentación.
        select o.precio_adicional into v_op_precio
          from opciones o
          join grupos_opciones g on g.id = o.grupo_id
            and g.empresa_id = p_empresa_id and g.activo = true
          join presentacion_grupos pg on pg.grupo_id = g.id
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

      -- Precio esperado, igualdad ESTRICTA (decisión 2).
      if (v_item->>'precio_snap')::numeric is distinct from (coalesce(v_precio_base, 0) + v_adicionales) then
        raise exception 'PRECIO_INVALIDO:%', v_nombre_item using errcode = 'P0001';
      end if;

    else
      -- ── Item sin presentación: SOLO accesorio legítimo ──
      -- Cadena completa exigida por el CTO (jamás "nombre y precio sueltos"):
      -- empresa → grupo activo 'accesorio' → opción activa → precio > 0
      -- → nombre normalizado (regex del cliente) → precio EXACTO.
      perform 1
        from opciones o
        join grupos_opciones g on g.id = o.grupo_id
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

    -- Cantidad: debe ser entera positiva (el total la usa tal cual).
    if coalesce((v_item->>'cantidad')::int, 0) < 1 then
      raise exception 'PRECIO_INVALIDO:%', v_nombre_item using errcode = 'P0001';
    end if;
  end loop;

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

  -- ── Items + opciones (misma transacción, sin EXCEPTION interno) ──
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
$function$;
