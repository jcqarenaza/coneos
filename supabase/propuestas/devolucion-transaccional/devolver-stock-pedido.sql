-- ══════════════════════════════════════════════════════════════════════
-- DEVOLUCIÓN TRANSACCIONAL E IDEMPOTENTE: devolver_stock_pedido
-- Orden CTO 4/11/2026 · punto 4.   PROPUESTA — NO APLICAR sin GO productivo.
--
-- PROBLEMA (hoy, /api/pedidos/eliminar): el flag stock_descontado se baja en
--   una llamada HTTP y el stock se devuelve en OTRAS llamadas (una por
--   producto). Si algo falla entre medio (timeout, corte, error de una RPC,
--   deploy) el flag queda en false con el stock sin devolver (o a medias) y
--   la devolución NO se reintenta: stock perdido sin rastro. Además las
--   respuestas de ajustar_stock hoy no se verifican.
-- SOLUCIÓN: UNA función, UNA transacción: flag + stock + libro, todo o nada.
--   1. Toma la fila del pedido FOR UPDATE (serializa dobles clicks/reintentos).
--   2. Si stock_descontado = false → no hace nada (devuelto=false). Idempotente.
--   3. Calcula por producto: Σ cantidad × coalesce(factor_stock_snap, 1)
--      (snapshot del pedido; NULL = pedido anterior a V2 = factor 1; jamás el
--      factor vigente) y recorre los productos ORDENADOS por producto_id.
--   4. Devuelve con ajustar_stock (misma puerta, mismo libro, mismo detalle).
--   5. Baja el flag EN LA MISMA transacción.
--   Si cualquier paso falla: rollback completo → flag sigue en true, nada se
--   devolvió, el reintento funciona. No toca pedidos que ya están en false ni
--   modifica ningún otro dato del pedido (los históricos quedan intactos).
-- PERMISOS: solo service_role (el endpoint ya usa el cliente admin).
-- DEPENDE DE: stock-bump-diferido.sql para no cruzarse con ventas (ver informe).
-- REVERSIÓN: devolver-stock-pedido-REVERSION.sql (drop function).
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.devolver_stock_pedido(p_empresa_id uuid, p_pedido_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ped record; r record; v_det text;
  v_movs integer := 0; v_unidades numeric := 0;
begin
  select id, empresa_id, sucursal_id, numero_pedido, numero_mesa, tipo_pedido, stock_descontado
    into v_ped
    from pedidos
   where id = p_pedido_id and empresa_id = p_empresa_id
   for update;
  if v_ped.id is null then
    raise exception 'PEDIDO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  -- Idempotencia: ya devuelto (o nunca descontó) → no-op, sin error
  if not v_ped.stock_descontado then
    return jsonb_build_object('devuelto', false, 'movimientos', 0, 'unidades', 0);
  end if;

  v_det := 'Devolución por eliminación del pedido #' || v_ped.numero_pedido || ' · ' ||
    case when v_ped.numero_mesa is not null then 'Mesa ' || v_ped.numero_mesa
         when v_ped.tipo_pedido = 'takeaway' then 'Take Away'
         when v_ped.tipo_pedido = 'delivery' then 'Delivery'
         else 'Kiosco/Caja' end;

  for r in
    select pr.id as producto_id,
           sum(it.cantidad * coalesce(it.factor_stock_snap, 1)) as q
      from pedido_items it
      join presentaciones pres on pres.id = it.presentacion_id
      join productos pr on pr.id = pres.producto_id and pr.controla_stock = true
     where it.pedido_id = p_pedido_id and it.presentacion_id is not null
     group by pr.id
     order by pr.id
  loop
    if r.q <> trunc(r.q) or r.q <= 0 then
      raise exception 'DEVOLUCION_NO_ENTERA:%', r.producto_id using errcode = 'P0001';
    end if;
    perform ajustar_stock(p_empresa_id, v_ped.sucursal_id, r.producto_id, r.q::integer,
                          'delta', 'devolucion', p_pedido_id, v_det);
    v_movs := v_movs + 1; v_unidades := v_unidades + r.q;
  end loop;

  update pedidos set stock_descontado = false where id = p_pedido_id;

  return jsonb_build_object('devuelto', true, 'movimientos', v_movs, 'unidades', v_unidades);
end; $function$;
REVOKE ALL ON FUNCTION public.devolver_stock_pedido(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.devolver_stock_pedido(uuid, uuid) TO service_role;
