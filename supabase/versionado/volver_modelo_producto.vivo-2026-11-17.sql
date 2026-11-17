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
    v_rest := public._restaurar_producto_stock(p_empresa_id, h.sucursal_id, p_producto_id, h.total_contado::int,
                'Reversion a modelo producto · ' || v_mot, p_usuario_id, p_operacion_id);
    select coalesce((select cantidad from public.producto_stock where producto_id = p_producto_id and sucursal_id = h.sucursal_id), 0) into v_saldo;
    insert into public.stock_rama_reversion (empresa_id, habilitacion_id, producto_id, sucursal_id, saldo_anterior_congelado, total_contado, saldo_restaurado, diferencia, operacion_id, usuario_id, movimiento_id)
    values (p_empresa_id, h.id, p_producto_id, h.sucursal_id, h.saldo_anterior, h.total_contado, v_saldo, v_saldo - h.saldo_anterior, p_operacion_id, p_usuario_id,
            nullif(v_rest->>'movimiento_id','')::uuid) returning id into v_rev;
    update public.stock_rama_habilitacion set estado = 'revertida', revertida_at = now() where id = h.id;
    v_list := v_list || jsonb_build_array(jsonb_build_object('sucursal_id', h.sucursal_id, 'saldo_anterior_congelado', h.saldo_anterior,
                'total_contado', h.total_contado, 'saldo_restaurado', v_saldo, 'diferencia', v_saldo - h.saldo_anterior, 'reversion_id', v_rev));
  end loop;

  v_res := jsonb_build_object('producto_id', p_producto_id, 'modelo', 'producto', 'controla_stock', v_ctl_prev,
                              'usuario_nombre', btrim(coalesce(p_usuario_nombre,'')), 'sucursales', v_list);
  perform public._completar_operacion(p_operacion_id, v_res);
  return v_res || jsonb_build_object('repetido', false);
end $function$
