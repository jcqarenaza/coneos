do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
begin;
set local lock_timeout = '3s';

-- trg_bump_catalogo pasa a SECURITY DEFINER: antes corría como el rol que escribe y por eso
-- bump_catalogo_* necesitaba EXECUTE para authenticated. Mismo cuerpo, sin cambios de lógica.
CREATE OR REPLACE FUNCTION public.trg_bump_catalogo()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  r record;
  v_suc uuid;
  v_emp uuid;
begin
  r := coalesce(new, old);
  v_suc := nullif(to_jsonb(r)->>'sucursal_id', '')::uuid;
  v_emp := nullif(to_jsonb(r)->>'empresa_id', '')::uuid;
  if v_suc is not null then
    perform bump_catalogo_sucursal(v_suc, v_emp);
  elsif v_emp is not null then
    perform bump_catalogo_empresa(v_emp);
  end if;
  return coalesce(new, old);
end $function$;
REVOKE ALL ON FUNCTION public.trg_bump_catalogo() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.bump_catalogo_empresa(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_catalogo_sucursal(uuid, uuid) FROM authenticated;
commit;
