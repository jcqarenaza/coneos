-- Réplica mínima del esquema REAL (verificado por catálogo 07/11) para probar en PostgreSQL aislado.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table empresas (id uuid primary key default gen_random_uuid(), nombre text);
create table sucursales (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references empresas(id));
create table usuarios_admin (id uuid primary key, empresa_id uuid not null references empresas(id));
create table categorias (id uuid primary key default gen_random_uuid(), empresa_id uuid references empresas(id));
create table productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  categoria_id uuid not null references categorias(id),
  nombre text not null, imagen_url text, orden int not null default 0, activo boolean not null default true,
  deleted_at timestamptz, constraint productos_id_empresa_uq unique (id, empresa_id));
create table presentaciones (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  empresa_id uuid not null references empresas(id),
  nombre text not null, precio numeric not null default 0, imagen_url text);
create table catalogo_version (sucursal_id uuid primary key references sucursales(id) on delete cascade,
  empresa_id uuid, version int not null default 1, updated_at timestamptz default now());

create or replace function public.auth_empresa_id() returns uuid language sql stable as $$ select empresa_id from usuarios_admin where id = auth.uid() $$;
create or replace function public.bump_catalogo_empresa(p_empresa uuid) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update catalogo_version set version = version + 1, updated_at = now() where empresa_id = p_empresa;
  insert into catalogo_version (sucursal_id, empresa_id) select id, empresa_id from sucursales where empresa_id = p_empresa on conflict (sucursal_id) do nothing;
end $$;
create or replace function public.bump_catalogo_sucursal(p_sucursal uuid, p_empresa uuid) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into catalogo_version (sucursal_id, empresa_id, version, updated_at) values (p_sucursal, p_empresa, 1, now())
  on conflict (sucursal_id) do update set version = catalogo_version.version + 1, updated_at = now();
end $$;
create or replace function public.trg_bump_catalogo() returns trigger language plpgsql as $$
declare r record; v_suc uuid; v_emp uuid;
begin
  r := coalesce(new, old);
  v_suc := nullif(to_jsonb(r)->>'sucursal_id', '')::uuid;
  v_emp := nullif(to_jsonb(r)->>'empresa_id', '')::uuid;
  if v_suc is not null then perform bump_catalogo_sucursal(v_suc, v_emp);
  elsif v_emp is not null then perform bump_catalogo_empresa(v_emp); end if;
  return coalesce(new, old);
end $$;
create trigger bump_catalogo after insert or delete or update on productos for each row execute function trg_bump_catalogo();
create trigger bump_catalogo after insert or delete or update on presentaciones for each row execute function trg_bump_catalogo();

alter table productos enable row level security; alter table presentaciones enable row level security;
create policy admin_productos on productos for all to public using (empresa_id = auth_empresa_id());
create policy admin_presentaciones on presentaciones for all to public using (empresa_id = auth_empresa_id());
alter table usuarios_admin enable row level security;
create policy lee_propio on usuarios_admin for select to public using (id = auth.uid());
alter table empresas enable row level security; alter table sucursales enable row level security; alter table categorias enable row level security;
alter table catalogo_version enable row level security;

-- Datos de partida (pre-migración): imágenes ya existentes, una con espacios, una vacía
insert into empresas(id,nombre) values ('aaaaaaaa-0000-0000-0000-000000000001','A'),('bbbbbbbb-0000-0000-0000-000000000001','B'),('cccccccc-0000-0000-0000-000000000001','C sin fotos');
insert into sucursales(id,empresa_id) values ('a5000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001'),('a5000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001'),('b5000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001'),('c5000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001');
insert into usuarios_admin values ('a0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001'),('b0000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001');
insert into categorias(id,empresa_id) values ('c0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001'),('c0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000001');
insert into productos(id,empresa_id,categoria_id,nombre,imagen_url,deleted_at) values
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','P1 con foto','https://x.supabase.co/storage/v1/object/public/productos/p1.jpg',null),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','P2 sin foto',null,null),
 ('10000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','P3 foto con espacios','  https://x.supabase.co/storage/v1/object/public/productos/p3.jpg ',null),
 ('10000000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','P4 vacio','',null),
 ('10000000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','P5 borrado con foto','https://x.supabase.co/storage/v1/object/public/productos/p5.jpg', now()),
 ('20000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000b','B1','https://x.supabase.co/storage/v1/object/public/productos/b1.jpg',null);
insert into presentaciones(id,producto_id,empresa_id,nombre,imagen_url) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','P1-roja','https://x.supabase.co/storage/v1/object/public/productos/presentaciones/r.jpg'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','P1-azul',null),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','P2-unica',null),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','B1-x','https://x.supabase.co/storage/v1/object/public/productos/presentaciones/bx.jpg');

insert into catalogo_version(sucursal_id, empresa_id, version) select id, empresa_id, 5 from sucursales on conflict (sucursal_id) do update set version = 5;
