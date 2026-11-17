CREATE OR REPLACE FUNCTION public.crear_arqueo_stock(p_empresa_id uuid, p_sucursal_id uuid, p_alcance text, p_contado_por text, p_observaciones text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_it      jsonb;
  v_f       numeric;
  v_n       integer;
  v_ok      integer;
  v_arq     uuid;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Defensa en profundidad: solo el servidor (service_role) puede ejecutarla.
  if coalesce(auth.role(), '') <> 'service_role' and session_user = 'authenticator' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_alcance is null or (p_alcance <> 'completo' and p_alcance not like 'categoria:%') then
    raise exception 'ALCANCE_INVALIDO' using errcode = 'P0001';
  end if;
  if p_observaciones is not null and length(p_observaciones) > 500 then
    raise exception 'OBSERVACIONES_INVALIDAS' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > 500 then
    raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';
  end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_it) is distinct from 'object'
       or jsonb_typeof(v_it->'producto_id') is distinct from 'string'
       or (v_it->>'producto_id') !~* v_uuid_re then
      raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_it->'fisico') is distinct from 'number' then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end if;
    v_f := (v_it->>'fisico')::numeric;
    if v_f < 0 or v_f > 1000000 or v_f <> trunc(v_f) then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end if;
  end loop;

  select count(distinct (e->>'producto_id')::uuid) into v_ok from jsonb_array_elements(p_items) e;
  if v_ok <> v_n then
    raise exception 'ITEMS_INVALIDOS' using errcode = 'P0001';       -- productos repetidos
  end if;

  if not exists (select 1 from sucursales where id = p_sucursal_id and empresa_id = p_empresa_id) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  select count(*) into v_ok
    from productos pr
   where pr.empresa_id = p_empresa_id and pr.activo = true and pr.controla_stock = true and pr.deleted_at is null
     and pr.id in (select (e->>'producto_id')::uuid from jsonb_array_elements(p_items) e);
  if v_ok <> v_n then
    raise exception 'PRODUCTO_INVALIDO' using errcode = 'P0001';
  end if;

  -- El índice único parcial decide la carrera: el segundo pendiente falla acá.
  begin
    insert into arqueos_stock (empresa_id, sucursal_id, alcance, contado_por, observaciones)
    values (p_empresa_id, p_sucursal_id, p_alcance, nullif(trim(p_contado_por), ''), nullif(trim(p_observaciones), ''))
    returning id into v_arq;
  exception when unique_violation then
    raise exception 'ARQUEO_PENDIENTE' using errcode = 'P0001';
  end;

  -- Teórico leído en ESTA transacción (snapshot consistente con el arqueo). Sin fila = 0.
  insert into arqueo_items (arqueo_id, producto_id, teorico, fisico)
  select v_arq,
         (e->>'producto_id')::uuid,
         coalesce(ps.cantidad, 0),
         (e->>'fisico')::numeric
    from jsonb_array_elements(p_items) e
    left join producto_stock ps
           on ps.producto_id = (e->>'producto_id')::uuid
          and ps.sucursal_id = p_sucursal_id
          and ps.empresa_id  = p_empresa_id;

  return jsonb_build_object('ok', true, 'arqueo_id', v_arq, 'cargados', v_n);
end;
$function$;
