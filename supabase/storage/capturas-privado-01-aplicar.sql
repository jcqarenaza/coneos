-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FASE D · PRIVATIZAR EL BUCKET `capturas` · 01 · APLICAR   —   SOLO CON GO ESPECÍFICO DEL CTO
-- PARA CORRER MANUAL EN EL SQL EDITOR DE SUPABASE (cones-prod). UN SOLO SCRIPT, UNA SOLA TRANSACCIÓN (si algo falla no queda nada aplicado).
--
-- QUÉ HACE (y nada más):
--   1. Toma los bloqueos y, DENTRO de la transacción y ANTES de modificar nada, verifica de nuevo el estado exacto auditado (mismo bloque que 00-precheck):
--      RLS activo, las 12 policies exactas, bucket capturas público con sus atributos, buckets assets/logos/productos públicos. Si difiere, ABORTA.
--   2. Toma una huella de lo que NO se debe tocar: otros buckets, las otras 11 policies y el conjunto de objetos.
--   3. UPDATE storage.buckets SET public = false WHERE id = 'capturas'  (exactamente 1 fila).
--   4. DROP POLICY "Allow public read from capturas" ON storage.objects  (y solo esa).
--   5. Verifica el estado final (las 11 policies exactas, capturas privado con atributos intactos) y compara la huella: si algo más cambió, ABORTA (rollback de la transacción).
--
-- NO TOCA: objetos (ni copia, ni mueve, ni borra), los 81 objetos en cuarentena, otros buckets, policies storage_admin_* ni storage_empresa_*,
--          funciones, tablas de datos, pedidos, código.
-- BLOQUEO: storage.objects queda bloqueada unos milisegundos (lo mismo que exige el DROP POLICY); si no se consigue en 5 s el script aborta sin cambios.
-- ESCRITURA: no cambia (se escribe con service_role, que no depende de policies). LECTURA: A1 firma con service_role: sigue funcionando.
-- DOBLE EJECUCIÓN: la segunda corrida ABORTA en la verificación inicial ("capturas ya NO es público") y no cambia nada.
-- REVERSIÓN: capturas-privado-REVERSION-NO-EJECUTAR.sql (restaura exactamente el estado anterior).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

begin;
-- >>> BLOQUEOS_Y_TIEMPOS (idéntico en aplicar y reversión; lo verifica el test)
-- Se toman ANTES de verificar: así el estado verificado es el mismo que se modifica (nadie puede cambiar policies ni buckets en el medio).
-- DROP/CREATE POLICY igualmente exige este bloqueo; se toma al inicio. Si no se consigue en 5 s, el script ABORTA sin cambiar nada.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table storage.objects in access exclusive mode;
lock table storage.buckets in share row exclusive mode;
-- <<< BLOQUEOS_Y_TIEMPOS

-- >>> ASSERT_ESTADO_ANTES (idéntico en precheck, aplicar y reversión; lo verifica el test)
do $chk$
declare b storage.buckets%rowtype; n int; v_rls boolean; v_otros text; v_faltan text; v_sobran text; v_cambiadas text;
begin
  -- RLS activo en storage.objects: sin él las policies auditadas no serían la barrera que se supone.
  select c.relrowsecurity into v_rls from pg_class c where c.oid = 'storage.objects'::regclass;
  if v_rls is distinct from true then raise exception 'ESTADO ANTES: storage.objects NO tiene RLS activo (las policies auditadas no serían la barrera)'; end if;
  select count(*) into n from storage.buckets where id = 'capturas';
  if n <> 1 then raise exception 'ESTADO ANTES: se esperaba exactamente 1 bucket "capturas" y hay %', n; end if;
  select * into b from storage.buckets where id = 'capturas';
  if b.public is distinct from true then raise exception 'ESTADO ANTES: capturas ya NO es público (public=%): no es el estado esperado', b.public; end if;
  if b.type::text is distinct from 'STANDARD' or b.file_size_limit is distinct from 10485760
     or b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp','application/pdf']::text[] then
    raise exception 'ESTADO ANTES: capturas no tiene los atributos auditados (type=%, file_size_limit=%, allowed_mime_types=%)', b.type, b.file_size_limit, b.allowed_mime_types; end if;
  -- Los otros tres buckets deben existir y seguir públicos (así se auditaron). Nada de esto se modifica.
  select string_agg(s.id, ', ' order by s.id) into v_otros
    from (values ('assets'), ('logos'), ('productos')) as s(id)
    where not exists (select 1 from storage.buckets k where k.id = s.id and k.public is true);
  if v_otros is not null then raise exception 'ESTADO ANTES: los buckets [%] no existen o no son públicos como en la auditoría', v_otros; end if;
  -- Policies de storage.objects: EXACTAMENTE las 12 auditadas, comparando nombre, rol, comando, permissive/restrictive, USING y WITH CHECK.
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
    raise exception 'ESTADO ANTES: las policies de storage.objects NO son exactamente las 12 auditadas. Ausentes: [%]. Sobrantes (no auditadas): [%]. Con definición distinta: [%]', v_faltan, v_sobran, v_cambiadas;
  end if;
