-- ============================================================
-- STOCK POR SABOR EN KILOS (helado por kilo) — para correr A MANO en Supabase SQL Editor
-- Idempotente. NO toca crear_pedido_stock, ajustar_stock, producto_stock ni stock_rama.
-- Modelo: cada sabor (opcion) tiene sus KILOS por sucursal. Cada presentación de helado declara cuántos kg
-- representa (1/4 = 0,25 · 1/2 = 0,5 · 1 = 1). Al vender, los kg de la presentación se reparten en PARTES IGUALES
-- entre los sabores elegidos. Si un sabor no alcanza, la venta sale igual y el sabor queda en 0 (queda registrado el faltante).
-- Solo se descuentan los sabores que tienen kilos cargados (fila en stock_sabor).
-- ROLLBACK al final (comentado).
-- ============================================================
begin;

alter table public.presentaciones add column if not exists kg_por_unidad numeric(8,3);
alter table public.presentaciones drop constraint if exists presentaciones_kg_por_unidad_chk;
alter table public.presentaciones add constraint presentaciones_kg_por_unidad_chk
  check (kg_por_unidad is null or (kg_por_unidad > 0 and kg_por_unidad <= 1000));

-- Las presentaciones de helado por kilo con sabores quedan con sus kilos (mismo criterio que el informe de Ventas).
-- Otras presentaciones (otros nombres) se configuran desde Stock → Sabores (kg).
update public.presentaciones set kg_por_unidad = case nombre when '1 Kg' then 1 when '1/2 Kg' then 0.5 when '1/4 Kg' then 0.25 end
 where kg_por_unidad is null and nombre in ('1 Kg','1/2 Kg','1/4 Kg')
   and exists (select 1 from public.presentacion_grupos g where g.presentacion_id = presentaciones.id);

create table if not exists public.stock_sabor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  sucursal_id uuid not null references public.sucursales(id),
  opcion_id uuid not null references public.opciones(id),
  kg numeric(12,3) not null default 0 check (kg >= 0),
  updated_at timestamptz not null default now(),
  unique (sucursal_id, opcion_id)
);

create table if not exists public.stock_sabor_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  sucursal_id uuid not null,
  opcion_id uuid not null,
  delta_kg numeric(12,3) not null,
  motivo text not null check (motivo in ('ajuste','venta','devolucion')),
  pedido_id uuid,
  detalle text,
  usuario_id uuid,
  usuario_nombre text,
  operacion_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_ssm_pedido_opcion_motivo on public.stock_sabor_movimientos (pedido_id, opcion_id, motivo) where pedido_id is not null;
create unique index if not exists ux_ssm_operacion_opcion on public.stock_sabor_movimientos (operacion_id, opcion_id) where operacion_id is not null;
create index if not exists ix_ssm_sucursal_fecha on public.stock_sabor_movimientos (sucursal_id, created_at desc);

alter table public.stock_sabor enable row level security;
alter table public.stock_sabor_movimientos enable row level security;
revoke all on public.stock_sabor, public.stock_sabor_movimientos from anon, authenticated;

-- ── Ajuste de kilos de un sabor (set = "hay X kg" · delta = suma/resta) ──
create or replace function public.ajustar_stock_sabor(
  p_empresa_id uuid, p_sucursal_id uuid, p_opcion_id uuid, p_modo text, p_kg numeric,
  p_motivo text, p_usuario_id uuid, p_usuario_nombre text, p_operacion_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_old numeric; v_new numeric; v_prev jsonb;
begin
  perform public._validar_usuario_stock(p_empresa_id, p_usuario_id, p_sucursal_id);
  if p_operacion_id is null then raise exception 'OPERACION_REQUERIDA' using errcode = 'P0001'; end if;
  if p_modo not in ('set','delta') then raise exception 'MODO_INVALIDO' using errcode = 'P0001'; end if;
  if p_kg is null or abs(p_kg) > 1000000 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
  if p_modo = 'set' and p_kg < 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_motivo),'') = '' then raise exception 'MOTIVO_REQUERIDO' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.sucursales where id = p_sucursal_id and empresa_id = p_empresa_id) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.opciones where id = p_opcion_id and empresa_id = p_empresa_id and deleted_at is null) then
    raise exception 'SABOR_INVALIDO' using errcode = 'P0001'; end if;

  -- reintento idempotente
  select jsonb_build_object('kg', (select kg from public.stock_sabor where sucursal_id = p_sucursal_id and opcion_id = p_opcion_id),
                            'delta', m.delta_kg, 'repetido', true) into v_prev
    from public.stock_sabor_movimientos m where m.operacion_id = p_operacion_id and m.opcion_id = p_opcion_id;
  if v_prev is not null then return v_prev; end if;

  insert into public.stock_sabor (empresa_id, sucursal_id, opcion_id, kg) values (p_empresa_id, p_sucursal_id, p_opcion_id, 0)
    on conflict (sucursal_id, opcion_id) do nothing;
  select kg into v_old from public.stock_sabor where sucursal_id = p_sucursal_id and opcion_id = p_opcion_id for update;
  v_new := case when p_modo = 'set' then round(p_kg, 3) else round(v_old + p_kg, 3) end;
  if v_new < 0 then raise exception 'SALDO_NEGATIVO' using errcode = 'P0001'; end if;
  update public.stock_sabor set kg = v_new, updated_at = now() where sucursal_id = p_sucursal_id and opcion_id = p_opcion_id;
  insert into public.stock_sabor_movimientos (empresa_id, sucursal_id, opcion_id, delta_kg, motivo, detalle, usuario_id, usuario_nombre, operacion_id)
    values (p_empresa_id, p_sucursal_id, p_opcion_id, v_new - v_old, 'ajuste', btrim(p_motivo), p_usuario_id, p_usuario_nombre, p_operacion_id);
  return jsonb_build_object('kg', v_new, 'delta', v_new - v_old, 'repetido', false);
