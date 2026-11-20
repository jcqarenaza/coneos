-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FASE D · PRIVATIZAR EL BUCKET `capturas` · 02 · POSTCHECK (SOLO LECTURA)
-- PARA CORRER MANUAL EN EL SQL EDITOR DE SUPABASE (cones-prod) DESPUÉS de 01-aplicar. No modifica nada (ni toma bloqueos).
-- Lanza una excepción si el estado final no es el esperado: capturas privado con sus atributos intactos, policy pública eliminada, las OTRAS 11 policies
-- exactamente iguales a las auditadas (ninguna de más, de menos, renombrada o alterada), RLS activo y assets/logos/productos sin cambios (existen y siguen públicos).
-- Que el resto de las columnas de otros buckets no cambió se prueba con la huella: la última fila debe mostrar los MISMOS md5 que 00-precheck y 01-aplicar.
-- La verificación de A1 y de la URL pública se hace por fuera (ver plan).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

-- >>> ASSERT_ESTADO_DESPUES (idéntico en aplicar, postcheck y reversión; lo verifica el test)
do $chk$
declare b storage.buckets%rowtype; n int; v_rls boolean; v_otros text; v_faltan text; v_sobran text; v_cambiadas text;
begin
  -- RLS activo en storage.objects: sin él las policies auditadas no serían la barrera que se supone.
  select c.relrowsecurity into v_rls from pg_class c where c.oid = 'storage.objects'::regclass;
  if v_rls is distinct from true then raise exception 'ESTADO DESPUÉS: storage.objects NO tiene RLS activo (las policies auditadas no serían la barrera)'; end if;
  select count(*) into n from storage.buckets where id = 'capturas';
  if n <> 1 then raise exception 'ESTADO DESPUÉS: se esperaba exactamente 1 bucket "capturas" y hay %', n; end if;
  select * into b from storage.buckets where id = 'capturas';
  if b.public is distinct from false then raise exception 'ESTADO DESPUÉS: capturas sigue PÚBLICO (public=%)', b.public; end if;
  if b.type::text is distinct from 'STANDARD' or b.file_size_limit is distinct from 10485760
     or b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp','application/pdf']::text[] then
    raise exception 'ESTADO DESPUÉS: capturas no tiene los atributos auditados (type=%, file_size_limit=%, allowed_mime_types=%)', b.type, b.file_size_limit, b.allowed_mime_types; end if;
  -- Los otros tres buckets deben existir y seguir públicos (así se auditaron). Nada de esto se modifica.
  select string_agg(s.id, ', ' order by s.id) into v_otros
    from (values ('assets'), ('logos'), ('productos')) as s(id)
    where not exists (select 1 from storage.buckets k where k.id = s.id and k.public is true);
  if v_otros is not null then raise exception 'ESTADO DESPUÉS: los buckets [%] no existen o no son públicos como en la auditoría', v_otros; end if;
  -- Policies de storage.objects: EXACTAMENTE las 11 auditadas (las 12 auditadas menos "Allow public read from capturas"), comparando nombre, rol, comando, permissive/restrictive, USING y WITH CHECK.
  -- Cualquier policy adicional (aunque no nombre "capturas": una abierta, una restrictiva, para cualquier rol), ausente, renombrada o con la definición alterada ABORTA.
  with esperadas as (
    select * from (values
-- >>> POLICIES_ESPERADAS (las 12 de la auditoría del 18/11; idéntico en todos los scripts; lo verifica el test)
        ('Allow public read from capturas', 'PERMISSIVE', '{public}', 'SELECT', '(bucket_id = ''capturas''::text)', null::text),
        ('Allow read logos', 'PERMISSIVE', '{public}', 'SELECT', '(bucket_id = ''productos''::text)', null),
        ('Allow read logos bucket', 'PERMISSIVE', '{public}', 'SELECT', '(bucket_id = ''logos''::text)', null),
        ('Allow read logos pwa', 'PERMISSIVE', '{public}', 'SELECT', '(bucket_id = ''logos''::text)', null),
        ('public_read_productos', 'PERMISSIVE', '{public}', 'SELECT', '(bucket_id = ''productos''::text)', null),
        ('storage_admin_delete', 'PERMISSIVE', '{authenticated}', 'DELETE', '(bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text]))', null),
        ('storage_admin_insert', 'PERMISSIVE', '{authenticated}', 'INSERT', null, '(bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text]))'),
        ('storage_admin_update', 'PERMISSIVE', '{authenticated}', 'UPDATE', '(bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text]))', '(bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text]))'),
        ('storage_empresa_delete', 'PERMISSIVE', '{authenticated}', 'DELETE', '((bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text])) AND storage_admin_puede(bucket_id, name))', null),
        ('storage_empresa_insert', 'PERMISSIVE', '{authenticated}', 'INSERT', null, '((bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text])) AND storage_admin_puede(bucket_id, name))'),
        ('storage_empresa_select', 'PERMISSIVE', '{authenticated}', 'SELECT', '((bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text])) AND storage_admin_puede(bucket_id, name))', null),
        ('storage_empresa_update', 'PERMISSIVE', '{authenticated}', 'UPDATE', '((bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text])) AND storage_admin_puede(bucket_id, name))', '((bucket_id = ANY (ARRAY[''productos''::text, ''logos''::text, ''assets''::text])) AND storage_admin_puede(bucket_id, name))')
-- <<< POLICIES_ESPERADAS
    ) as v(policyname, permissive, roles, cmd, qual, with_check)
      where v.policyname <> 'Allow public read from capturas'
  ), reales as (
    select policyname::text as policyname, permissive::text as permissive, roles::text as roles, cmd::text as cmd, qual::text as qual, with_check::text as with_check
      from pg_policies where schemaname = 'storage' and tablename = 'objects'
  )
  select coalesce(string_agg(e.policyname, ', ' order by e.policyname) filter (where r.policyname is null), ''),
         coalesce(string_agg(r.policyname, ', ' order by r.policyname) filter (where e.policyname is null), ''),
         coalesce(string_agg(e.policyname, ', ' order by e.policyname) filter (where e.policyname is not null and r.policyname is not null
           and (e.permissive, e.roles, e.cmd, e.qual, e.with_check) is distinct from (r.permissive, r.roles, r.cmd, r.qual, r.with_check)), '')
    into v_faltan, v_sobran, v_cambiadas
    from esperadas e full join reales r on r.policyname = e.policyname;
  if v_faltan <> '' or v_sobran <> '' or v_cambiadas <> '' then
    raise exception 'ESTADO DESPUÉS: las policies de storage.objects NO son exactamente las 11 auditadas. Ausentes: [%]. Sobrantes (no auditadas): [%]. Con definición distinta: [%]', v_faltan, v_sobran, v_cambiadas;
  end if;
