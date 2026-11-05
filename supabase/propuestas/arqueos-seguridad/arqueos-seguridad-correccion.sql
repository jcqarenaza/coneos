-- ============================================================================
-- CORRECCIÓN DE SEGURIDAD DE ARQUEOS — propuesta (NO aplicada en ningún Supabase)
-- Orden CTO 4/11 punto 3. Dos partes INDEPENDIENTES, cada una en su transacción:
--
--   PARTE A (bump_catalogo): aplicable en cualquier momento.
--   PARTE B (arqueos): aplicar SOLO DESPUÉS de desplegar feature/arqueo-servidor.
--           Hoy VistaCaja (main) inserta arqueos con el cliente del navegador; al cerrar las
--           policies/grants ese alta dejaría de funcionar. Con arqueo-servidor el alta va por
--           /api/operacion/arqueo con service_role (no pasa por RLS).
--
-- Reversión: arqueos-seguridad-REVERSION.sql (deja el estado exacto previo; verificado
-- por huella de policies/grants/ACL en la prueba).
-- Ejecutar a mano en el SQL Editor, una parte por vez.
-- ============================================================================

-- ───────────────────────── PARTE A · bump_catalogo_* ─────────────────────────
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

-- ───────────────────────── PARTE B · arqueos_stock / arqueo_items ─────────────────────────
begin;
set local lock_timeout = '3s';

drop policy if exists arq_all  on public.arqueos_stock;
drop policy if exists arqi_all on public.arqueo_items;

-- Solo el admin autenticado de la propia empresa (o SUPER_ADMIN) lee y actualiza.
-- Alta y baja: únicamente el servidor (service_role ignora RLS).
create policy arq_sel_admin on public.arqueos_stock for select to authenticated
  using (empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN');
create policy arq_upd_admin on public.arqueos_stock for update to authenticated
  using      (empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN')
  with check (empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN');

create policy arqi_sel_admin on public.arqueo_items for select to authenticated
  using (exists (select 1 from public.arqueos_stock a where a.id = arqueo_id
                  and (a.empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN')));
create policy arqi_upd_admin on public.arqueo_items for update to authenticated
  using (exists (select 1 from public.arqueos_stock a where a.id = arqueo_id
                  and (a.empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN')))
  with check (exists (select 1 from public.arqueos_stock a where a.id = arqueo_id
                  and (a.empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN')));

-- Permisos de tabla: anon sin nada; authenticated solo lo que la pantalla de admin usa.
revoke all on public.arqueos_stock, public.arqueo_items from anon, authenticated;
grant select on public.arqueos_stock, public.arqueo_items to authenticated;
grant update (estado, confirmado_por, confirmado_at) on public.arqueos_stock to authenticated;
grant update (descartado, ajustado)                  on public.arqueo_items  to authenticated;
commit;
