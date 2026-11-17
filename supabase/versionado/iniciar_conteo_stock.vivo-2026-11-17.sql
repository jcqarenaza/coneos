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
     where p.empresa_id = p_empresa_id and p.controla_stock is true and p.activo is true and p.deleted_at is null;
  return jsonb_build_object('lote_id', v_id, 'iniciado_at', v_ini,
    'items', coalesce((select jsonb_agg(jsonb_build_object('producto_id', b.producto_id, 'nombre', p.nombre, 'base', b.base,
                         'sin_alta', not exists (select 1 from producto_stock ps where ps.producto_id = b.producto_id and ps.sucursal_id = p_sucursal_id))
                       order by p.nombre, b.producto_id)
                 from stock_conteo_base b join productos p on p.id = b.producto_id where b.conteo_id = v_id), '[]'::jsonb));
end $function$;
