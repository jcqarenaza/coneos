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
                 else pr.controla_stock = true end)
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
