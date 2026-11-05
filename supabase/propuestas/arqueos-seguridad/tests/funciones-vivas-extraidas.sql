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
-- GRANTS (proacl: postgres, authenticated, service_role; sin PUBLIC/anon)
REVOKE ALL ON FUNCTION public.ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.confirmar_arqueo_stock(p_empresa_id uuid, p_arqueo_id uuid, p_confirmado_por text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_arq     arqueos_stock%rowtype;
  v_it      record;
  v_n       integer := 0;
  v_fecha   text;
begin
  -- AUTORIZACIÓN: idéntica a ajustar_stock (paridad exacta, a propósito).
  --   · "es administrador de la empresa" = existe en usuarios_admin con esa empresa
  --     (auth_empresa_id() = p_empresa_id), o tiene rol SUPER_ADMIN.
  --   · NO se exige fila en usuario_admin_roles: hoy el admin de la empresa 'cecchetto' no tiene
  --     ninguna y confirma arqueos con ajustar_stock; exigirla lo dejaría afuera.
  --   · Un usuario autenticado que no está en usuarios_admin tiene auth_empresa_id() NULL
  --     → "is distinct from" da TRUE → FORBIDDEN.
  --   · No hay alcance por sucursal (ADMIN_SUCURSAL) igual que en ajustar_stock; hoy no existe
  --     ningún rol ADMIN_SUCURSAL en la base. Endurecerlo es una decisión aparte.
  --   · Sin sesión Supabase (anon) → sin permiso de ejecución (ver GRANT abajo).
  if session_user = 'authenticator' and coalesce(auth.role(), '') <> 'service_role' then
    if auth_rol() is distinct from 'SUPER_ADMIN'
       and auth_empresa_id() is distinct from p_empresa_id then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  -- RESERVA: el lock de fila serializa confirmaciones simultáneas del MISMO arqueo.
  -- La segunda espera, y al despertar ve estado='confirmado' → no repite nada.
  select * into v_arq from arqueos_stock
   where id = p_arqueo_id and empresa_id = p_empresa_id
   for update;
  if not found then
    raise exception 'ARQUEO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if v_arq.estado = 'confirmado' then
    return jsonb_build_object('ok', true, 'ya_confirmado', true, 'ajustados', 0);   -- idempotente
  end if;
  if v_arq.estado <> 'pendiente' then
    raise exception 'ARQUEO_NO_PENDIENTE' using errcode = 'P0001';
  end if;

  -- Validar ANTES de tocar stock (ajustar_stock recibe enteros)
  if exists (select 1 from arqueo_items
              where arqueo_id = p_arqueo_id and not descartado and not ajustado
                and coalesce(diferencia, 0) <> 0 and diferencia <> trunc(diferencia)) then
    raise exception 'DIFERENCIA_NO_ENTERA' using errcode = 'P0001';
  end if;

  v_fecha := to_char(v_arq.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY');

  -- Orden determinístico por producto (menos riesgo de deadlock entre arqueos)
  for v_it in
    select id, producto_id, diferencia from arqueo_items
     where arqueo_id = p_arqueo_id and not descartado and not ajustado and coalesce(diferencia, 0) <> 0
     order by producto_id, id
     for update   -- bloquea los ítems: si el admin los descarta a la vez, uno espera al otro y se re-evalúa el filtro
  loop
    perform ajustar_stock(
      p_empresa_id, v_arq.sucursal_id, v_it.producto_id, v_it.diferencia::integer,
      'delta', 'arqueo', null,
      'Arqueo ' || v_fecha || ' — dif ' || case when v_it.diferencia > 0 then '+' else '' end
        || trunc(v_it.diferencia)::text
        || coalesce(' · ' || nullif(v_arq.observaciones, ''), '')
    );
    update arqueo_items set ajustado = true where id = v_it.id;
    v_n := v_n + 1;
  end loop;

  update arqueos_stock
     set estado = 'confirmado',
         confirmado_por = coalesce(nullif(trim(p_confirmado_por), ''), 'admin'),
         confirmado_at = now()
   where id = p_arqueo_id;

  return jsonb_build_object('ok', true, 'ya_confirmado', false, 'ajustados', v_n);
  -- Cualquier excepción en este bloque revierte TODO: ajustes, marcas y cierre.
end;
$function$;
-- GRANTS (proacl: postgres, authenticated, service_role; sin PUBLIC/anon)
REVOKE ALL ON FUNCTION public.confirmar_arqueo_stock(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_arqueo_stock(uuid,uuid,text) TO authenticated, service_role;


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
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.crear_arqueo_stock(uuid,uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_arqueo_stock(uuid,uuid,text,text,text,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.trg_bump_catalogo()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  r record;
  v_suc uuid;
  v_emp uuid;
begin
  r := coalesce(new, old);
  -- to_jsonb para leer columnas sin asumir el tipo de tabla
  v_suc := nullif(to_jsonb(r)->>'sucursal_id', '')::uuid;
  v_emp := nullif(to_jsonb(r)->>'empresa_id', '')::uuid;
  if v_suc is not null then
    perform bump_catalogo_sucursal(v_suc, v_emp);
  elsif v_emp is not null then
    perform bump_catalogo_empresa(v_emp);
  end if;
  return coalesce(new, old);
end $function$;
-- GRANTS (proacl por defecto: PUBLIC, anon, authenticated, service_role, postgres) — sin REVOKE


CREATE OR REPLACE FUNCTION public.bump_catalogo_empresa(p_empresa uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update catalogo_version set version = version + 1, updated_at = now()
  where empresa_id = p_empresa;
  -- sucursales sin fila (creadas antes de la semilla o futuras): sembrar
  insert into catalogo_version (sucursal_id, empresa_id)
  select id, empresa_id from sucursales
  where empresa_id = p_empresa
  on conflict (sucursal_id) do nothing;
end $function$;
-- GRANTS (proacl: postgres, authenticated, service_role; sin PUBLIC/anon)
REVOKE ALL ON FUNCTION public.bump_catalogo_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_catalogo_empresa(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.bump_catalogo_sucursal(p_sucursal uuid, p_empresa uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into catalogo_version (sucursal_id, empresa_id, version, updated_at)
  values (p_sucursal, p_empresa, 1, now())
  on conflict (sucursal_id)
  do update set version = catalogo_version.version + 1, updated_at = now();
end $function$;
-- GRANTS (proacl: postgres, authenticated, service_role; sin PUBLIC/anon)
REVOKE ALL ON FUNCTION public.bump_catalogo_sucursal(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_catalogo_sucursal(uuid,uuid) TO authenticated, service_role;

