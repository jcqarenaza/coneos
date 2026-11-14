-- PROPUESTA (NO AUTORIZADA, NO APLICAR): corrección F7 de devolver_sabores_pedido — CTO 14/11.
-- Único cambio respecto a supabase/stock-sabores-kg.sql: después del UPDATE de stock_sabor se verifica ROW_COUNT; si no afectó EXACTAMENTE una fila
-- se lanza SABOR_SIN_STOCK ANTES de insertar el movimiento. La transacción revierte todo (ni stock ni libro cambian) y queda disponible para reintentar
-- tras corregir la causa. Misma firma, mismo lock, mismos permisos, mismo texto del detalle. No toca el modelo de stock ni el circuito de ventas.
-- REVERSIÓN: volver a ejecutar la definición de supabase/stock-sabores-kg.sql.
create or replace function public.devolver_sabores_pedido(p_empresa uuid, p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare m record; v_n int := 0; v_filas int;
begin
  perform pg_advisory_xact_lock(hashtextextended('sabor:' || p_pedido::text, 0));
  if not exists (select 1 from public.stock_sabor_movimientos where pedido_id = p_pedido and empresa_id = p_empresa and motivo = 'venta') then
    return jsonb_build_object('estado', 'sin_efecto'); end if;
  if exists (select 1 from public.stock_sabor_movimientos where pedido_id = p_pedido and empresa_id = p_empresa and motivo = 'devolucion') then
    return jsonb_build_object('estado', 'ya_devuelto'); end if;
  for m in select * from public.stock_sabor_movimientos where pedido_id = p_pedido and empresa_id = p_empresa and motivo = 'venta' order by opcion_id loop
    update public.stock_sabor set kg = kg + (-m.delta_kg), updated_at = now() where sucursal_id = m.sucursal_id and opcion_id = m.opcion_id;
    get diagnostics v_filas = row_count;
    if v_filas <> 1 then
      raise exception 'SABOR_SIN_STOCK:% (filas afectadas %)', m.opcion_id, v_filas using errcode = 'P0001'; end if;
    insert into public.stock_sabor_movimientos (empresa_id, sucursal_id, opcion_id, delta_kg, motivo, pedido_id, detalle)
      values (m.empresa_id, m.sucursal_id, m.opcion_id, -m.delta_kg, 'devolucion', p_pedido, 'Devolución por eliminación del pedido');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('estado', 'devuelto', 'movimientos', v_n);
end $fn$;
revoke all on function public.devolver_sabores_pedido(uuid,uuid) from public, anon, authenticated;
grant execute on function public.devolver_sabores_pedido(uuid,uuid) to service_role;