end
$chk$;
-- <<< ASSERT_ESTADO_DESPUES

select 'bucket capturas' as elemento, jsonb_build_object('public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types) as estado_final, 'public=false; límites intactos' as esperado
  from storage.buckets b where b.id = 'capturas'
union all
select 'objetos en capturas', jsonb_build_object('cantidad', count(*)), 'igual que antes (496 el 18/11, más los comprobantes nuevos)' from storage.objects where bucket_id = 'capturas'
union all
select 'otros buckets', jsonb_build_object('buckets', string_agg(id || '=' || public::text, ', ' order by id)), 'sin cambios (assets, logos y productos siguen públicos)' from storage.buckets where id <> 'capturas'
union all
select 'policies de storage.objects', jsonb_build_object('cantidad', count(*), 'storage_admin', count(*) filter (where policyname like 'storage\_admin\_%'), 'storage_empresa', count(*) filter (where policyname like 'storage\_empresa\_%')), '11 en total (12 − la eliminada); storage_admin 3 y storage_empresa 4 SIN cambios'
  from pg_policies where schemaname = 'storage' and tablename = 'objects';

-- Comparar las huellas con las de 00-precheck y 01-aplicar.
select 'POSTCHECK OK: capturas es privado, la policy pública no existe y las otras 11 policies son exactamente las auditadas' as resultado,
  (select md5(coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '')) from storage.buckets b where b.id <> 'capturas') as huella_otros_buckets,
  (select md5(coalesce(string_agg(concat_ws('|', policyname, permissive, roles::text, cmd, qual, with_check), E'\n' order by policyname), ''))
     from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname <> 'Allow public read from capturas') as huella_otras_11_policies,
  (select count(*) from storage.objects) as objetos_total;
