-- ============================================================
-- crear_pedido_stock — STOCK V2 (factor de consumo por presentación)
-- GO CTO "STOCK V2 FACTOR" (4/11/2026): AUTORIZADO PARA DESARROLLO,
-- NO AUTORIZADO PARA APLICAR EN SUPABASE. Este archivo NO se corrió en
-- ninguna base compartida; se probó solo en un Postgres local aislado.
--
-- Es el "v1.5" del GO. Como la función VIVA ya contiene un bloque
-- rotulado "v1.5 PROMOS", internamente se llama v1.6 para no confundir.
-- Base del diseño: la definición VIVA (crear_pedido_stock.vivo-2026-11-04.sql),
-- no el v1.4 del repo (desactualizado: le faltan promos y precio server-side).
--
-- CAMBIOS (todo lo demás es idéntico a la viva):
--   1. v_factores: UNA lectura de presentaciones.factor_stock para todo el carrito.
--   2. Validación FACTOR_STOCK_INVALIDO (entero >= 1) antes de descontar.
--   3. Descuento = Σ cantidad × factor por producto contable (mismo loop, mismo
--      orden por producto_id, mismo SIN_STOCK con rollback total).
--   4. pedido_items.factor_stock_snap grabado en el mismo INSERT, desde el
--      mismo mapa que usó el descuento (no se relee la presentación).
-- El log de movimientos sigue por unidades de stock consumidas (delta = -q).
--
-- ORDEN DE APLICACIÓN (cuando el CTO dé el GO):
--   1) stock-v2-factor-migracion.sql   2) este archivo   3) recién ahí el deploy
--   de la app (el campo "Consume del stock" del admin y la devolución nueva).
-- REVERSIÓN: stock-v2-factor-REVERSION.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_pedido_stock(p_empresa_id uuid, p_sucursal_id uuid, p_dispositivo_id uuid, p_items jsonb, p_metodo_pago text, p_origen text, p_tipo_pedido text, p_costo_envio numeric, p_datos_delivery jsonb, p_estado text, p_codigo_retiro text, p_mesa_cuenta_id uuid DEFAULT NULL::uuid, p_numero_mesa integer DEFAULT NULL::integer, p_pagado boolean DEFAULT NULL::boolean, p_nombre_cliente text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- ── v1.5: COMBOS/PROMOCIONES — validación set-based por grupo ──
  -- ANTES del lock: rechazo = cero persistencia (condición CTO 2).
  -- Coherencia de campos: promo_id, combo_ref y promo_slot_id van juntos.
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
    -- Un componente de combo es SIEMPRE una presentación real, cantidad 1
    -- (dos combos = dos combo_ref). Nada de accesorios ni combos de combos.
    if v_combo.sin_pres or v_combo.mala_cant then
      raise exception 'PROMO_COMPONENTE_INVALIDO' using errcode = 'P0001';
    end if;

    select * into v_promo from promociones
     where id = v_combo.pid and empresa_id = p_empresa_id and activo = true;
    if v_promo.id is null then
      raise exception 'PROMO_INVALIDA' using errcode = 'P0001';
    end if;
    -- Vigencia por fecha de SERVER (hora argentina, la misma del pedido)
    if (v_promo.vigencia_desde is not null and v_fecha < v_promo.vigencia_desde)
       or (v_promo.vigencia_hasta is not null and v_fecha > v_promo.vigencia_hasta) then
      raise exception 'PROMO_VENCIDA:%', v_promo.nombre using errcode = 'P0001';
    end if;

    -- Slots: bijección exacta — tantos ítems como slots, todos distintos
    select count(*) into v_slots_cnt from promo_slots where promo_id = v_combo.pid; select coalesce(sum(cantidad), 0) into v_cant_total from promo_slots where promo_id = v_combo.pid;
    if v_slots_cnt = 0 or (v_cant_total = v_slots_cnt and (v_combo.n <> v_slots_cnt or v_combo.slots_distintos <> v_slots_cnt)) or (v_cant_total <> v_slots_cnt and (v_combo.n <> v_cant_total or exists (select 1 from promo_slots s where s.promo_id = v_combo.pid and s.cantidad <> (select count(*) from jsonb_array_elements(p_items) ii where ii->>'combo_ref' = v_combo.ref::text and ii->>'promo_slot_id' = s.id::text)))) then
      raise exception 'PROMO_SLOTS_INVALIDOS:%', v_promo.nombre using errcode = 'P0001';
    end if;

    -- Cada componente: su slot pertenece a ESTA promo y su presentación
    -- está PERMITIDA en ESE slot (cadena de contexto, patrón v1.2)
    perform 1
      from jsonb_array_elements(p_items) i
      left join promo_slots s
        on s.id = (i->>'promo_slot_id')::uuid and s.promo_id = v_combo.pid
      left join promo_slot_presentaciones sp
        on sp.slot_id = s.id and sp.presentacion_id = (i->>'presentacion_id')::uuid
     where (i->>'combo_ref')::uuid = v_combo.ref
       and (s.id is null or sp.id is null);
    if found then
      raise exception 'PROMO_PRESENTACION_NO_PERMITIDA:%', v_promo.nombre using errcode = 'P0001';
    end if;

    -- Precio del grupo (condición CTO 1): Σ precio_snap de los hermanos
    -- == precio de la promo + adicionales PAGOS elegidos, recalculados
    -- acá mismo — igualdad estricta; el navegador no opina.
    select coalesce(sum(o.precio_adicional), 0) into v_adic_grupo
      from jsonb_array_elements(p_items) i
      cross join lateral jsonb_array_elements(coalesce(i->'opciones', '[]'::jsonb)) op
      join opciones o on o.id = (op->>'opcion_id')::uuid and o.empresa_id = p_empresa_id
     where (i->>'combo_ref')::uuid = v_combo.ref;
    if v_combo.suma is distinct from (v_promo.precio + v_adic_grupo) then
      raise exception 'PROMO_PRECIO_INVALIDO:%', v_promo.nombre using errcode = 'P0001';
    end if;
  end loop;

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
      -- v1.5: los componentes de COMBO validan su precio a nivel GRUPO
      -- (arriba, Σ == promo + adicionales); acá se saltea SOLO la
      -- igualdad por ítem — la cadena de opciones ya quedó validada.
      if coalesce(v_item->>'combo_ref', '') = '' then
        if (v_item->>'precio_snap')::numeric is distinct from (coalesce(v_precio_base, 0) + v_adicionales) then
          raise exception 'PRECIO_INVALIDO:%', v_nombre_item using errcode = 'P0001';
        end if;
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

  -- ── v1.6 STOCK V2: factor de consumo por presentación — UNA sola lectura ──
  -- El mismo mapa alimenta el descuento y el snapshot de pedido_items:
  -- si un admin cambia el factor a mitad de la transacción, lo descontado
  -- y lo grabado no pueden separarse (la devolución usa el snapshot).
  select coalesce(jsonb_object_agg(f.id::text, f.factor), '{}'::jsonb) into v_factores
    from (
      select distinct pres.id, pres.factor_stock as factor
        from jsonb_array_elements(p_items) i
        join presentaciones pres on pres.id = (i->>'presentacion_id')::uuid
          and pres.empresa_id = p_empresa_id
       where coalesce(i->>'presentacion_id', '') <> ''
    ) f;
  -- Decisión CTO: el factor es entero >= 1 (la base lo garantiza con CHECK;
  -- esto es el cinturón doble ante cualquier dato fuera de regla).
  if exists (
    select 1 from jsonb_each_text(v_factores) e
     where e.value::numeric <> trunc(e.value::numeric) or e.value::numeric < 1
  ) then
    raise exception 'FACTOR_STOCK_INVALIDO' using errcode = 'P0001';
  end if;

  -- ── STOCK: descuento atómico por producto contable ──
  -- v1.6: consumo = cantidad × factor_stock (un solo stock físico por producto).
  -- v1.5: los componentes de combo SON presentaciones reales → entran
  -- por este MISMO bloque, sin rama nueva (condición CTO 3: dos
  -- descuentos y dos movimientos en pizza+bebida, jamás un tercero).
  for r in
    select pr.id as producto_id, pr.nombre,
           sum((i->>'cantidad')::int * (v_factores->>(i->>'presentacion_id'))::numeric::int) as q
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
    v_movs := v_movs || jsonb_build_object('producto_id', r.producto_id, 'q', r.q);
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

  -- ── v1.3: LOG de los descuentos (misma transacción — si algo aborta, ni
  --    stock ni log quedan; el libro jamás miente) ──
  -- v1.4: el detalle lleva número y canal EN TEXTO — el libro cuenta la
  -- historia aunque el pedido se elimine después (el join ya no resolvería).
  insert into stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, pedido_id, detalle)
  select p_empresa_id, p_sucursal_id, (m->>'producto_id')::uuid, -((m->>'q')::int), 'venta', v_pedido_id,
    'Venta pedido #' || v_numero || ' · ' ||
    case
      when p_numero_mesa is not null then 'Mesa ' || p_numero_mesa
      when p_tipo_pedido = 'takeaway' then 'Take Away'
      when p_tipo_pedido = 'delivery' then 'Delivery'
      else 'Kiosco/Caja'
    end
  from jsonb_array_elements(v_movs) m;

  -- ── Items + opciones (misma transacción, sin EXCEPTION interno) ──
  -- v1.5: promo_id y combo_ref viajan al snapshot (identidad del combo
  -- para ticket/caja; condición CTO 4). El prorrateo es PRECIO cobrado:
  -- el kardex no se contamina (el log de stock va por cantidades).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into pedido_items (
      pedido_id, presentacion_id, nombre_producto_snap,
      nombre_presentacion_snap, precio_snap, cantidad, promo_id, combo_ref, promo_nombre_snap, promo_precio_snap,
      factor_stock_snap
    ) values (
      v_pedido_id,
      nullif(v_item->>'presentacion_id', '')::uuid,
      v_item->>'nombre_producto_snap',
      v_item->>'nombre_presentacion_snap',
      (v_item->>'precio_snap')::numeric,
      (v_item->>'cantidad')::int,
      nullif(v_item->>'promo_id', '')::uuid,
      nullif(v_item->>'combo_ref', '')::uuid,
      case when coalesce(v_item->>'promo_id','') <> '' then (select nombre from promociones where id = (v_item->>'promo_id')::uuid) end,
      case when coalesce(v_item->>'promo_id','') <> '' then (select precio from promociones where id = (v_item->>'promo_id')::uuid) end,
      -- v1.6: factor APLICADO (mismo mapa del descuento). NULL = ítem sin presentación (accesorio).
      case when coalesce(v_item->>'presentacion_id','') <> '' then (v_factores->>(v_item->>'presentacion_id'))::numeric end
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
