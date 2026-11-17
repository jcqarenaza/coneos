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
      insert into public.producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo, updated_at)
      values (p_empresa, p_producto, p_sucursal, p_cantidad, 0, now());
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
end $function$
