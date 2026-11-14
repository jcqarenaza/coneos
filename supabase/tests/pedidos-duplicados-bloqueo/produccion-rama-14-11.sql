-- DEFINICIONES LEÍDAS DE PRODUCCIÓN (proyecto cones-prod, 14/11/2026, consulta de SOLO LECTURA a pg_proc / information_schema / pg_indexes).
-- Se usan ÚNICAMENTE como fixture de pruebas locales de la devolución por rama. No es una migración: NO ejecutar en producción.
-- Las funciones están copiadas tal cual las devolvió pg_get_functiondef (sin modificar la lógica). Las tablas son un esquema reducido equivalente.
alter table stock_movimientos add column if not exists rama_id uuid, add column if not exists usuario_id uuid, add column if not exists pedido_item_id uuid, add column if not exists consumo_regla text, add column if not exists operacion_id uuid;
create table stock_operaciones (
  operacion_id uuid primary key, empresa_id uuid not null references empresas(id), tipo text not null, huella text not null, estado text not null default 'en_curso',
  resultado jsonb, usuario_id uuid, created_at timestamptz not null default now(), completed_at timestamptz,
  constraint stock_operaciones_estado_check check (estado = any (array['en_curso','completada'])),
  constraint stock_operaciones_estado_chk check ((estado = 'completada') = ((completed_at is not null) and (resultado is not null))),
  constraint stock_operaciones_huella_check check (huella ~ '^[0-9a-f]{64}$'),
  constraint stock_operaciones_tipo_check check (tipo = any (array['venta','devolucion_pedido','ingreso','ajuste','transferencia','habilitar','revertir','activar_sucursal','compra'])));
create table stock_rama (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null, presentacion_id uuid not null, producto_id uuid not null,
  cantidad numeric not null default 0, stock_minimo numeric not null default 0, updated_at timestamptz not null default now(),
  constraint stock_rama_cant_chk check (cantidad >= 0 and cantidad = trunc(cantidad)), constraint stock_rama_uq unique (sucursal_id, presentacion_id));
create table stock_incidencias (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references empresas(id), tipo text not null, pedido_id uuid, producto_id uuid,
  detalle jsonb not null default '{}'::jsonb, estado text not null default 'abierta', resolucion text, created_at timestamptz not null default now(), resolved_at timestamptz,
  constraint stock_incidencias_estado_check check (estado = any (array['abierta','resuelta'])),
  constraint stock_incidencias_tipo_check check (tipo = any (array['SIN_LIBRO','SNAPSHOT_HISTORICO_INCOMPLETO','DEVOLUCION_INCONSISTENTE','FLAG_INCOMPATIBLE','DEVOLUCION_PARCIAL','OTRA'])));
create unique index stock_incidencias_pedido_uq on stock_incidencias (empresa_id, pedido_id, tipo) where estado = 'abierta' and pedido_id is not null;
alter table stock_movimientos add constraint stock_movimientos_rama_id_fkey foreign key (rama_id) references stock_rama(id);
alter table stock_movimientos add constraint stock_movimientos_operacion_id_fkey foreign key (operacion_id) references stock_operaciones(operacion_id);
alter table stock_movimientos add constraint stock_mov_hoja_chk check (rama_id is null or (operacion_id is not null and producto_id is not null and (motivo <> all (array['venta','devolucion']) or (pedido_item_id is not null and consumo_regla is not null))));
create unique index stock_mov_hoja_linea_uq on stock_movimientos (pedido_item_id, rama_id, motivo) where pedido_item_id is not null and rama_id is not null and motivo = any (array['venta','devolucion']);
alter table productos add column if not exists modelo_stock text;

