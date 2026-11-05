-- REFERENCIA VERSIONADA — volcado de la base el 2026-11-04 — NO ES MIGRACIÓN, NO APLICAR
-- Proyecto Supabase: wpiwjpvjqshsgrxxwsld (ConeOS). Schema public.
-- Cuerpos EXACTOS (pg_get_functiondef) de las funciones de stock, artículos, compras,
-- remitos, órdenes de compra/pago, comprobantes de compra, cheques y arqueo.
-- EXCLUIDA a pedido: crear_pedido_stock (la maneja otra persona).
-- Los saltos de línea originales en la base son CRLF; acá se guardan como LF
-- (la verificación md5 normaliza con replace(..., E'\r', '')).
-- Tras cada función van los GRANT/REVOKE de EXECUTE vigentes (de pg_proc.proacl).
-- Funciones de trigger y helpers de catálogo/auth: ver 05-funciones-trigger-y-auth.sql.

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

CREATE OR REPLACE FUNCTION public.anular_orden_pago(p_empresa_id uuid, p_orden_pago_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_op record; v_cid uuid;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;
  update ordenes_pago_proveedor
     set anulada = true, fecha_anulacion = current_date, motivo_anulacion = trim(p_motivo)
   where id = p_orden_pago_id and empresa_id = p_empresa_id and anulada = false
  returning * into v_op;
  if v_op.id is null then raise exception 'OP_NO_ANULABLE' using errcode = 'P0001'; end if;

  perform 1 from cheques where orden_pago_id = p_orden_pago_id and empresa_id = p_empresa_id
    and estado = 'cobrado';
  if found then raise exception 'OP_CHEQUE_COBRADO' using errcode = 'P0001'; end if;

  update cheques set estado = 'anulado', updated_at = now(),
    notas = coalesce(notas || ' · ', '') || 'Anulado con OP-' || lpad(v_op.numero::text, 4, '0')
   where orden_pago_id = p_orden_pago_id and empresa_id = p_empresa_id and estado = 'emitido';

  -- Contraefecto en CC: mismo origen (la OP), sentido inverso
  insert into cuenta_corriente_proveedor (empresa_id, proveedor_id, tipo, monto, orden_pago_id, detalle)
  values (p_empresa_id, v_op.proveedor_id, 'debe', v_op.total, p_orden_pago_id,
          'Anulación OP-' || lpad(v_op.numero::text, 4, '0') || ': ' || trim(p_motivo));

  -- Los comprobantes que la OP tocaba recuperan su pendiente
  for v_cid in select distinct comprobante_id from ordenes_pago_imputaciones
               where orden_pago_id = p_orden_pago_id and empresa_id = p_empresa_id loop
    perform recalcular_estado_comprobante(p_empresa_id, v_cid);
  end loop;
  return jsonb_build_object('ok', true, 'numero', v_op.numero);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.anular_orden_pago(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anular_orden_pago(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.aplicar_credito_op(p_empresa_id uuid, p_orden_pago_id uuid, p_comprobante_id uuid, p_monto numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_op record; v_credito numeric; v_tipo text; v_prov uuid; v_estado text; v_pend numeric;
begin
  select * into v_op from ordenes_pago_proveedor
   where id = p_orden_pago_id and empresa_id = p_empresa_id and anulada = false
   for update;
  if v_op.id is null then raise exception 'OP_INVALIDA' using errcode = 'P0001'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'IMPUTACION_INVALIDA' using errcode = 'P0001'; end if;

  -- Crédito disponible de ESA OP = total − neto ya imputado por ella
  select v_op.total - coalesce(sum(case when c.tipo = 'factura' then i.monto else -i.monto end), 0)
    into v_credito
    from ordenes_pago_imputaciones i
    join comprobantes_compra c on c.id = i.comprobante_id
   where i.orden_pago_id = p_orden_pago_id and i.empresa_id = p_empresa_id;
  if p_monto > v_credito then raise exception 'CREDITO_INSUFICIENTE' using errcode = 'P0001'; end if;

  select tipo, proveedor_id, estado into v_tipo, v_prov, v_estado
    from comprobantes_compra where id = p_comprobante_id and empresa_id = p_empresa_id;
  if v_tipo is null or v_tipo <> 'factura' then raise exception 'COMPROBANTE_INVALIDO' using errcode = 'P0001'; end if;
  if v_prov <> v_op.proveedor_id then raise exception 'COMPROBANTE_DE_OTRO_PROVEEDOR' using errcode = 'P0001'; end if;
  if v_estado = 'anulada' then raise exception 'COMPROBANTE_ANULADO' using errcode = 'P0001'; end if;
  v_pend := pendiente_comprobante(p_empresa_id, p_comprobante_id);
  if p_monto > v_pend then raise exception 'IMPUTACION_SUPERA_PENDIENTE' using errcode = 'P0001'; end if;

  insert into ordenes_pago_imputaciones (empresa_id, orden_pago_id, comprobante_id, monto)
  values (p_empresa_id, p_orden_pago_id, p_comprobante_id, p_monto);
  perform recalcular_estado_comprobante(p_empresa_id, p_comprobante_id);
  return jsonb_build_object('ok', true, 'credito_restante', v_credito - p_monto);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.aplicar_credito_op(uuid,uuid,uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicar_credito_op(uuid,uuid,uuid,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.cobrar_cheque(p_empresa_id uuid, p_cheque_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  update cheques set estado = 'cobrado', updated_at = now()
   where id = p_cheque_id and empresa_id = p_empresa_id and estado = 'emitido'
  returning numero into v_n;
  if v_n is null then raise exception 'CHEQUE_NO_COBRABLE' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true, 'numero', v_n);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.cobrar_cheque(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cobrar_cheque(uuid,uuid) TO service_role;

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

CREATE OR REPLACE FUNCTION public.crear_orden_compra(p_empresa_id uuid, p_proveedor_id uuid, p_sucursal_id uuid, p_observaciones text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_numero integer;
  v_oc_id uuid;
  v_item jsonb;
  v_cant numeric;
  v_costo numeric;
begin
  -- ── Guardias server-authoritative (empresa cruzada = rechazo) ──
  -- Proveedor: de la empresa y ACTIVO
  perform 1 from proveedores
    where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true;
  if not found then
    raise exception 'PROVEEDOR_INVALIDO' using errcode = 'P0001';
  end if;

  -- Destino: sucursal de la empresa, o NULL (central)
  if p_sucursal_id is not null then
    perform 1 from sucursales
      where id = p_sucursal_id and empresa_id = p_empresa_id;
    if not found then
      raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
    end if;
  end if;

  -- Al menos un renglón
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'SIN_ITEMS' using errcode = 'P0001';
  end if;

  -- Renglones: artículo activo de la empresa · presentación (si viene)
  -- activa y DE ESE artículo · cantidad > 0 · costo previsto >= 0 si viene
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    perform 1 from articulos
      where id = (v_item->>'articulo_id')::uuid
        and empresa_id = p_empresa_id and activo = true and deleted_at is null;
    if not found then
      raise exception 'ARTICULO_INVALIDO' using errcode = 'P0001';
    end if;

    if coalesce(v_item->>'presentacion_id', '') <> '' then
      perform 1 from articulo_presentaciones_compra
        where id = (v_item->>'presentacion_id')::uuid
          and empresa_id = p_empresa_id
          and articulo_id = (v_item->>'articulo_id')::uuid
          and activo = true;
      if not found then
        raise exception 'PRESENTACION_INVALIDA' using errcode = 'P0001';
      end if;
    end if;

    v_cant := (v_item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end if;

    if coalesce(v_item->>'costo_previsto', '') <> '' then
      v_costo := (v_item->>'costo_previsto')::numeric;
      if v_costo is null or v_costo < 0 then
        raise exception 'COSTO_INVALIDO' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- ── Numeración serializada por empresa (advisory lock en LA MISMA
  --    transacción del insert — la race del MAX+1 no existe) ──
  perform pg_advisory_xact_lock(hashtext('oc_' || p_empresa_id::text));

  select coalesce(max(numero), 0) + 1 into v_numero
    from ordenes_compra where empresa_id = p_empresa_id;

  insert into ordenes_compra (empresa_id, proveedor_id, sucursal_id, numero, estado, observaciones)
  values (p_empresa_id, p_proveedor_id, p_sucursal_id, v_numero, 'abierta', nullif(trim(coalesce(p_observaciones,'')), ''))
  returning id into v_oc_id;

  insert into ordenes_compra_items (empresa_id, orden_compra_id, articulo_id, presentacion_id, cantidad, costo_previsto)
  select p_empresa_id, v_oc_id,
    (i->>'articulo_id')::uuid,
    nullif(i->>'presentacion_id','')::uuid,
    (i->>'cantidad')::numeric,
    nullif(i->>'costo_previsto','')::numeric
  from jsonb_array_elements(p_items) i;

  return jsonb_build_object('id', v_oc_id, 'numero', v_numero);
end;
$function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.crear_orden_compra(uuid,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_orden_compra(uuid,uuid,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crear_remito_borrador(p_empresa_id uuid, p_proveedor_id uuid, p_sucursal_id uuid, p_orden_compra_id uuid, p_numero_proveedor text, p_observaciones text, p_tipo text DEFAULT 'recepcion'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_numero integer;
  v_id uuid;
begin
  if p_tipo not in ('recepcion', 'devolucion') then
    raise exception 'TIPO_INVALIDO' using errcode = 'P0001';
  end if;

  -- La devolución no viaja contra OC
  if p_tipo = 'devolucion' and p_orden_compra_id is not null then
    raise exception 'DEVOLUCION_SIN_OC' using errcode = 'P0001';
  end if;

  perform 1 from proveedores
    where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true;
  if not found then
    raise exception 'PROVEEDOR_INVALIDO' using errcode = 'P0001';
  end if;

  perform 1 from sucursales
    where id = p_sucursal_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  if p_orden_compra_id is not null then
    perform 1 from ordenes_compra
      where id = p_orden_compra_id and empresa_id = p_empresa_id
        and proveedor_id = p_proveedor_id
        and estado in ('abierta', 'parcial');
    if not found then
      raise exception 'OC_INVALIDA' using errcode = 'P0001';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('remito_' || p_empresa_id::text));

  select coalesce(max(numero), 0) + 1 into v_numero
    from remitos_compra where empresa_id = p_empresa_id;

  insert into remitos_compra (empresa_id, proveedor_id, sucursal_id, orden_compra_id,
    numero, numero_proveedor, tipo, estado, observaciones)
  values (p_empresa_id, p_proveedor_id, p_sucursal_id, p_orden_compra_id,
    v_numero, nullif(trim(coalesce(p_numero_proveedor,'')), ''), p_tipo, 'borrador',
    nullif(trim(coalesce(p_observaciones,'')), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'tipo', p_tipo);
end;
$function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.crear_remito_borrador(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_remito_borrador(uuid,uuid,uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.crear_remito_borrador(p_empresa_id uuid, p_proveedor_id uuid, p_sucursal_id uuid, p_orden_compra_id uuid, p_numero_proveedor text, p_observaciones text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_numero integer;
  v_id uuid;
begin
  -- Guardias (empresa cruzada = rechazo)
  perform 1 from proveedores
    where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true;
  if not found then
    raise exception 'PROVEEDOR_INVALIDO' using errcode = 'P0001';
  end if;

  perform 1 from sucursales
    where id = p_sucursal_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;

  if p_orden_compra_id is not null then
    -- La OC debe ser de la empresa, DEL MISMO proveedor y recibible
    perform 1 from ordenes_compra
      where id = p_orden_compra_id and empresa_id = p_empresa_id
        and proveedor_id = p_proveedor_id
        and estado in ('abierta', 'parcial');
    if not found then
      raise exception 'OC_INVALIDA' using errcode = 'P0001';
    end if;
  end if;

  -- Numeración serializada por empresa
  perform pg_advisory_xact_lock(hashtext('remito_' || p_empresa_id::text));

  select coalesce(max(numero), 0) + 1 into v_numero
    from remitos_compra where empresa_id = p_empresa_id;

  insert into remitos_compra (empresa_id, proveedor_id, sucursal_id, orden_compra_id,
    numero, numero_proveedor, tipo, estado, observaciones)
  values (p_empresa_id, p_proveedor_id, p_sucursal_id, p_orden_compra_id,
    v_numero, nullif(trim(coalesce(p_numero_proveedor,'')), ''), 'recepcion', 'borrador',
    nullif(trim(coalesce(p_observaciones,'')), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.crear_remito_borrador(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_remito_borrador(uuid,uuid,uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.ingresar_remito_stock(p_empresa_id uuid, p_remito_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rem record; v_li record; v_factor numeric; v_cant_op numeric;
  v_costo_bulto numeric; v_costo_u numeric; v_sign integer; v_motivo text;
  v_lineas integer := 0; v_oc_estado text := null; v_pend integer;
  v_pack jsonb := '[]'::jsonb; v_res jsonb;
begin
  -- BLINDAJE 2: claim atómico
  update remitos_compra
     set estado = 'confirmado', confirmado_at = now()
   where id = p_remito_id and empresa_id = p_empresa_id
     and estado = 'borrador' and tipo in ('recepcion', 'devolucion')
  returning * into v_rem;
  if v_rem.id is null then raise exception 'REMITO_NO_CONFIRMABLE' using errcode = 'P0001'; end if;

  v_sign := case when v_rem.tipo = 'devolucion' then -1 else 1 end;
  v_motivo := case when v_rem.tipo = 'devolucion' then 'devolucion_compra' else 'compra' end;

  perform 1 from remitos_compra_items where remito_id = p_remito_id and empresa_id = p_empresa_id;
  if not found then raise exception 'SIN_LINEAS' using errcode = 'P0001'; end if;

  for v_li in
    select i.* from remitos_compra_items i
     where i.remito_id = p_remito_id and i.empresa_id = p_empresa_id
  loop
    if v_li.cantidad is null or v_li.cantidad <= 0 then
      raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001';
    end if;
    -- BLINDAJE 1: factor congelado del VIVO al confirmar
    if v_li.presentacion_id is not null then
      select factor into v_factor from articulo_presentaciones_compra
       where id = v_li.presentacion_id and empresa_id = p_empresa_id and articulo_id = v_li.articulo_id;
      if v_factor is null then raise exception 'PRESENTACION_INVALIDA' using errcode = 'P0001'; end if;
    else
      v_factor := 1;
    end if;
    v_cant_op := v_li.cantidad * v_factor;
    v_costo_bulto := coalesce(v_li.costo_unitario, 0) * coalesce(v_li.factor_snap, 1);
    v_costo_u := case when v_factor > 0 then v_costo_bulto / v_factor else 0 end;

    update remitos_compra_items
       set factor_snap = v_factor, cantidad_operativa = v_cant_op, costo_unitario = v_costo_u
     where id = v_li.id and empresa_id = p_empresa_id;

    v_lineas := v_lineas + 1;
    v_pack := v_pack || jsonb_build_object('articulo_id', v_li.articulo_id,
      'cantidad_operativa', v_cant_op, 'costo_unitario', v_costo_u);
  end loop;

  -- EL ÚNICO ESCRITOR
  v_res := _ingresar_compra_stock(p_empresa_id, v_rem.sucursal_id, v_sign, v_motivo,
    p_remito_id, null, 'REM-' || lpad(v_rem.numero::text, 4, '0'), v_pack);

  -- OC avanza SOLO en recepción (idéntico a v3.1)
  if v_rem.tipo = 'recepcion' and v_rem.orden_compra_id is not null then
    select count(*) into v_pend
      from ordenes_compra_items oi
     where oi.orden_compra_id = v_rem.orden_compra_id and oi.empresa_id = p_empresa_id
       and oi.cantidad > coalesce((
         select sum(ri.cantidad) from remitos_compra_items ri
           join remitos_compra r on r.id = ri.remito_id
          where r.orden_compra_id = v_rem.orden_compra_id and r.empresa_id = p_empresa_id
            and r.estado = 'confirmado' and r.tipo = 'recepcion'
            and ri.articulo_id = oi.articulo_id
            and coalesce(ri.presentacion_id::text, '-') = coalesce(oi.presentacion_id::text, '-')
       ), 0);
    v_oc_estado := case when v_pend = 0 then 'recibida' else 'parcial' end;
    update ordenes_compra set estado = v_oc_estado
     where id = v_rem.orden_compra_id and empresa_id = p_empresa_id and estado in ('abierta', 'parcial');
  end if;

  return jsonb_build_object('remito', v_rem.numero, 'tipo', v_rem.tipo, 'lineas', v_lineas,
    'unidades', coalesce((v_res->>'unidades')::numeric, 0), 'oc_estado', v_oc_estado);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.ingresar_remito_stock(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingresar_remito_stock(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pendiente_comprobante(p_empresa_id uuid, p_comprobante_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select c.total - coalesce((
    select sum(i.monto) from ordenes_pago_imputaciones i
    join ordenes_pago_proveedor op on op.id = i.orden_pago_id
    where i.comprobante_id = p_comprobante_id and i.empresa_id = p_empresa_id
      and op.anulada = false), 0)
  from comprobantes_compra c
  where c.id = p_comprobante_id and c.empresa_id = p_empresa_id;
$function$;
-- GRANTS (proacl por defecto: PUBLIC, anon, authenticated, service_role, postgres) — sin REVOKE
-- (EXECUTE a PUBLIC es el default de Postgres al crear la función; no hace falta GRANT explícito)

CREATE OR REPLACE FUNCTION public.rebotar_cheque(p_empresa_id uuid, p_cheque_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  update cheques set estado = 'rebotado', updated_at = now()
   where id = p_cheque_id and empresa_id = p_empresa_id and estado = 'emitido'
  returning numero into v_n;
  if v_n is null then raise exception 'CHEQUE_NO_REBOTABLE' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true, 'numero', v_n);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.rebotar_cheque(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebotar_cheque(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.recalcular_estado_comprobante(p_empresa_id uuid, p_comprobante_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_pend numeric; v_total numeric;
begin
  select total into v_total from comprobantes_compra
   where id = p_comprobante_id and empresa_id = p_empresa_id and estado <> 'anulada';
  if v_total is null then return; end if;
  v_pend := pendiente_comprobante(p_empresa_id, p_comprobante_id);
  update comprobantes_compra
     set estado = case when v_pend <= 0 then 'pagada'
                       when v_pend < v_total then 'parcial'
                       else 'pendiente' end
   where id = p_comprobante_id and empresa_id = p_empresa_id and estado <> 'anulada';
end; $function$;
-- GRANTS (proacl por defecto: PUBLIC, anon, authenticated, service_role, postgres) — sin REVOKE

CREATE OR REPLACE FUNCTION public.registrar_factura_compra(p_empresa_id uuid, p_proveedor_id uuid, p_letra text, p_numero_proveedor text, p_fecha date, p_neto numeric, p_iva numeric, p_total numeric, p_items jsonb, p_remito_ids uuid[], p_observaciones text, p_sucursal_id uuid DEFAULT NULL::uuid, p_cae text DEFAULT NULL::text, p_vencimiento date DEFAULT NULL::date, p_recepcionar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return _registrar_comprobante_compra(p_empresa_id, p_proveedor_id, 'factura', p_letra,
    p_numero_proveedor, p_fecha, p_neto, p_iva, p_total, p_items, p_remito_ids, 'recepcion',
    p_observaciones, p_sucursal_id, p_cae, p_vencimiento, p_recepcionar);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.registrar_factura_compra(uuid,uuid,text,text,date,numeric,numeric,numeric,jsonb,uuid[],text,uuid,text,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_factura_compra(uuid,uuid,text,text,date,numeric,numeric,numeric,jsonb,uuid[],text,uuid,text,date,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_nc_compra(p_empresa_id uuid, p_proveedor_id uuid, p_letra text, p_numero_proveedor text, p_fecha date, p_neto numeric, p_iva numeric, p_total numeric, p_items jsonb, p_remito_ids uuid[], p_observaciones text, p_sucursal_id uuid DEFAULT NULL::uuid, p_cae text DEFAULT NULL::text, p_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- NC: SIEMPRE sin recepción (V1 — orden CTO: la física va por Remitos→Devolución)
  return _registrar_comprobante_compra(p_empresa_id, p_proveedor_id, 'nota_credito', p_letra,
    p_numero_proveedor, p_fecha, p_neto, p_iva, p_total, p_items, p_remito_ids, 'devolucion',
    p_observaciones, p_sucursal_id, p_cae, p_vencimiento, false);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.registrar_nc_compra(uuid,uuid,text,text,date,numeric,numeric,numeric,jsonb,uuid[],text,uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_nc_compra(uuid,uuid,text,text,date,numeric,numeric,numeric,jsonb,uuid[],text,uuid,text,date) TO service_role;

CREATE OR REPLACE FUNCTION public._ingresar_compra_stock(p_empresa_id uuid, p_sucursal_id uuid, p_sign integer, p_motivo text, p_remito_id uuid, p_comprobante_id uuid, p_detalle_prefijo text, p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_it jsonb; v_art record; v_cant_op numeric; v_costo_u numeric;
  v_unidades numeric := 0; v_movs integer := 0; v_actual numeric;
begin
  -- Exactamente UN origen (la base lo re-verifica igual: cinturón doble)
  if (p_remito_id is not null)::int + (p_comprobante_id is not null)::int <> 1 then
    raise exception 'ORIGEN_INVALIDO' using errcode = 'P0001';
  end if;
  if p_motivo = 'devolucion_compra' and p_comprobante_id is not null then
    raise exception 'DEVOLUCION_POR_FACTURA' using errcode = 'P0001';
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    select a.id, a.producto_id as prod_vinculado, a.controla_stock, a.nombre as art_nombre
      into v_art
      from articulos a
     where a.id = (v_it->>'articulo_id')::uuid and a.empresa_id = p_empresa_id
       and a.activo = true and a.deleted_at is null;
    if v_art.id is null then raise exception 'ARTICULO_INVALIDO' using errcode = 'P0001'; end if;

    v_cant_op := (v_it->>'cantidad_operativa')::numeric;
    v_costo_u := coalesce((v_it->>'costo_unitario')::numeric, 0);
    if v_cant_op is null or v_cant_op <= 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;

    if not v_art.controla_stock then continue; end if;

    -- Regla del entero de venta (T4-D2): la ficha de VENTA no fracciona
    if v_art.prod_vinculado is not null and v_cant_op <> trunc(v_cant_op) then
      raise exception 'LINEA_NO_ENTERA' using errcode = 'P0001';
    end if;

    v_unidades := v_unidades + v_cant_op;

    if v_art.prod_vinculado is not null then
      -- ── Ficha de VENTA ──
      if p_sign < 0 then
        select cantidad into v_actual from producto_stock
         where producto_id = v_art.prod_vinculado and sucursal_id = p_sucursal_id
           and empresa_id = p_empresa_id;
        if coalesce(v_actual, 0) < v_cant_op then
          raise exception 'DEVOLUCION_SIN_STOCK' using errcode = 'P0001';
        end if;
        -- UPDATE directo (gotcha del upsert negativo — bug cazado en G2)
        update producto_stock
           set cantidad = cantidad - v_cant_op::integer, updated_at = now()
         where producto_id = v_art.prod_vinculado and sucursal_id = p_sucursal_id
           and empresa_id = p_empresa_id;
      else
        insert into producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo)
        values (p_empresa_id, v_art.prod_vinculado, p_sucursal_id, v_cant_op::integer, 0)
        on conflict (producto_id, sucursal_id)
        do update set cantidad = producto_stock.cantidad + excluded.cantidad, updated_at = now();
      end if;
      insert into stock_movimientos (empresa_id, sucursal_id, producto_id, articulo_id,
        delta, motivo, remito_id, comprobante_compra_id, costo_unitario, detalle)
      values (p_empresa_id, p_sucursal_id, v_art.prod_vinculado, v_art.id,
        (p_sign * v_cant_op)::integer, p_motivo, p_remito_id, p_comprobante_id, v_costo_u,
        p_detalle_prefijo || ' · ' || v_art.art_nombre);
    else
      -- ── Ficha de COMPRA (insumos: fraccionan libres) ──
      if p_sign < 0 then
        select cantidad into v_actual from articulo_stock
         where articulo_id = v_art.id and sucursal_id = p_sucursal_id and empresa_id = p_empresa_id;
        if coalesce(v_actual, 0) < v_cant_op then
          raise exception 'DEVOLUCION_SIN_STOCK' using errcode = 'P0001';
        end if;
        update articulo_stock
           set cantidad = cantidad - v_cant_op, updated_at = now()
         where articulo_id = v_art.id and sucursal_id = p_sucursal_id and empresa_id = p_empresa_id;
      else
        insert into articulo_stock (empresa_id, articulo_id, sucursal_id, cantidad, stock_minimo)
        values (p_empresa_id, v_art.id, p_sucursal_id, v_cant_op, 0)
        on conflict (articulo_id, sucursal_id)
        do update set cantidad = articulo_stock.cantidad + excluded.cantidad, updated_at = now();
      end if;
      insert into stock_movimientos (empresa_id, sucursal_id, producto_id, articulo_id,
        delta, motivo, remito_id, comprobante_compra_id, costo_unitario, detalle)
      values (p_empresa_id, p_sucursal_id, null, v_art.id,
        p_sign * v_cant_op, p_motivo, p_remito_id, p_comprobante_id, v_costo_u,
        p_detalle_prefijo || ' · ' || v_art.art_nombre);
    end if;
    v_movs := v_movs + 1;
  end loop;

  return jsonb_build_object('unidades', v_unidades, 'movimientos', v_movs);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public._ingresar_compra_stock(uuid,uuid,integer,text,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._ingresar_compra_stock(uuid,uuid,integer,text,uuid,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._registrar_comprobante_compra(p_empresa_id uuid, p_proveedor_id uuid, p_tipo text, p_letra text, p_numero_proveedor text, p_fecha date, p_neto numeric, p_iva numeric, p_total numeric, p_items jsonb, p_remito_ids uuid[], p_tipo_remito text, p_observaciones text, p_sucursal_id uuid, p_cae text, p_vencimiento date, p_recepcionar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_it jsonb; v_rid uuid; v_prov uuid; v_trem text; v_estado text;
  v_desc text; v_cant numeric; v_precio numeric; v_art uuid; v_suma numeric := 0;
  v_pres uuid; v_factor numeric; v_cant_op numeric; v_ingresa boolean;
  v_pack jsonb := '[]'::jsonb; v_res jsonb; v_num_fmt text;
begin
  perform 1 from proveedores where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true;
  if not found then raise exception 'PROVEEDOR_INVALIDO' using errcode = 'P0001'; end if;
  if coalesce(trim(p_numero_proveedor), '') = '' then raise exception 'NUMERO_REQUERIDO' using errcode = 'P0001'; end if;
  if p_total is null or p_total <= 0 then raise exception 'TOTAL_INVALIDO' using errcode = 'P0001'; end if;
  if p_neto is null or p_neto <= 0 then raise exception 'NETO_INVALIDO' using errcode = 'P0001'; end if;
  if p_iva is null or p_iva < 0 then raise exception 'IVA_INVALIDO' using errcode = 'P0001'; end if;
  if p_sucursal_id is not null then
    perform 1 from sucursales where id = p_sucursal_id and empresa_id = p_empresa_id;
    if not found then raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001'; end if;
  end if;
  if p_vencimiento is not null and p_vencimiento < coalesce(p_fecha, current_date) then
    raise exception 'VENCIMIENTO_INVALIDO' using errcode = 'P0001';
  end if;
  -- S5 · EXCLUYENTE: o entra por remitos o entra directo — jamás ambos
  if p_recepcionar and p_remito_ids is not null and array_length(p_remito_ids, 1) > 0 then
    raise exception 'RECEPCION_DOBLE' using errcode = 'P0001';
  end if;
  if p_recepcionar and p_tipo <> 'factura' then
    raise exception 'RECEPCION_SOLO_FACTURA' using errcode = 'P0001';
  end if;
  if p_recepcionar and p_sucursal_id is null then
    raise exception 'SUCURSAL_REQUERIDA' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'SIN_RENGLONES' using errcode = 'P0001';
  end if;

  -- Validación de renglones + suma del neto (R7 bloqueo intacto).
  -- El PRECIO es del papel (por presentación); el costo del stock se
  -- deriva: precio / factor (precisión CTO: no se mezclan).
  for v_it in select * from jsonb_array_elements(p_items) loop
    v_desc := trim(coalesce(v_it->>'descripcion', ''));
    v_cant := (v_it->>'cantidad')::numeric;
    v_precio := (v_it->>'precio_unitario')::numeric;
    v_art := nullif(v_it->>'articulo_id', '')::uuid;
    if v_desc = '' then raise exception 'RENGLON_SIN_DESCRIPCION' using errcode = 'P0001'; end if;
    if v_cant is null or v_cant <= 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
    if v_precio is null or v_precio < 0 then raise exception 'PRECIO_INVALIDO' using errcode = 'P0001'; end if;
    if v_art is not null then
      perform 1 from articulos where id = v_art and empresa_id = p_empresa_id and activo = true and deleted_at is null;
      if not found then raise exception 'ARTICULO_INVALIDO' using errcode = 'P0001'; end if;
    end if;
    v_suma := v_suma + v_cant * v_precio;
  end loop;
  if abs(v_suma - p_neto) > 0.01 then raise exception 'RENGLONES_NO_CIERRAN' using errcode = 'P0001'; end if;
  if abs((p_neto + p_iva) - p_total) > 0.01 then raise exception 'TOTALES_NO_CIERRAN' using errcode = 'P0001'; end if;

  -- S8 · El claim: número único por proveedor (unique index cc_numero_unico)
  begin
    insert into comprobantes_compra (empresa_id, proveedor_id, tipo, letra, numero_proveedor, fecha, neto, iva, total,
      estado, observaciones, sucursal_id, cae, fecha_vencimiento)
    values (p_empresa_id, p_proveedor_id, p_tipo, nullif(upper(trim(coalesce(p_letra,''))), ''),
            trim(p_numero_proveedor), coalesce(p_fecha, current_date), p_neto, p_iva, p_total, 'pendiente',
            nullif(trim(coalesce(p_observaciones,'')), ''), p_sucursal_id,
            nullif(trim(coalesce(p_cae,'')), ''), p_vencimiento)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'NUMERO_DUPLICADO' using errcode = 'P0001';
  end;

  v_num_fmt := (case when p_tipo = 'factura' then 'FAC ' else 'NC ' end)
    || coalesce(nullif(upper(trim(coalesce(p_letra,''))),'') || ' ', '') || trim(p_numero_proveedor);

  -- Items snapshot (con el trío si recepciona: factor VIVO congelado acá)
  for v_it in select * from jsonb_array_elements(p_items) loop
    v_art := nullif(v_it->>'articulo_id', '')::uuid;
    v_pres := nullif(v_it->>'presentacion_id', '')::uuid;
    v_cant := (v_it->>'cantidad')::numeric;
    v_precio := (v_it->>'precio_unitario')::numeric;
    v_ingresa := p_recepcionar and v_art is not null and coalesce((v_it->>'ingresa')::boolean, true);
    if v_pres is not null and v_art is not null then
      select factor into v_factor from articulo_presentaciones_compra
       where id = v_pres and empresa_id = p_empresa_id and articulo_id = v_art;
      if v_factor is null then raise exception 'PRESENTACION_INVALIDA' using errcode = 'P0001'; end if;
    else
      v_factor := 1;
    end if;
    v_cant_op := v_cant * v_factor;
    insert into comprobantes_compra_items (empresa_id, comprobante_id, articulo_id, descripcion, cantidad, precio_unitario,
      presentacion_id, factor_snap, cantidad_operativa, ingresa_stock)
    values (p_empresa_id, v_id, v_art, trim(v_it->>'descripcion'), v_cant, v_precio,
      v_pres, v_factor, v_cant_op, v_ingresa);
    if v_ingresa then
      v_pack := v_pack || jsonb_build_object('articulo_id', v_art,
        'cantidad_operativa', v_cant_op,
        'costo_unitario', case when v_factor > 0 then v_precio / v_factor else 0 end);
    end if;
  end loop;

  -- LA RECEPCIÓN DIRECTA — dentro de ESTA transacción, por EL escritor
  if p_recepcionar then
    if jsonb_array_length(v_pack) = 0 then
      raise exception 'RECEPCION_SIN_ARTICULOS' using errcode = 'P0001';
    end if;
    v_res := _ingresar_compra_stock(p_empresa_id, p_sucursal_id, 1, 'compra',
      null, v_id, v_num_fmt, v_pack);
  end if;

  -- Remitos de respaldo (camino clásico — S5 garantiza que no conviven)
  if p_remito_ids is not null then
    foreach v_rid in array p_remito_ids loop
      select proveedor_id, tipo, estado into v_prov, v_trem, v_estado
        from remitos_compra where id = v_rid and empresa_id = p_empresa_id;
      if v_prov is null then raise exception 'REMITO_INVALIDO' using errcode = 'P0001'; end if;
      if v_prov <> p_proveedor_id then raise exception 'REMITO_DE_OTRO_PROVEEDOR' using errcode = 'P0001'; end if;
      if v_estado <> 'confirmado' or v_trem <> p_tipo_remito then
        raise exception 'REMITO_NO_CONFIRMADO' using errcode = 'P0001';
      end if;
      begin
        insert into comprobantes_compra_remitos (empresa_id, comprobante_id, remito_id)
        values (p_empresa_id, v_id, v_rid);
      exception when unique_violation then
        raise exception 'REMITO_YA_FACTURADO' using errcode = 'P0001';
      end;
    end loop;
  end if;

  insert into cuenta_corriente_proveedor (empresa_id, proveedor_id, tipo, monto, comprobante_id, detalle)
  values (p_empresa_id, p_proveedor_id, case when p_tipo = 'factura' then 'debe' else 'haber' end, p_total, v_id,
          (case when p_tipo = 'factura' then 'Factura ' else 'NC ' end)
          || coalesce(nullif(upper(trim(coalesce(p_letra,''))),'') || ' ', '') || trim(p_numero_proveedor));

  return jsonb_build_object('id', v_id,
    'unidades', coalesce((v_res->>'unidades')::numeric, 0),
    'recepcion', p_recepcionar);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public._registrar_comprobante_compra(uuid,uuid,text,text,text,date,numeric,numeric,numeric,jsonb,uuid[],text,text,uuid,text,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._registrar_comprobante_compra(uuid,uuid,text,text,text,date,numeric,numeric,numeric,jsonb,uuid[],text,text,uuid,text,date,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_orden_pago(p_empresa_id uuid, p_proveedor_id uuid, p_fecha date, p_observaciones text, p_imputaciones jsonb, p_valores jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_numero integer; v_op uuid; v_it jsonb; v_monto numeric;
  v_tipo_c text; v_prov uuid; v_estado text; v_pend numeric;
  v_sum_fact numeric := 0; v_sum_nc numeric := 0; v_total numeric := 0;
  v_cheq record; v_nro integer; v_cheque_id uuid; v_cid uuid;
  v_modalidad text; v_fcobro date; v_femision date;
  v_origen record; v_disp numeric; v_total_credito numeric := 0; v_resumen jsonb := '[]'::jsonb;
begin
  perform 1 from proveedores where id = p_proveedor_id and empresa_id = p_empresa_id and activo = true;
  if not found then raise exception 'PROVEEDOR_INVALIDO' using errcode = 'P0001'; end if;
  if p_valores is null or jsonb_array_length(p_valores) = 0 then
    raise exception 'SIN_VALORES' using errcode = 'P0001';
  end if;

  -- Total = suma de valores (exacta por definición)
  for v_it in select * from jsonb_array_elements(p_valores) loop
    v_monto := (v_it->>'monto')::numeric;
    if v_monto is null or v_monto <= 0 then raise exception 'VALOR_INVALIDO' using errcode = 'P0001'; end if;
    v_total := v_total + v_monto;
  end loop;

  -- Validar imputaciones (sin escribir todavía): factura consume pendiente,
  -- NC consume crédito; el neto no puede superar el total (el resto = a cuenta)
  for v_it in select * from jsonb_array_elements(coalesce(p_imputaciones, '[]'::jsonb)) loop
    v_monto := (v_it->>'monto')::numeric;
    if v_monto is null or v_monto <= 0 then raise exception 'IMPUTACION_INVALIDA' using errcode = 'P0001'; end if;
    select tipo, proveedor_id, estado into v_tipo_c, v_prov, v_estado
      from comprobantes_compra where id = (v_it->>'comprobante_id')::uuid and empresa_id = p_empresa_id;
    if v_tipo_c is null then raise exception 'COMPROBANTE_INVALIDO' using errcode = 'P0001'; end if;
    if v_prov <> p_proveedor_id then raise exception 'COMPROBANTE_DE_OTRO_PROVEEDOR' using errcode = 'P0001'; end if;
    if v_estado = 'anulada' then raise exception 'COMPROBANTE_ANULADO' using errcode = 'P0001'; end if;
    v_pend := pendiente_comprobante(p_empresa_id, (v_it->>'comprobante_id')::uuid);
    if v_monto > v_pend then raise exception 'IMPUTACION_SUPERA_PENDIENTE' using errcode = 'P0001'; end if;
    if v_tipo_c = 'factura' then v_sum_fact := v_sum_fact + v_monto;
    elsif v_tipo_c = 'nota_credito' then v_sum_nc := v_sum_nc + v_monto;
    else raise exception 'COMPROBANTE_INVALIDO' using errcode = 'P0001'; end if;
  end loop;

  if v_sum_fact - v_sum_nc > v_total then
    raise exception 'IMPUTADO_SUPERA_VALORES' using errcode = 'P0001';
  end if;
  if v_sum_nc > v_sum_fact then
    raise exception 'NC_SUPERA_FACTURAS' using errcode = 'P0001';
  end if;

  -- Numeración serializada por empresa
  perform pg_advisory_xact_lock(hashtext('op_' || p_empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_numero
    from ordenes_pago_proveedor where empresa_id = p_empresa_id;

  insert into ordenes_pago_proveedor (empresa_id, proveedor_id, numero, fecha, total, medio, observaciones)
  values (p_empresa_id, p_proveedor_id, v_numero, coalesce(p_fecha, current_date), v_total, 'valores',
          nullif(trim(coalesce(p_observaciones,'')), ''))
  returning id into v_op;

  -- Imputaciones
  for v_it in select * from jsonb_array_elements(coalesce(p_imputaciones, '[]'::jsonb)) loop
    insert into ordenes_pago_imputaciones (empresa_id, orden_pago_id, comprobante_id, monto)
    values (p_empresa_id, v_op, (v_it->>'comprobante_id')::uuid, (v_it->>'monto')::numeric);
  end loop;

  -- Valores (cheques: la CHEQUERA asigna el número, atómico con FOR UPDATE)
  for v_it in select * from jsonb_array_elements(p_valores) loop
    v_monto := (v_it->>'monto')::numeric;
    if v_it->>'tipo' = 'cheque' then
      select * into v_cheq from chequeras
       where id = (v_it->>'chequera_id')::uuid and empresa_id = p_empresa_id and estado = 'activa'
       for update;
      if v_cheq.id is null then raise exception 'CHEQUERA_INVALIDA' using errcode = 'P0001'; end if;
      v_nro := v_cheq.proximo;
      if v_nro > v_cheq.hasta then raise exception 'CHEQUERA_AGOTADA' using errcode = 'P0001'; end if;
      update chequeras set proximo = v_nro + 1,
        estado = case when v_nro + 1 > hasta then 'agotada' else estado end
       where id = v_cheq.id;
      v_modalidad := coalesce(nullif(v_it->>'modalidad',''), 'al_dia');
      v_fcobro := coalesce(nullif(v_it->>'fecha_cobro','')::date, coalesce(p_fecha, current_date));
      if v_modalidad = 'diferido' and v_fcobro < coalesce(p_fecha, current_date) then
        raise exception 'FECHA_COBRO_INVALIDA' using errcode = 'P0001';
      end if;
      -- T5-A.1 (GO CTO 05/10): emisión real del papel; ausente = hoy (compatibilidad intacta)
      v_femision := coalesce(nullif(v_it->>'fecha_emision','')::date, coalesce(p_fecha, current_date));
      if v_femision > current_date then raise exception 'EMISION_FUTURA' using errcode = 'P0001'; end if;
      if v_femision > v_fcobro then raise exception 'EMISION_POSTERIOR_AL_COBRO' using errcode = 'P0001'; end if;
      insert into cheques (empresa_id, tipo, modalidad, formato, chequera_id, cuenta_banco_id,
        numero, fecha_emision, fecha_cobro, monto, proveedor_id, orden_pago_id, estado)
      values (p_empresa_id, 'propio', v_modalidad, coalesce(nullif(v_it->>'formato',''), 'fisico'),
        v_cheq.id, v_cheq.cuenta_banco_id, v_nro, v_femision, v_fcobro,
        v_monto, p_proveedor_id, v_op, 'emitido')
      returning id into v_cheque_id;
      insert into ordenes_pago_valores (empresa_id, orden_pago_id, tipo, cheque_id, monto)
      values (p_empresa_id, v_op, 'cheque', v_cheque_id, v_monto);
      v_resumen := v_resumen || jsonb_build_object('tipo','cheque','numero',v_nro,'monto',v_monto);
    elsif v_it->>'tipo' = 'credito_op' then
      -- T5-A.2 (GO CTO 05/10): el credito de una OP anterior como VALOR documental.
      -- Consume disponible de la OP origen; NO asienta haber nuevo (la plata ya asento al nacer).
      if nullif(v_it->>'orden_pago_origen_id','') is null then
        raise exception 'CREDITO_ORIGEN_INVALIDO' using errcode = 'P0001';
      end if;
      select * into v_origen from ordenes_pago_proveedor
       where id = (v_it->>'orden_pago_origen_id')::uuid and empresa_id = p_empresa_id
       for update;  -- serializa el doble consumo (A2.6)
      if v_origen.id is null then raise exception 'CREDITO_ORIGEN_INVALIDO' using errcode = 'P0001'; end if;
      if v_origen.anulada then raise exception 'CREDITO_ORIGEN_ANULADA' using errcode = 'P0001'; end if;
      if v_origen.proveedor_id <> p_proveedor_id then raise exception 'CREDITO_OTRO_PROVEEDOR' using errcode = 'P0001'; end if;
      if exists (select 1 from ordenes_pago_valores where orden_pago_id = v_origen.id and tipo = 'credito_op') then
        raise exception 'CREDITO_EN_CADENA' using errcode = 'P0001';
      end if;
      v_disp := v_origen.total
        - coalesce((select sum(monto) from ordenes_pago_imputaciones where orden_pago_id = v_origen.id), 0)
        - coalesce((select sum(v2.monto) from ordenes_pago_valores v2
                     join ordenes_pago_proveedor o2 on o2.id = v2.orden_pago_id
                    where v2.tipo = 'credito_op' and v2.orden_pago_origen_id = v_origen.id
                      and o2.anulada = false), 0);
      if v_monto > v_disp + 0.009 then raise exception 'CREDITO_INSUFICIENTE' using errcode = 'P0001'; end if;
      insert into ordenes_pago_valores (empresa_id, orden_pago_id, tipo, orden_pago_origen_id, monto)
      values (p_empresa_id, v_op, 'credito_op', v_origen.id, v_monto);
      v_total_credito := v_total_credito + v_monto;
      v_resumen := v_resumen || jsonb_build_object('tipo','credito_op','origen','OP-' || lpad(v_origen.numero::text, 4, '0'),'monto',v_monto);
    elsif v_it->>'tipo' = 'transferencia' then
      perform 1 from cuentas_banco where id = (v_it->>'cuenta_banco_id')::uuid
        and empresa_id = p_empresa_id and activo = true;
      if not found then raise exception 'CUENTA_INVALIDA' using errcode = 'P0001'; end if;
      insert into ordenes_pago_valores (empresa_id, orden_pago_id, tipo, cuenta_banco_id, monto)
      values (p_empresa_id, v_op, 'transferencia', (v_it->>'cuenta_banco_id')::uuid, v_monto);
      v_resumen := v_resumen || jsonb_build_object('tipo','transferencia','monto',v_monto);
    elsif v_it->>'tipo' = 'efectivo' then
      insert into ordenes_pago_valores (empresa_id, orden_pago_id, tipo, monto)
      values (p_empresa_id, v_op, 'efectivo', v_monto);
      v_resumen := v_resumen || jsonb_build_object('tipo','efectivo','monto',v_monto);
    else
      raise exception 'VALOR_INVALIDO' using errcode = 'P0001';
    end if;
  end loop;

  -- PAGO en CC (origen: la OP) + estados de los comprobantes tocados
  -- T5-A.2: el haber asienta solo la plata nueva; lo cubierto con credito_op ya asento en su OP origen
  if v_total - v_total_credito > 0.009 then
    insert into cuenta_corriente_proveedor (empresa_id, proveedor_id, tipo, monto, orden_pago_id, detalle)
    values (p_empresa_id, p_proveedor_id, 'haber', v_total - v_total_credito, v_op, 'OP-' || lpad(v_numero::text, 4, '0'));
  end if;

  for v_cid in select distinct (value->>'comprobante_id')::uuid
              from jsonb_array_elements(coalesce(p_imputaciones, '[]'::jsonb)) loop
    perform recalcular_estado_comprobante(p_empresa_id, v_cid);
  end loop;

  return jsonb_build_object('id', v_op, 'numero', v_numero, 'total', v_total,
    'a_cuenta', v_total - (v_sum_fact - v_sum_nc), 'valores', v_resumen);
end; $function$;
-- GRANTS (proacl: postgres, service_role)
REVOKE ALL ON FUNCTION public.registrar_orden_pago(uuid,uuid,date,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_orden_pago(uuid,uuid,date,text,jsonb,jsonb) TO service_role;
