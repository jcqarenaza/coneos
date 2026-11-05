-- REFERENCIA VERSIONADA — volcado de la base el 2026-11-04 — NO ES MIGRACIÓN, NO APLICAR
-- Proyecto Supabase: wpiwjpvjqshsgrxxwsld (ConeOS). Schema public.
-- Funciones de las que dependen los triggers y las policies RLS de los grupos 01/02/03:
--   trg_bump_catalogo / bump_catalogo_empresa / bump_catalogo_sucursal  (bump de catalogo_version)
--   set_updated_at                                                      (trigger BEFORE UPDATE)
--   auth_empresa_id / auth_rol                                          (policies RLS y autorización)
-- Análisis de triggers y locks: ver 04-triggers-y-dependencias.md
-- Los saltos de línea originales en la base son CRLF; acá se guardan como LF.

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

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end;
$function$;
-- GRANTS (proacl por defecto: PUBLIC, anon, authenticated, service_role, postgres) — sin REVOKE

CREATE OR REPLACE FUNCTION public.auth_empresa_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select empresa_id from usuarios_admin where id = auth.uid()
$function$;
-- GRANTS (proacl por defecto: PUBLIC, anon, authenticated, service_role, postgres) — sin REVOKE

CREATE OR REPLACE FUNCTION public.auth_rol()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select rol from usuario_admin_roles
  where usuario_id = auth.uid()
  order by case rol
    when 'SUPER_ADMIN'    then 1
    when 'ADMIN_EMPRESA'  then 2
    when 'ADMIN_SUCURSAL' then 3
  end limit 1
$function$;
-- GRANTS (proacl por defecto: PUBLIC, anon, authenticated, service_role, postgres) — sin REVOKE
