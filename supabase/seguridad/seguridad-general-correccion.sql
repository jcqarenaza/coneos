-- ══════════════════════════════════════════════════════════════════════
-- SEGURIDAD GENERAL CONEOS · corrección propuesta (NO APLICADA)
-- Relevamiento 05/11/2026. Correr a mano en el SQL Editor, UN BLOQUE (SEG-n) POR VEZ,
-- recién cuando el CTO dé el GO. Cada bloque es su propia transacción y tiene reversión
-- en seguridad-general-REVERSION.sql. Todo lo de arqueos va por su propio carril
-- (arqueos-seguridad-correccion.sql) y NO está acá.
-- ══════════════════════════════════════════════════════════════════════

-- ───── SEG-1 · Higiene sin impacto en la app ─────────────────────────────
begin; set local lock_timeout = '3s';
-- (a) Funciones de administración de la base: no deben ser públicas.
revoke execute on function public.get_db_size()     from public, anon;
revoke execute on function public.get_table_stats() from public, anon;
-- (b) PIN: lo cambia un admin autenticado; anon no tiene por qué ejecutarlas.
revoke execute on function public.set_pin_colaborador(uuid, uuid, text) from public, anon;
revoke execute on function public.set_pin_operador(uuid, uuid, text)    from public, anon;
-- (c) Vistas: respetar RLS del que consulta (hoy corren con los permisos del dueño).
-- facturacion_config_admin: vista SIN uso en src/ (grep 05/11), corre con permisos del dueño y hoy
-- anon la lee (CUIT/razón social de todas las empresas). Con security_invoker chocaría con SEG-4
-- (cert_pem ya no es legible), así que se cierra por completo; evaluar DROP más adelante.
revoke all on public.facturacion_config_admin from anon, authenticated;
-- v_saldo_proveedor: la usa /api/compras. security_invoker = respeta RLS de cuenta_corriente_proveedor.
-- ⚠ Probar Compras (saldo de proveedores) justo después: si lee con cliente RLS, depende de esa policy.
alter view public.v_saldo_proveedor set (security_invoker = on);
revoke all on public.v_saldo_proveedor from anon;
-- (d) Privilegios que la API nunca usa y que RLS no gobierna (TRUNCATE) o no corresponden.
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop; end $$;
commit;

-- ───── SEG-2 · Inserts abiertos en ítems de pedido ───────────────────────
-- Cualquiera con la anon key podía insertar ítems en pedidos ajenos. El alta de pedidos ya
-- entra por crear_pedido_stock (service_role, ignora RLS); no hay insert de cliente (verificado por grep).
begin; set local lock_timeout = '3s';
drop policy if exists service_insert_pedido_items         on public.pedido_items;
drop policy if exists service_insert_pedido_item_opciones on public.pedido_item_opciones;
commit;

-- ───── SEG-3 · Storage: subidas, reemplazos y borrados públicos ───────────
-- Hoy cualquiera (rol public) sube, reemplaza y borra imágenes de los buckets, sin límite de
-- tamaño ni de tipo. Después: solo un admin con sesión escribe; capturas se sube por el servidor.
begin; set local lock_timeout = '3s';
drop policy if exists "Allow public uploads to capturas" on storage.objects;
drop policy if exists "Allow update logos"        on storage.objects;
drop policy if exists "Allow update logos bucket" on storage.objects;
drop policy if exists "Allow upload logos"        on storage.objects;
drop policy if exists "Allow upload logos bucket" on storage.objects;
drop policy if exists "Allow upload logos pwa"    on storage.objects;
drop policy if exists admin_delete_productos      on storage.objects;
drop policy if exists admin_upload_productos      on storage.objects;
create policy storage_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('productos','logos','assets'));
create policy storage_admin_update on storage.objects for update to authenticated
  using (bucket_id in ('productos','logos','assets')) with check (bucket_id in ('productos','logos','assets'));
create policy storage_admin_delete on storage.objects for delete to authenticated
  using (bucket_id in ('productos','logos','assets'));
-- Límites (los objetos actuales son todos imagen o 1 PDF; el mayor pesa 4,3 MB).
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/x-icon','image/vnd.microsoft.icon']
  where id in ('productos','logos','assets');
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
  where id = 'capturas';
commit;

-- ───── SEG-4 · Secretos fuera del alcance del navegador ──────────────────
-- cert_pem/key_pem (clave privada ARCA) y los tokens de Mercado Pago eran legibles por cualquier
-- admin de la empresa desde el navegador (policy ALL por empresa). El código los lee solo en rutas
-- de servidor con service_role. Se deja SELECT a authenticated solo sobre las demás columnas.
-- ⚠ VERIFICAR antes: ningún componente de cliente hace select('*') sobre estas dos tablas
--   (grep del 05/11: no hay) y las rutas listadas en SEGURIDAD-API.md usan el cliente de servicio.
begin; set local lock_timeout = '3s';
revoke select on public.facturacion_config from authenticated;
grant  select (id, empresa_id, proveedor, punto_venta, condicion_iva, cuit, certificado, activo, created_at,
               razon_social, condicion_fiscal, ambiente, updated_at, auto_facturar, metodos_auto,
               sucursal_id, emite_factura_a, es_fallback, estado) on public.facturacion_config to authenticated;
revoke select on public.mp_credenciales from authenticated;
grant  select (id, empresa_id, mp_user_id, public_key, expires_at, created_at, updated_at, sucursal_id,
               nombre, activo, facturacion_config_id) on public.mp_credenciales to authenticated;
commit;

-- ───── SEG-5 · Cierres de caja abiertos (DEPENDE de una ruta de servidor) ───
-- cierres_caja: policy cierres_all USING(true) para public. La caja (VistaCaja) lee e inserta
-- con el cliente del navegador, igual que pasaba con arqueos. NO aplicar hasta que exista
-- /api/operacion/cierre (device_token + sesión de operador, service_role) y esté desplegada.
-- Después:
--   begin;
--   drop policy cierres_all on public.cierres_caja;
--   create policy cierres_sel_admin on public.cierres_caja for select to authenticated
--     using (empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN');
--   create policy cierres_ins_admin on public.cierres_caja for insert to authenticated
--     with check (empresa_id = auth_empresa_id() or auth_rol() = 'SUPER_ADMIN');
--   revoke all on public.cierres_caja from anon;
--   commit;
-- (La pantalla Ventas del admin inserta y lee con sesión autenticada: sigue andando.)

-- ───── SEG-6 · Manual, sin SQL ────────────────────────────────────────────
-- Panel de Supabase → Authentication → Providers/Password security: activar
-- "Leaked password protection".
