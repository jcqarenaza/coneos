-- ENTORNO AISLADO DE PRUEBAS (Postgres 16 local, sin red, NO es Supabase)
-- Esquema REDUCIDO: solo las tablas/columnas que toca crear_pedido_stock,
-- ajustar_stock y la devolución. Constraints, índices, triggers y funciones
-- copiados de la base viva (lectura 2026-11-04). Se omiten: RLS, FKs a
-- Compras (comprobantes_compra/remitos_compra/articulos) y columnas ajenas.
create table empresas (id uuid primary key default gen_random_uuid());
create table sucursales (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references empresas(id));
create table productos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null,
  nombre text not null, controla_stock boolean not null default false);
create table presentaciones (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null,
  producto_id uuid not null references productos(id),
  nombre text not null, precio numeric not null,
  factor_stock numeric not null default 1,
  activo boolean not null default true,
  constraint presentaciones_factor_stock_positivo check (factor_stock > (0)::numeric));
create table producto_stock (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null references empresas(id),
  producto_id uuid not null references productos(id), sucursal_id uuid not null references sucursales(id),
  cantidad integer not null default 0 constraint producto_stock_cantidad_check check (cantidad >= 0),
  stock_minimo integer not null default 0 constraint producto_stock_stock_minimo_check check (stock_minimo >= 0),
  updated_at timestamptz not null default now(),
  constraint producto_stock_producto_id_sucursal_id_key unique (producto_id, sucursal_id));
create index idx_producto_stock_sucursal on producto_stock (sucursal_id);
create table stock_movimientos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null,
  producto_id uuid, delta numeric not null, motivo text not null, pedido_id uuid, detalle text,
  created_at timestamptz not null default now(),
  articulo_id uuid, costo_unitario numeric, remito_id uuid, comprobante_compra_id uuid,
  constraint stock_mov_doc_chk check ((((motivo = 'venta'::text) AND (pedido_id IS NOT NULL) AND (remito_id IS NULL) AND (comprobante_compra_id IS NULL)) OR ((motivo = 'compra'::text) AND (articulo_id IS NOT NULL) AND (pedido_id IS NULL) AND ((((remito_id IS NOT NULL))::integer + ((comprobante_compra_id IS NOT NULL))::integer) = 1)) OR ((motivo = 'devolucion_compra'::text) AND (articulo_id IS NOT NULL) AND (pedido_id IS NULL) AND (remito_id IS NOT NULL) AND (comprobante_compra_id IS NULL)) OR ((motivo = ANY (ARRAY['arqueo'::text, 'ajuste'::text, 'devolucion'::text])) AND (remito_id IS NULL) AND (comprobante_compra_id IS NULL)))),
  constraint stock_mov_eje_chk check (((producto_id IS NOT NULL) OR (articulo_id IS NOT NULL))));
create index idx_stockmov_prod on stock_movimientos (producto_id, sucursal_id, created_at desc);
create index idx_stockmov_pedido on stock_movimientos (pedido_id) where pedido_id is not null;
create table promociones (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null, nombre text not null,
  precio numeric not null, activo boolean not null default true, vigencia_desde date, vigencia_hasta date);
create table promo_slots (
  id uuid primary key default gen_random_uuid(), promo_id uuid not null references promociones(id),
  cantidad integer not null default 1);
create table promo_slot_presentaciones (
  id uuid primary key default gen_random_uuid(), slot_id uuid not null references promo_slots(id),
  presentacion_id uuid not null references presentaciones(id));
create table grupos_opciones (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null, nombre text not null, activo boolean not null default true);
create table opciones (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null, grupo_id uuid not null references grupos_opciones(id),
  nombre text not null, precio_adicional numeric not null default 0, activo boolean not null default true, deleted_at timestamptz);
create table presentacion_grupos (
  presentacion_id uuid not null references presentaciones(id), grupo_id uuid not null references grupos_opciones(id));
create table pedidos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null,
  dispositivo_id uuid, numero_pedido integer not null, codigo_retiro text, estado text, metodo_pago text,
  total numeric, fecha_pedido date, origen text, tipo_pedido text, costo_envio numeric, datos_delivery jsonb,
  mesa_cuenta_id uuid, numero_mesa integer, pagado boolean, nombre_cliente text,
  stock_descontado boolean not null default false,
  constraint pedidos_sucursal_id_fecha_pedido_numero_pedido_key unique (sucursal_id, fecha_pedido, numero_pedido));
create table pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  presentacion_id uuid references presentaciones(id),
  nombre_producto_snap text, nombre_presentacion_snap text, precio_snap numeric, cantidad integer,
  promo_id uuid references promociones(id), combo_ref uuid,
  promo_nombre_snap text, promo_precio_snap numeric,
  factor_stock_snap numeric,
  constraint pedido_items_combo_coherente check (((promo_id IS NULL) = (combo_ref IS NULL))));
create index idx_pedido_items_pedido on pedido_items (pedido_id);
create table pedido_item_opciones (
  id uuid primary key default gen_random_uuid(), pedido_item_id uuid not null references pedido_items(id) on delete cascade,
  opcion_id uuid, nombre_snap text, emoji_snap text, color_snap text);
create table catalogo_version (
  sucursal_id uuid primary key, empresa_id uuid not null, version integer not null default 1, updated_at timestamptz default now());

-- ── bump_catalogo: funciones y triggers copiados de la base viva ──
CREATE OR REPLACE FUNCTION public.bump_catalogo_empresa(p_empresa uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
CREATE OR REPLACE FUNCTION public.bump_catalogo_sucursal(p_sucursal uuid, p_empresa uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into catalogo_version (sucursal_id, empresa_id, version, updated_at)
  values (p_sucursal, p_empresa, 1, now())
  on conflict (sucursal_id)
  do update set version = catalogo_version.version + 1, updated_at = now();
end $function$;
CREATE OR REPLACE FUNCTION public.trg_bump_catalogo()
 RETURNS trigger LANGUAGE plpgsql
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
CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();
CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.presentaciones FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();
CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.opciones FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();
CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.producto_stock FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();
CREATE TRIGGER bump_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.promociones FOR EACH ROW EXECUTE FUNCTION trg_bump_catalogo();

-- ── ajustar_stock: copiada de la base viva (la guarda de auth solo aplica a session_user = 'authenticator') ──
CREATE OR REPLACE FUNCTION public.ajustar_stock(p_empresa_id uuid, p_sucursal_id uuid, p_producto_id uuid, p_valor integer, p_modo text DEFAULT 'delta'::text, p_motivo text DEFAULT 'ajuste'::text, p_pedido_id uuid DEFAULT NULL::uuid, p_detalle text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

-- ── STUBS de Supabase para que ajustar_stock compile (en la viva existen de verdad) ──
create schema if not exists auth;
create or replace function auth.role() returns text language sql as $$ select null::text $$;
create or replace function public.auth_rol() returns text language sql as $$ select null::text $$;
create or replace function public.auth_empresa_id() returns uuid language sql as $$ select null::uuid $$;
