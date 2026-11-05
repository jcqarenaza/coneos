-- ENTORNO AISLADO (Postgres 16 local). Réplica mínima de Supabase: roles, auth.*, RLS, default privileges.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase da ALL por default a los tres roles sobre todo lo que se crea en public:
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table empresas (id uuid primary key default gen_random_uuid(), nombre text);
create table sucursales (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references empresas(id), nombre text);
create table productos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, nombre text, activo boolean default true, controla_stock boolean default true, deleted_at timestamptz);
create table usuarios_admin (id uuid primary key, empresa_id uuid not null);
create table usuario_admin_roles (usuario_id uuid, rol text);
create or replace function public.auth_empresa_id() returns uuid language sql stable as $$ select empresa_id from usuarios_admin where id = auth.uid() $$;
create or replace function public.auth_rol() returns text language sql stable as $$
  select rol from usuario_admin_roles where usuario_id = auth.uid()
  order by case rol when 'SUPER_ADMIN' then 1 when 'ADMIN_EMPRESA' then 2 when 'ADMIN_SUCURSAL' then 3 end limit 1 $$;

create table producto_stock (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, producto_id uuid not null, sucursal_id uuid not null,
  cantidad integer not null default 0 check (cantidad>=0), stock_minimo integer not null default 0, updated_at timestamptz default now(), unique(producto_id,sucursal_id));
alter table producto_stock enable row level security;
create policy admin_gestiona_producto_stock on producto_stock for all to public using (empresa_id = auth_empresa_id()) with check (empresa_id = auth_empresa_id());
create policy admin_lee_producto_stock on producto_stock for select to public using (empresa_id = auth_empresa_id());
create table stock_movimientos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null, producto_id uuid, delta numeric not null, motivo text not null, pedido_id uuid, detalle text, created_at timestamptz default now());
alter table stock_movimientos enable row level security;  -- sin policies (igual que la viva)
create table catalogo_version (sucursal_id uuid primary key, empresa_id uuid not null, version integer not null default 1, updated_at timestamptz default now());
alter table catalogo_version enable row level security;   -- SUPUESTO: policies reales no volcadas (ver informe)
create table presentaciones (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, producto_id uuid, nombre text, precio numeric, factor_stock numeric default 1);
alter table presentaciones enable row level security;
create policy admin_pres on presentaciones for all to public using (empresa_id = auth_empresa_id()) with check (empresa_id = auth_empresa_id());

-- arqueos: DDL y policies EXACTAS del volcado 01 (las abiertas incluidas)
CREATE TABLE public.arqueos_stock (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, empresa_id uuid NOT NULL, sucursal_id uuid NOT NULL,
  estado text DEFAULT 'pendiente' NOT NULL, alcance text NOT NULL, contado_por text, confirmado_por text, observaciones text,
  created_at timestamptz DEFAULT now() NOT NULL, confirmado_at timestamptz,
  CONSTRAINT arqueos_stock_estado_check CHECK (estado = ANY (ARRAY['pendiente','confirmado','descartado'])));
CREATE UNIQUE INDEX arqueos_stock_un_pendiente_por_sucursal ON public.arqueos_stock (empresa_id, sucursal_id) WHERE (estado = 'pendiente');
ALTER TABLE public.arqueos_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY arq_all ON public.arqueos_stock AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE TABLE public.arqueo_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, arqueo_id uuid NOT NULL REFERENCES arqueos_stock(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL, teorico numeric NOT NULL, fisico numeric NOT NULL,
  diferencia numeric GENERATED ALWAYS AS (fisico - teorico) STORED, ajustado boolean DEFAULT false NOT NULL, descartado boolean DEFAULT false NOT NULL);
ALTER TABLE public.arqueo_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY arqi_all ON public.arqueo_items AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
