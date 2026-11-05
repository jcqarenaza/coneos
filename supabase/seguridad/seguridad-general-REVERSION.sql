-- Reversión de seguridad-general-correccion.sql (cada bloque por separado). Reabre lo que cierra.
-- SEG-4
begin; grant select on public.facturacion_config to authenticated; grant select on public.mp_credenciales to authenticated; commit;
-- SEG-3
begin;
drop policy if exists storage_admin_insert on storage.objects;
drop policy if exists storage_admin_update on storage.objects;
drop policy if exists storage_admin_delete on storage.objects;
create policy "Allow public uploads to capturas" on storage.objects for insert to public with check (bucket_id = 'capturas');
create policy "Allow update logos"        on storage.objects for update to public using (bucket_id = 'productos') with check (bucket_id = 'productos');
create policy "Allow update logos bucket" on storage.objects for update to public using (bucket_id = 'logos') with check (bucket_id = 'logos');
create policy "Allow upload logos"        on storage.objects for insert to public with check (bucket_id = 'productos');
create policy "Allow upload logos bucket" on storage.objects for insert to public with check (bucket_id = 'logos');
create policy "Allow upload logos pwa"    on storage.objects for insert to public with check (bucket_id = 'logos');
create policy admin_delete_productos      on storage.objects for delete to public using (bucket_id = 'productos');
create policy admin_upload_productos      on storage.objects for insert to public with check (bucket_id = 'productos');
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id in ('productos','logos','assets','capturas');
commit;
-- SEG-2
begin;
create policy service_insert_pedido_items         on public.pedido_items         for insert to public with check (true);
create policy service_insert_pedido_item_opciones on public.pedido_item_opciones for insert to public with check (true);
commit;
-- SEG-1
begin;
grant execute on function public.get_db_size()     to anon;   -- original: solo anon/service_role/postgres, no PUBLIC
grant execute on function public.get_table_stats() to anon;
grant execute on function public.set_pin_colaborador(uuid, uuid, text) to public;
grant execute on function public.set_pin_operador(uuid, uuid, text)    to public;
alter view public.v_saldo_proveedor set (security_invoker = off);
grant all on public.facturacion_config_admin, public.v_saldo_proveedor to anon, authenticated;  -- estado original
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('grant truncate, references, trigger on public.%I to anon, authenticated', t.relname);
  end loop; end $$;
commit;
