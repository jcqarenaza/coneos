-- REVERSIÓN de arqueos-seguridad-correccion.sql: vuelve al estado previo exacto
-- (policies abiertas, GRANT ALL de tabla a anon/authenticated, bump_catalogo_* ejecutable por
-- authenticated, trg_bump_catalogo sin SECURITY DEFINER). Cada parte es independiente.
-- ATENCIÓN: revertir REABRE el agujero (ver AUDITORIA-ARQUEOS.md). Solo si algo se rompe.

-- ── revierte PARTE B ──
begin;
set local lock_timeout = '3s';
drop policy if exists arq_sel_admin  on public.arqueos_stock;
drop policy if exists arq_upd_admin  on public.arqueos_stock;
drop policy if exists arqi_sel_admin on public.arqueo_items;
drop policy if exists arqi_upd_admin on public.arqueo_items;
create policy arq_all  on public.arqueos_stock AS PERMISSIVE FOR ALL TO public using (true) with check (true);
create policy arqi_all on public.arqueo_items  AS PERMISSIVE FOR ALL TO public using (true) with check (true);
revoke all on public.arqueos_stock, public.arqueo_items from anon, authenticated;
grant all on public.arqueos_stock, public.arqueo_items to anon, authenticated;
commit;

-- ── revierte PARTE A ──
begin;
set local lock_timeout = '3s';
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
GRANT EXECUTE ON FUNCTION public.trg_bump_catalogo() TO PUBLIC;   -- ACL por defecto previa
GRANT EXECUTE ON FUNCTION public.bump_catalogo_empresa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_catalogo_sucursal(uuid, uuid) TO authenticated;
commit;