CREATE OR REPLACE FUNCTION public._huella(p_param jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$ select encode(sha256(convert_to(p_param::text, 'UTF8')), 'hex') $function$;

CREATE OR REPLACE FUNCTION public._exigir_read_committed()
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'AISLAMIENTO_NO_SOPORTADO' using errcode = 'P0001';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public._completar_operacion(p_operacion uuid, p_resultado jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update public.stock_operaciones set estado='completada', resultado=p_resultado, completed_at=now() where operacion_id=p_operacion and estado='en_curso';
  if not found then raise exception 'OPERACION_NO_ENCONTRADA: %', p_operacion using errcode='P0001'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public._registrar_operacion(p_operacion uuid, p_empresa uuid, p_tipo text, p_huella text, p_usuario uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_n int; r public.stock_operaciones;
begin
  insert into public.stock_operaciones (operacion_id, empresa_id, tipo, huella, usuario_id)
  values (p_operacion, p_empresa, p_tipo, p_huella, p_usuario) on conflict (operacion_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then return jsonb_build_object('estado','nueva'); end if;
  select * into r from public.stock_operaciones where operacion_id = p_operacion;
  if r.empresa_id <> p_empresa or r.tipo <> p_tipo or r.huella <> p_huella then
    raise exception 'IDEMPOTENCIA_CONFLICTO: operacion % ya existe con otros parametros', p_operacion using errcode='P0001';
  end if;
  if r.estado <> 'completada' then
    raise exception 'OPERACION_EN_CURSO: %', p_operacion using errcode='P0001';
  end if;
  return jsonb_build_object('estado','repetida','resultado', r.resultado);
end $function$;

CREATE OR REPLACE FUNCTION public._devolver_pedido_core(p_empresa uuid, p_pedido uuid, p_operacion uuid, p_usuario uuid, p_actor text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_huella text; v_reg jsonb; v_prev jsonb; v_flag boolean; v_existe boolean;
  v_n int; v_pos int; v_cero int; v_parcial int; v_anom int; v_hist int; v_sumv numeric; v_hay_neg boolean;
  v_tipo text; v_res jsonb; r record; v_total numeric := 0; v_grupos int := 0; v_g jsonb;
begin
  if p_operacion is null or p_pedido is null then raise exception 'PARAMETROS_INVALIDOS' using errcode = 'P0001'; end if;

  v_huella := public._huella(jsonb_build_object('empresa_id', p_empresa, 'pedido_id', p_pedido));
  v_reg := public._registrar_operacion(p_operacion, p_empresa, 'devolucion_pedido', v_huella, p_usuario);
  perform public._exigir_read_committed();

  select stock_descontado into v_flag from public.pedidos where id = p_pedido and empresa_id = p_empresa for update;
  v_existe := found;

  perform 1 from public.productos where id in (select producto_id from public.stock_movimientos
            where pedido_id = p_pedido and empresa_id = p_empresa and motivo in ('venta','devolucion')) order by id for share;

  with g as (
    select m.producto_id, m.rama_id, m.pedido_item_id, min(m.sucursal_id::text)::uuid suc, min(m.consumo_regla) regla,
           coalesce(sum(-m.delta) filter (where m.motivo = 'venta'), 0) v, coalesce(sum(m.delta) filter (where m.motivo = 'devolucion'), 0) d,
           bool_or(m.rama_id is null and p.modelo_stock = 'rama') hist
      from public.stock_movimientos m left join public.productos p on p.id = m.producto_id
     where m.pedido_id = p_pedido and m.empresa_id = p_empresa and m.motivo in ('venta','devolucion')
     group by m.producto_id, m.rama_id, m.pedido_item_id)
  select count(*), count(*) filter (where v > 0 and d = 0), count(*) filter (where v > 0 and d = v), count(*) filter (where d > v),
         count(*) filter (where v > 0 and d > 0 and d < v), count(*) filter (where hist), coalesce(sum(v), 0),
         coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'rama_id', rama_id, 'pedido_item_id', pedido_item_id,
                  'sucursal_id', suc, 'regla', regla, 'venta', v, 'devuelto', d)), '[]'::jsonb)
    into v_n, v_pos, v_cero, v_anom, v_parcial, v_hist, v_sumv, v_g from g;

  if v_reg ->> 'estado' = 'repetida' then
    v_prev := v_reg -> 'resultado';
    if v_prev ->> 'estado' = 'devuelto' and ((v_existe and v_flag is true) or v_pos > 0 or v_parcial > 0) then
      insert into public.stock_incidencias (empresa_id, tipo, pedido_id, detalle)
      values (p_empresa, 'FLAG_INCOMPATIBLE', p_pedido, jsonb_build_object('operacion', p_operacion, 'origen', 'reintento', 'stock_descontado', v_flag, 'grupos', v_g))
      on conflict (empresa_id, pedido_id, tipo) where estado = 'abierta' and pedido_id is not null do nothing;
      return jsonb_build_object('estado', 'inconsistente', 'repetida', true, 'motivo', 'estado actual incompatible con la devolucion registrada');
    end if;
    return v_prev || jsonb_build_object('repetida', true);
  end if;

  if not v_existe then raise exception 'PEDIDO_NO_ENCONTRADO' using errcode = 'P0001'; end if;

  v_tipo := case
    when v_sumv = 0 and v_flag is true                          then 'SIN_LIBRO'
    when v_sumv = 0                                             then null
    when v_anom > 0                                             then 'DEVOLUCION_INCONSISTENTE'
    when v_hist > 0                                             then 'SNAPSHOT_HISTORICO_INCOMPLETO'
    when v_parcial > 0 or (v_pos > 0 and v_cero > 0)            then 'DEVOLUCION_PARCIAL'
    when v_pos > 0 and v_flag is not true                       then 'FLAG_INCOMPATIBLE'
    when v_cero > 0 and v_pos = 0 and v_flag is true            then 'FLAG_INCOMPATIBLE'
    else null end;

  if v_tipo is not null then
    insert into public.stock_incidencias (empresa_id, tipo, pedido_id, detalle)
    values (p_empresa, v_tipo, p_pedido, jsonb_build_object('operacion', p_operacion, 'stock_descontado', v_flag, 'grupos', v_g))
    on conflict (empresa_id, pedido_id, tipo) where estado = 'abierta' and pedido_id is not null do nothing;
    v_res := jsonb_build_object('estado', 'incidencia', 'tipo', v_tipo);
  elsif v_pos = 0 then
    v_res := jsonb_build_object('estado', 'sin_efecto', 'motivo', case when v_sumv = 0 then 'sin_venta' else 'ya_devuelto' end);
  else
    perform 1 from public.stock_rama where id in (select (x->>'rama_id')::uuid from jsonb_array_elements(v_g) x where x->>'rama_id' is not null) order by id for update;
    for r in select (x->>'producto_id')::uuid producto_id, (x->>'rama_id')::uuid rama_id, (x->>'pedido_item_id')::uuid pedido_item_id,
                    (x->>'sucursal_id')::uuid suc, x->>'regla' regla, (x->>'venta')::numeric v
               from jsonb_array_elements(v_g) x where (x->>'venta')::numeric > 0
              order by (x->>'producto_id')::uuid, (x->>'rama_id')::uuid nulls first, (x->>'pedido_item_id')::uuid
    loop
      if r.rama_id is not null then
        update public.stock_rama set cantidad = cantidad + r.v, updated_at = now() where id = r.rama_id;
        insert into public.stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, pedido_id, rama_id, pedido_item_id, consumo_regla, operacion_id, usuario_id, detalle)
        values (p_empresa, r.suc, r.producto_id, r.v, 'devolucion', p_pedido, r.rama_id, r.pedido_item_id, r.regla, p_operacion, p_usuario, 'Devolucion por eliminacion de pedido' || coalesce(' · ' || nullif(btrim(p_actor),''), ''));
      else
        perform public.ajustar_stock(p_empresa, r.suc, r.producto_id, r.v::int, 'delta', 'devolucion', p_pedido, 'Devolucion por eliminacion de pedido' || coalesce(' · ' || nullif(btrim(p_actor),''), ''));
      end if;
      v_total := v_total + r.v; v_grupos := v_grupos + 1;
    end loop;
    update public.pedidos set stock_descontado = false where id = p_pedido;
    v_res := jsonb_build_object('estado', 'devuelto', 'grupos', v_grupos, 'unidades', v_total);
  end if;
  perform public._completar_operacion(p_operacion, v_res);
  return v_res || jsonb_build_object('repetida', false);
end $function$;

CREATE OR REPLACE FUNCTION public.devolver_stock_pedido_caja(p_empresa uuid, p_pedido uuid, p_dispositivo uuid, p_operacion uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_disp record; v_suc uuid; v_op uuid;
begin
  if p_empresa is null or p_pedido is null or p_dispositivo is null then raise exception 'PARAMETROS_INVALIDOS' using errcode = 'P0001'; end if;
  select id, empresa_id, sucursal_id, tipo, activo, nombre into v_disp from public.dispositivos where id = p_dispositivo;
  if v_disp.id is null or not coalesce(v_disp.activo, false) or v_disp.tipo is distinct from 'CAJA' or v_disp.empresa_id is distinct from p_empresa then
    raise exception 'DISPOSITIVO_NO_AUTORIZADO' using errcode = 'P0001'; end if;
  select sucursal_id into v_suc from public.pedidos where id = p_pedido and empresa_id = p_empresa;
  if v_suc is not null and v_suc is distinct from v_disp.sucursal_id then raise exception 'PEDIDO_OTRA_SUCURSAL' using errcode = 'P0001'; end if;
  v_op := coalesce(p_operacion, md5('devolucion_caja:' || p_empresa::text || ':' || p_pedido::text)::uuid);
  return public._devolver_pedido_core(p_empresa, p_pedido, v_op, null, 'caja ' || coalesce(v_disp.nombre, v_disp.id::text));
end $function$;
revoke all on function public.devolver_stock_pedido_caja(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.devolver_stock_pedido_caja(uuid,uuid,uuid,uuid) to service_role;
