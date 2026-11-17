-- EXTRAS del esquema reducido para probar el CONTROL DE STOCK POR SUCURSAL (GO CTO 17/11) con las funciones SQL REALES de cones-prod.
-- Se carga DESPUÉS de supabase/tests/stock-v2/00-schema-reducido.sql. Postgres 16 local descartable, NO es Supabase. Nada de esto toca una base real.
-- Lo que es COPIA de la base viva (lectura 17/11): trg_stock_prod_guard, trg_stock_ps_guard. Lo que es STUB mínimo (fuera del alcance): rama
-- (_calcular_consumo, _registrar_operacion…), tablas de arqueo/conteo con solo las columnas que usan las funciones.
alter table productos add column modelo_stock text not null default 'producto', add column activo boolean not null default true, add column deleted_at timestamptz,
  add column categoria_id text, add column orden int, add column visible_kiosk boolean not null default true, add column codigo text;
alter table sucursales add column nombre text;
alter table empresas add column nombre text;
alter table pedidos add column operacion_id uuid;
alter table pedido_items add column cantidad_stock_snap integer;
alter table stock_movimientos add column rama_id uuid, add column pedido_item_id uuid, add column consumo_regla text, add column operacion_id uuid;

-- guardas REALES (copiadas de la viva)
CREATE OR REPLACE FUNCTION public.trg_stock_prod_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
begin
  if current_user in ('anon','authenticated','service_role','authenticator') then
    if tg_op = 'INSERT' and new.modelo_stock <> 'producto' then
      raise exception 'MODELO_STOCK_PROTEGIDO: alta solo en modelo producto' using errcode='P0001';
    elsif tg_op = 'UPDATE' and new.modelo_stock is distinct from old.modelo_stock then
      raise exception 'MODELO_STOCK_PROTEGIDO: el modelo cambia solo por habilitar/revertir' using errcode='P0001';
    end if;
  end if;
  if new.modelo_stock = 'rama' and not new.controla_stock then
    raise exception 'RAMA_REQUIERE_CONTROLA_STOCK' using errcode='P0001';
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.trg_stock_ps_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare v_prod uuid := coalesce(new.producto_id, old.producto_id);
begin
  if exists (select 1 from public.productos where id = v_prod and modelo_stock = 'rama') then
    raise exception 'PRODUCTO_MODELO_RAMA: el stock de este producto se maneja por hoja' using errcode='P0001';
  end if;
  return coalesce(new, old);
end $function$;
CREATE TRIGGER stk_10_guard BEFORE INSERT OR UPDATE OF modelo_stock, controla_stock ON public.productos FOR EACH ROW EXECUTE FUNCTION trg_stock_prod_guard();
CREATE TRIGGER stk_10_guard BEFORE INSERT OR DELETE OR UPDATE ON public.producto_stock FOR EACH ROW EXECUTE FUNCTION trg_stock_ps_guard();

-- stock por RAMA (stubs mínimos: solo para recorrer el camino v1.8 de crear_pedido_stock y comprobar que no cambia)
create table stock_rama_habilitacion (producto_id uuid not null, sucursal_id uuid not null, estado text not null);
create table stock_rama (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null, presentacion_id uuid not null,
  cantidad integer not null default 0 check (cantidad >= 0), updated_at timestamptz default now());
create function public._calcular_consumo(p_pres uuid, p_cant numeric) returns table(cantidad numeric, regla text) language sql as $$ select p_cant, 'directa'::text $$;
create function public._huella(p jsonb) returns text language sql as $$ select md5(p::text) $$;
create function public._registrar_operacion(uuid, uuid, text, text, text) returns void language sql as $$ select $$;
create function public._completar_operacion(uuid, jsonb) returns void language sql as $$ select $$;

-- arqueo y conteo (solo columnas que usan crear_arqueo_stock / iniciar_conteo_stock / _calcular_ajuste_stock)
create table arqueos_stock (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null, alcance text, contado_por text,
  observaciones text, estado text not null default 'pendiente');
create table arqueo_items (arqueo_id uuid not null references arqueos_stock(id), producto_id uuid not null, teorico numeric, fisico numeric);
create table stock_conteos (id uuid primary key, empresa_id uuid not null, sucursal_id uuid not null, usuario_id uuid, usuario_nombre text, iniciado_at timestamptz not null default now());
create table stock_conteo_base (conteo_id uuid not null references stock_conteos(id), producto_id uuid not null, base integer not null);