end $fn$;

-- ── Descuento por venta (se llama DESPUÉS de crear el pedido; idempotente por pedido) ──
create or replace function public.descontar_sabores_pedido(p_empresa uuid, p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_suc uuid; r record; v_saldo numeric; v_aplicar numeric; v_falt jsonb := '[]'::jsonb; v_nombre text; v_mov int := 0;
begin
  select sucursal_id into v_suc from public.pedidos where id = p_pedido and empresa_id = p_empresa;
  if v_suc is null then raise exception 'PEDIDO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sabor:' || p_pedido::text, 0));
  if exists (select 1 from public.stock_sabor_movimientos where pedido_id = p_pedido and motivo = 'venta') then
    return jsonb_build_object('estado', 'ya_descontado'); end if;
  for r in
    select o.opcion_id, sum(pi.cantidad * pr.kg_por_unidad / c.n) as kg
      from public.pedido_items pi
      join public.presentaciones pr on pr.id = pi.presentacion_id and pr.kg_por_unidad is not null
      join public.pedido_item_opciones o on o.pedido_item_id = pi.id
      join (select pedido_item_id, count(*) n from public.pedido_item_opciones group by 1) c on c.pedido_item_id = pi.id
     where pi.pedido_id = p_pedido
     group by o.opcion_id order by o.opcion_id
  loop
    select kg into v_saldo from public.stock_sabor where sucursal_id = v_suc and opcion_id = r.opcion_id for update;
    if not found then continue; end if;          -- sabor sin kilos cargados: no se controla
    v_aplicar := least(v_saldo, round(r.kg, 3));
    update public.stock_sabor set kg = kg - v_aplicar, updated_at = now() where sucursal_id = v_suc and opcion_id = r.opcion_id;
    insert into public.stock_sabor_movimientos (empresa_id, sucursal_id, opcion_id, delta_kg, motivo, pedido_id, detalle)
      values (p_empresa, v_suc, r.opcion_id, -v_aplicar, 'venta', p_pedido,
              'Venta: ' || round(r.kg, 3) || ' kg' || case when v_aplicar < round(r.kg, 3) then ' (faltaban ' || (round(r.kg, 3) - v_aplicar) || ' kg)' else '' end);
    v_mov := v_mov + 1;
    if v_aplicar < round(r.kg, 3) then
      select nombre into v_nombre from public.opciones where id = r.opcion_id;
      v_falt := v_falt || jsonb_build_array(jsonb_build_object('opcion_id', r.opcion_id, 'sabor', v_nombre, 'pedido_kg', round(r.kg, 3), 'descontado_kg', v_aplicar));
    end if;
  end loop;
  return jsonb_build_object('estado', 'descontado', 'movimientos', v_mov, 'faltantes', v_falt);
end $fn$;

-- ── Devolución al eliminar el pedido (idempotente) ──
create or replace function public.devolver_sabores_pedido(p_empresa uuid, p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare m record; v_n int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('sabor:' || p_pedido::text, 0));
  if not exists (select 1 from public.stock_sabor_movimientos where pedido_id = p_pedido and empresa_id = p_empresa and motivo = 'venta') then
    return jsonb_build_object('estado', 'sin_efecto'); end if;
  if exists (select 1 from public.stock_sabor_movimientos where pedido_id = p_pedido and empresa_id = p_empresa and motivo = 'devolucion') then
    return jsonb_build_object('estado', 'ya_devuelto'); end if;
  for m in select * from public.stock_sabor_movimientos where pedido_id = p_pedido and empresa_id = p_empresa and motivo = 'venta' order by opcion_id loop
    update public.stock_sabor set kg = kg + (-m.delta_kg), updated_at = now() where sucursal_id = m.sucursal_id and opcion_id = m.opcion_id;
    insert into public.stock_sabor_movimientos (empresa_id, sucursal_id, opcion_id, delta_kg, motivo, pedido_id, detalle)
      values (m.empresa_id, m.sucursal_id, m.opcion_id, -m.delta_kg, 'devolucion', p_pedido, 'Devolución por eliminación del pedido');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('estado', 'devuelto', 'movimientos', v_n);
end $fn$;

revoke all on function public.ajustar_stock_sabor(uuid,uuid,uuid,text,numeric,text,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.descontar_sabores_pedido(uuid,uuid) from public, anon, authenticated;
revoke all on function public.devolver_sabores_pedido(uuid,uuid) from public, anon, authenticated;
grant execute on function public.ajustar_stock_sabor(uuid,uuid,uuid,text,numeric,text,uuid,text,uuid) to service_role;
grant execute on function public.descontar_sabores_pedido(uuid,uuid) to service_role;
grant execute on function public.devolver_sabores_pedido(uuid,uuid) to service_role;
commit;

-- ROLLBACK (solo si no se usó):
-- drop function public.ajustar_stock_sabor(uuid,uuid,uuid,text,numeric,text,uuid,text,uuid); drop function public.descontar_sabores_pedido(uuid,uuid); drop function public.devolver_sabores_pedido(uuid,uuid);
-- drop table public.stock_sabor_movimientos; drop table public.stock_sabor; alter table public.presentaciones drop column kg_por_unidad;