end
$chk$;
-- <<< ASSERT_ESTADO_ANTES

-- >>> HUELLA_LO_QUE_NO_SE_TOCA (idéntico en aplicar y reversión; lo verifica el test)
create temp table _capturas_huella_antes on commit drop as
select
  (select md5(coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '')) from storage.buckets b where b.id <> 'capturas') as otros_buckets,
  (select md5(coalesce(string_agg(concat_ws('|', policyname, permissive, roles::text, cmd, qual, with_check), E'\n' order by policyname), ''))
     from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname <> 'Allow public read from capturas') as otras_policies,
  (select count(*) from storage.objects) as objetos_total,
  (select md5(coalesce(string_agg(bucket_id || '/' || name, E'\n' order by bucket_id, name), '')) from storage.objects) as objetos_rutas;
-- <<< HUELLA_LO_QUE_NO_SE_TOCA

-- Los dos cambios (únicos de todo el script):
do $cambio$
declare n int;
begin
  update storage.buckets set public = false where id = 'capturas' and public = true;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'APLICAR: el UPDATE de storage.buckets afectó % filas (se esperaba 1)', n; end if;
  drop policy "Allow public read from capturas" on storage.objects;
end
$cambio$;

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

-- >>> COMPARAR_HUELLA (idéntico en aplicar y reversión; lo verifica el test)
do $chk$
declare a record; d record;
begin
  select * into a from _capturas_huella_antes;
  select
    (select md5(coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '')) from storage.buckets b where b.id <> 'capturas') as otros_buckets,
    (select md5(coalesce(string_agg(concat_ws('|', policyname, permissive, roles::text, cmd, qual, with_check), E'\n' order by policyname), ''))
     from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname <> 'Allow public read from capturas') as otras_policies,
    (select count(*) from storage.objects) as objetos_total,
    (select md5(coalesce(string_agg(bucket_id || '/' || name, E'\n' order by bucket_id, name), '')) from storage.objects) as objetos_rutas
  into d;
  if d.otros_buckets  is distinct from a.otros_buckets  then raise exception 'HUELLA: cambió otro bucket (no autorizado)'; end if;
  if d.otras_policies is distinct from a.otras_policies then raise exception 'HUELLA: cambió otra policy de storage.objects (no autorizado)'; end if;
  if d.objetos_total  is distinct from a.objetos_total  then raise exception 'HUELLA: cambió la cantidad de objetos (% → %)', a.objetos_total, d.objetos_total; end if;
  if d.objetos_rutas  is distinct from a.objetos_rutas  then raise exception 'HUELLA: cambió el conjunto de objetos'; end if;
end
$chk$;
-- <<< COMPARAR_HUELLA

commit;

-- Las huellas deben ser IGUALES a las que mostró 00-precheck.
select 'APLICADO: capturas es privado y la policy de lectura pública fue eliminada. Correr 02-postcheck y la verificación externa del plan.' as resultado,
  (select md5(coalesce(string_agg(to_jsonb(b)::text, E'\n' order by b.id), '')) from storage.buckets b where b.id <> 'capturas') as huella_otros_buckets,
  (select md5(coalesce(string_agg(concat_ws('|', policyname, permissive, roles::text, cmd, qual, with_check), E'\n' order by policyname), ''))
     from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname <> 'Allow public read from capturas') as huella_otras_11_policies,
  (select count(*) from storage.objects) as objetos_total;
