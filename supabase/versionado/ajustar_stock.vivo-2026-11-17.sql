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
    insert into producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo, updated_at)
      values (p_empresa_id, p_producto_id, p_sucursal_id, v_new, 0, now())
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
