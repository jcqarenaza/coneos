// FASE D (preparación) · SQL de privatización de `capturas`: precheck EXACTO, aplicar, postcheck y REVERSIÓN, contra un Postgres 16 local descartable
// con un esquema `storage` mínimo que replica el estado auditado de cones-prod (listado de pg_policies del 18/11, pasado por JC el 19/11):
// 4 buckets públicos y 12 policies en storage.objects. NO es Supabase: prueba la lógica de los scripts (estado exacto, bloqueo, atomicidad, reversión).
// Ejecutar: npx tsx --test src/lib/__tests__/capturas-privado-sql.test.ts
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import pg from 'pg'

const DIR = join(process.cwd(), 'supabase', 'storage')
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8')
const PRE = leer('capturas-privado-00-precheck.sql'), APLICAR = leer('capturas-privado-01-aplicar.sql')
const POST = leer('capturas-privado-02-postcheck.sql'), REVERSION = leer('capturas-privado-REVERSION-NO-EJECUTAR.sql')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const MIME_IMG = `array['image/jpeg','image/png','image/webp','image/gif','image/x-icon','image/vnd.microsoft.icon']`
let admin: pg.Client
const dbs: string[] = []
let contador = 0

// Listado REAL de pg_policies (cones-prod, 18/11): texto tal como lo devuelve Postgres. Es la fuente independiente contra la que se prueba el SQL.
const B3 = "(bucket_id = ANY (ARRAY['productos'::text, 'logos'::text, 'assets'::text]))"
const E3 = "((bucket_id = ANY (ARRAY['productos'::text, 'logos'::text, 'assets'::text])) AND storage_admin_puede(bucket_id, name))"
type Fila = { policyname: string; permissive: string; roles: string; cmd: string; qual: string | null; with_check: string | null }
const AUDITADAS: Fila[] = [
  { policyname: 'Allow public read from capturas', permissive: 'PERMISSIVE', roles: '{public}', cmd: 'SELECT', qual: "(bucket_id = 'capturas'::text)", with_check: null },
  { policyname: 'Allow read logos', permissive: 'PERMISSIVE', roles: '{public}', cmd: 'SELECT', qual: "(bucket_id = 'productos'::text)", with_check: null },
  { policyname: 'Allow read logos bucket', permissive: 'PERMISSIVE', roles: '{public}', cmd: 'SELECT', qual: "(bucket_id = 'logos'::text)", with_check: null },
  { policyname: 'Allow read logos pwa', permissive: 'PERMISSIVE', roles: '{public}', cmd: 'SELECT', qual: "(bucket_id = 'logos'::text)", with_check: null },
  { policyname: 'public_read_productos', permissive: 'PERMISSIVE', roles: '{public}', cmd: 'SELECT', qual: "(bucket_id = 'productos'::text)", with_check: null },
  { policyname: 'storage_admin_delete', permissive: 'PERMISSIVE', roles: '{authenticated}', cmd: 'DELETE', qual: B3, with_check: null },
  { policyname: 'storage_admin_insert', permissive: 'PERMISSIVE', roles: '{authenticated}', cmd: 'INSERT', qual: null, with_check: B3 },
  { policyname: 'storage_admin_update', permissive: 'PERMISSIVE', roles: '{authenticated}', cmd: 'UPDATE', qual: B3, with_check: B3 },
  { policyname: 'storage_empresa_delete', permissive: 'PERMISSIVE', roles: '{authenticated}', cmd: 'DELETE', qual: E3, with_check: null },
  { policyname: 'storage_empresa_insert', permissive: 'PERMISSIVE', roles: '{authenticated}', cmd: 'INSERT', qual: null, with_check: E3 },
  { policyname: 'storage_empresa_select', permissive: 'PERMISSIVE', roles: '{authenticated}', cmd: 'SELECT', qual: E3, with_check: null },
  { policyname: 'storage_empresa_update', permissive: 'PERMISSIVE', roles: '{authenticated}', cmd: 'UPDATE', qual: E3, with_check: E3 },
]

const ESQUEMA = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], owner_id text, type text not null default 'STANDARD');
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create function public.storage_admin_puede(b text, n text) returns boolean language sql as $$ select true $$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('assets','assets',true,10485760,${MIME_IMG}), ('logos','logos',true,10485760,${MIME_IMG}), ('productos','productos',true,10485760,${MIME_IMG}),
  ('capturas','capturas',true,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy "Allow public read from capturas" on storage.objects for select to public using (bucket_id = 'capturas');
create policy "Allow read logos"        on storage.objects for select to public using (bucket_id = 'productos');
create policy "Allow read logos bucket" on storage.objects for select to public using (bucket_id = 'logos');
create policy "Allow read logos pwa"    on storage.objects for select to public using (bucket_id = 'logos');
create policy public_read_productos     on storage.objects for select to public using (bucket_id = 'productos');
create policy storage_admin_delete on storage.objects for delete to authenticated using (bucket_id = any (array['productos','logos','assets']));
create policy storage_admin_insert on storage.objects for insert to authenticated with check (bucket_id = any (array['productos','logos','assets']));
create policy storage_admin_update on storage.objects for update to authenticated using (bucket_id = any (array['productos','logos','assets'])) with check (bucket_id = any (array['productos','logos','assets']));
create policy storage_empresa_delete on storage.objects for delete to authenticated using ((bucket_id = any (array['productos','logos','assets'])) and storage_admin_puede(bucket_id, name));
create policy storage_empresa_insert on storage.objects for insert to authenticated with check ((bucket_id = any (array['productos','logos','assets'])) and storage_admin_puede(bucket_id, name));
create policy storage_empresa_select on storage.objects for select to authenticated using ((bucket_id = any (array['productos','logos','assets'])) and storage_admin_puede(bucket_id, name));
create policy storage_empresa_update on storage.objects for update to authenticated using ((bucket_id = any (array['productos','logos','assets'])) and storage_admin_puede(bucket_id, name)) with check ((bucket_id = any (array['productos','logos','assets'])) and storage_admin_puede(bucket_id, name));
insert into storage.objects (bucket_id, name) values
  ('capturas','pedidos/30000000-0000-4000-8000-000000000001.jpg'), ('capturas','pedidos/30000000-0000-4000-8000-000000000002.pdf'),
  ('capturas','e0000000-0000-4000-8000-000000000001/pedidos/30000000-0000-4000-8000-000000000003.png'), ('capturas','zz-cuarentena/sin-referencia.png'),
  ('productos','e0000000-0000-4000-8000-000000000001/productos/a.jpg'), ('logos','e0000000-0000-4000-8000-000000000001/logos/l.png');
`

async function mundo(extra = ''): Promise<pg.Pool> {
  const nombre = `t_fd_${process.pid}_${++contador}`
  await admin.query(`drop database if exists ${nombre} with (force)`); await admin.query(`create database ${nombre}`); dbs.push(nombre)
  const p = new pg.Pool({ ...SOCK, database: nombre, max: 3 }); p.on('error', () => {})
  await p.query(ESQUEMA + extra)
  return p
}
/** Corre un script en UNA conexión; si falla, hace ROLLBACK (como el SQL Editor al abortar) y devuelve el mensaje. */
async function correr(p: pg.Pool, sql: string): Promise<string | null> {
  const c = await p.connect()
  try { await c.query(sql); return null } catch (e) { await c.query('rollback').catch(() => {}); return (e as Error).message } finally { c.release() }
}
const estado = async (p: pg.Pool) => {
  const b = (await p.query(`select to_jsonb(b) - 'updated_at' as b from storage.buckets b where id = 'capturas'`)).rows[0].b
  const pol = (await p.query(`select policyname::text, permissive::text, roles::text, cmd::text, qual, with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname`)).rows
  const otros = (await p.query(`select to_jsonb(b)::text as b from storage.buckets b where id <> 'capturas' order by id`)).rows
  const obj = (await p.query(`select bucket_id, name from storage.objects order by 1,2`)).rows
  const rls = (await p.query(`select relrowsecurity from pg_class where oid = 'storage.objects'::regclass`)).rows[0].relrowsecurity
  return { b, pol, otros, obj, rls }
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const bloques = (sql: string, nombre: string) => { const out = [...sql.matchAll(new RegExp(`-- >>> ${nombre}[^\\n]*\\n([\\s\\S]*?)-- <<< ${nombre}`, 'g'))].map(m => m[1]); return out }
const bloque = (sql: string, nombre: string) => { const b = bloques(sql, nombre); assert.equal(b.length, 1, `se esperaba 1 bloque ${nombre} y hay ${b.length}`); return b[0] }
const sinComentarios = (sql: string) => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
const sinLiterales = (sql: string) => sinComentarios(sql).replace(/'(?:[^']|'')*'/g, "''")   // quita los textos entre comillas simples (mensajes, nombres de policy, cmd 'INSERT')

before(async () => { admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect() })
after(async () => { for (const d of dbs) await admin.query(`drop database if exists ${d} with (force)`); await admin.end() })

// ═══ Estados "distintos del auditado" (la columna ANTES debe abortar; DESPUÉS se prueba aparte) ═══
const alt = (nombre: string, using: string, extra = '') => `alter policy ${nombre} on storage.objects ${extra} using (${using})`
const DESVIOS_ANTES: [string, string, RegExp][] = [
  // policy ADICIONAL (cualquier forma de alcanzar capturas, mencione o no el bucket)
  ['adicional abierta: SELECT public using(true)', `create policy abierta on storage.objects for select to public using (true)`, /Sobrantes \(no auditadas\): \[abierta\]/],
  ['adicional abierta para anon', `create policy abierta_anon on storage.objects for select to anon using (true)`, /Sobrantes \(no auditadas\): \[abierta_anon\]/],
  ['adicional abierta para authenticated', `create policy abierta_auth on storage.objects for select to authenticated using (true)`, /Sobrantes \(no auditadas\): \[abierta_auth\]/],
  ['adicional ALL public using(true)', `create policy todo on storage.objects for all to public using (true)`, /Sobrantes \(no auditadas\): \[todo\]/],
  ['adicional que alcanza capturas SIN nombrarlo (bucket_id <> logos)', `create policy casi on storage.objects for select to public using (bucket_id <> 'logos')`, /Sobrantes \(no auditadas\): \[casi\]/],
  ['adicional que nombra capturas', `create policy extra_capturas on storage.objects for select to anon using (bucket_id = 'capturas')`, /Sobrantes \(no auditadas\): \[extra_capturas\]/],
  ['adicional de escritura INSERT anon', `create policy ins on storage.objects for insert to anon with check (true)`, /Sobrantes \(no auditadas\): \[ins\]/],
  ['adicional RESTRICTIVA', `create policy restr on storage.objects as restrictive for select to public using (bucket_id = 'logos')`, /Sobrantes \(no auditadas\): \[restr\]/],
  // policy RENOMBRADA
  ['renombrada: "Allow read logos"', `alter policy "Allow read logos" on storage.objects rename to "Allow read logos X"`, /Ausentes: \[Allow read logos\]\. Sobrantes \(no auditadas\): \[Allow read logos X\]/],
  ['renombrada: la de capturas', `alter policy "Allow public read from capturas" on storage.objects rename to "Allow public read capturas"`, /Ausentes: \[Allow public read from capturas\]\. Sobrantes \(no auditadas\): \[Allow public read capturas\]/],
  // EXPRESIÓN alterada (USING / WITH CHECK / rol / permissive)
  ['USING alterado: storage_empresa_select incluye capturas', alt('storage_empresa_select', `(bucket_id = any (array['productos','logos','assets','capturas'])) and storage_admin_puede(bucket_id, name)`), /Con definición distinta: \[storage_empresa_select\]/],
  ['USING alterado: public_read_productos con otro bucket', alt('public_read_productos', `bucket_id = 'capturas'`), /Con definición distinta: \[public_read_productos\]/],
  ['USING alterado: la de capturas con condición extra', alt('"Allow public read from capturas"', `bucket_id = 'capturas' and name like 'pedidos/%'`), /Con definición distinta: \[Allow public read from capturas\]/],
  ['WITH CHECK alterado: storage_admin_insert (true)', `alter policy storage_admin_insert on storage.objects with check (true)`, /Con definición distinta: \[storage_admin_insert\]/],
  ['rol alterado: public_read_productos pasa a anon', `alter policy public_read_productos on storage.objects to anon`, /Con definición distinta: \[public_read_productos\]/],
  ['rol alterado: storage_admin_delete pasa a public', `alter policy storage_admin_delete on storage.objects to public`, /Con definición distinta: \[storage_admin_delete\]/],
  ['permissive alterado: misma policy pero RESTRICTIVE', `drop policy "Allow read logos pwa" on storage.objects; create policy "Allow read logos pwa" on storage.objects as restrictive for select to public using (bucket_id = 'logos')`, /Con definición distinta: \[Allow read logos pwa\]/],
  ['comando alterado: la de capturas pasa a ALL', `drop policy "Allow public read from capturas" on storage.objects; create policy "Allow public read from capturas" on storage.objects for all to public using (bucket_id = 'capturas')`, /Con definición distinta: \[Allow public read from capturas\]/],
  // policy AUSENTE
  ['ausente: public_read_productos', `drop policy public_read_productos on storage.objects`, /Ausentes: \[public_read_productos\]/],
  ['ausente: storage_admin_update', `drop policy storage_admin_update on storage.objects`, /Ausentes: \[storage_admin_update\]/],
  ['ausente: la de capturas', `drop policy "Allow public read from capturas" on storage.objects`, /Ausentes: \[Allow public read from capturas\]/],
  // RLS y buckets
  ['RLS desactivado en storage.objects', `alter table storage.objects disable row level security`, /NO tiene RLS activo/],
  ['capturas ya privado', `update storage.buckets set public = false where id = 'capturas'`, /ya NO es público/],
  ['capturas: límite de tamaño distinto', `update storage.buckets set file_size_limit = 5242880 where id = 'capturas'`, /atributos auditados/],
  ['capturas: tipos MIME distintos', `update storage.buckets set allowed_mime_types = array['image/png'] where id = 'capturas'`, /atributos auditados/],
  ['capturas: sin límite de MIME', `update storage.buckets set allowed_mime_types = null where id = 'capturas'`, /atributos auditados/],
  ['otro bucket privado: logos', `update storage.buckets set public = false where id = 'logos'`, /buckets \[logos\] no existen o no son públicos/],
  ['otro bucket ausente: assets', `delete from storage.buckets where id = 'assets'`, /buckets \[assets\] no existen o no son públicos/],
]

describe('ESTÁTICO: los scripts hacen solo lo autorizado', () => {
  test('los bloques compartidos son IDÉNTICOS entre scripts (byte a byte)', () => {
    const antes = [bloque(PRE, 'ASSERT_ESTADO_ANTES'), bloque(APLICAR, 'ASSERT_ESTADO_ANTES'), bloque(REVERSION, 'ASSERT_ESTADO_ANTES')]
    assert.equal(new Set(antes.map(sha)).size, 1)
    const despues = [bloque(APLICAR, 'ASSERT_ESTADO_DESPUES'), bloque(POST, 'ASSERT_ESTADO_DESPUES'), bloque(REVERSION, 'ASSERT_ESTADO_DESPUES')]
    assert.equal(new Set(despues.map(sha)).size, 1)
    for (const b of ['HUELLA_LO_QUE_NO_SE_TOCA', 'COMPARAR_HUELLA', 'BLOQUEOS_Y_TIEMPOS']) assert.equal(sha(bloque(APLICAR, b)), sha(bloque(REVERSION, b)), b)
    const listas = [PRE, APLICAR, POST, REVERSION].flatMap(s => bloques(s, 'POLICIES_ESPERADAS'))
    assert.equal(listas.length, 6)                                    // precheck 1 + aplicar 2 + postcheck 1 + reversión 2
    assert.equal(new Set(listas.map(sha)).size, 1)
  })
  test('la lista de policies del SQL contiene EXACTAMENTE las 12 auditadas (nombres) y el estado DESPUÉS excluye solo la de capturas', () => {
    const lista = bloques(PRE, 'POLICIES_ESPERADAS')[0]
    const nombres = [...lista.matchAll(/^\s+\('((?:[^']|'')*)', 'PERMISSIVE'/gm)].map(m => m[1])
    assert.deepEqual(nombres.sort(), AUDITADAS.map(a => a.policyname).sort())
    assert.equal(nombres.length, 12)
    assert.match(bloque(POST, 'ASSERT_ESTADO_DESPUES'), /where v\.policyname <> 'Allow public read from capturas'/)
    assert.equal(/where v\.policyname <>/.test(bloque(PRE, 'ASSERT_ESTADO_ANTES')), false)
  })
  test('APLICAR: primero bloquea, luego verifica el estado exacto, y recién después modifica (todo dentro de UNA transacción)', () => {
    const s = sinComentarios(APLICAR)
    const i = (t: string) => { const k = s.indexOf(t); assert.ok(k >= 0, t); return k }
    assert.ok(i('begin;') < i('lock table storage.objects in access exclusive mode;'))
    assert.ok(i("set local lock_timeout = '5s';") < i('lock table storage.objects'))
    assert.ok(i('lock table storage.objects') < i('lock table storage.buckets in share row exclusive mode;'))
    assert.ok(i('lock table storage.buckets') < i('ESTADO ANTES: se esperaba'))                  // la verificación va DESPUÉS de los bloqueos
    assert.ok(i('ESTADO ANTES: se esperaba') < i('update storage.buckets'))                      // y ANTES de la primera modificación
    assert.ok(i('update storage.buckets') < i('drop policy'))
    assert.ok(i('drop policy') < i('ESTADO DESPUÉS: se esperaba'))
    assert.ok(i('ESTADO DESPUÉS: se esperaba') < i('HUELLA: cambió otro bucket'))
    assert.ok(i('HUELLA: cambió otro bucket') < i('commit;'))
    assert.equal((s.match(/\bbegin;/g) ?? []).length, 1); assert.equal((s.match(/\bcommit;/g) ?? []).length, 1)
  })
  test('APLICAR: exactamente un UPDATE de storage.buckets (public=false, solo capturas) y un DROP POLICY (solo la de lectura pública de capturas)', () => {
    const s = sinComentarios(APLICAR)
    assert.equal((sinLiterales(APLICAR).match(/\bupdate\s+storage\.buckets\b/gi) ?? []).length, 1)
    assert.match(s, /update storage\.buckets set public = false where id = 'capturas' and public = true;/)
    assert.deepEqual(s.match(/\bdrop\s+(?:policy|table|function|schema|bucket|trigger|index|view)\b[^;]*;/gi), ['drop policy "Allow public read from capturas" on storage.objects;'])
    const c = sinLiterales(APLICAR)
    for (const prohibido of [/\bdelete\b/i, /\binsert\b/i, /\btruncate\b/i, /\balter\b/i, /\bgrant\b/i, /\brevoke\b/i, /\bcreate\s+policy\b/i, /storage_admin_/i, /storage_empresa_/i, /\bdrop\s+(table|function|schema|bucket)\b/i]) {
      assert.equal(prohibido.test(c), false, String(prohibido))
    }
  })
  test('REVERSIÓN: bloquea y verifica el estado posterior ANTES de tocar; exactamente un UPDATE (public=true) y un CREATE POLICY con la definición original; nada más', () => {
    const s = sinComentarios(REVERSION)
    const i = (t: string) => { const k = s.indexOf(t); assert.ok(k >= 0, t); return k }
    assert.ok(i('lock table storage.objects') < i('ESTADO DESPUÉS: se esperaba') && i('ESTADO DESPUÉS: se esperaba') < i('update storage.buckets'))
    assert.ok(i('create policy') < i('ESTADO ANTES: se esperaba') && i('ESTADO ANTES: se esperaba') < i('HUELLA: cambió otro bucket') && i('HUELLA: cambió otro bucket') < i('commit;'))
    assert.match(s, /update storage\.buckets set public = true where id = 'capturas' and public = false;/)
    assert.deepEqual(s.match(/\bcreate\s+policy\b[^;]*;/gi), [`create policy "Allow public read from capturas" on storage.objects for select to public using (bucket_id = 'capturas');`])
    const c = sinLiterales(REVERSION)
    for (const prohibido of [/\bdelete\b/i, /\binsert\b/i, /\btruncate\b/i, /\balter\b/i, /\bdrop\s+policy\b/i, /\bgrant\b/i, /\brevoke\b/i]) assert.equal(prohibido.test(c), false, String(prohibido))
  })
  test('PRECHECK y POSTCHECK son solo lectura (ni DDL, ni DML, ni siquiera bloqueos)', () => {
    for (const sql of [PRE, POST]) {
      const c = sinLiterales(sql)
      for (const p of [/\bupdate\b/i, /\bdelete\b/i, /\binsert\b/i, /\balter\b/i, /\bdrop\b/i, /\bcreate\b/i, /\btruncate\b/i, /\bgrant\b/i, /\block\b/i, /\bcommit\b/i]) assert.equal(p.test(c), false, String(p))
    }
  })
})

describe('ESTADO AUDITADO: las 12 policies exactas', () => {
  test('el esquema de prueba reproduce EXACTAMENTE el texto del listado real de pg_policies', async () => {
    const p = await mundo()
    const r = (await p.query(`select policyname::text, permissive::text, roles::text, cmd::text, qual::text, with_check::text from pg_policies where schemaname='storage' and tablename='objects' order by policyname`)).rows
    assert.deepEqual(r, [...AUDITADAS].sort((a, b) => (a.policyname < b.policyname ? -1 : 1)).map(a => ({ ...a })).sort((a, b) => (a.policyname < b.policyname ? -1 : 1)))
  })
  test('PRECHECK sobre el estado exacto → OK y NO modifica nada', async () => {
    const p = await mundo(); const antes = await estado(p)
    assert.equal(await correr(p, PRE), null)
    assert.deepEqual(await estado(p), antes)
  })
  for (const [nombre, sql, re] of DESVIOS_ANTES) {
    test(`PRECHECK aborta ante: ${nombre}`, async () => {
      const p = await mundo(`;${sql};`)
      const err = await correr(p, PRE); assert.ok(err, 'debía fallar'); assert.match(err!, re)
    })
  }
})

describe('APLICAR + POSTCHECK', () => {
  test('aplica solo los dos cambios: capturas privado, policy eliminada; las otras 11 idénticas, otros buckets y objetos intactos', async () => {
    const p = await mundo(); const antes = await estado(p)
    assert.equal(await correr(p, APLICAR), null)
    const d = await estado(p)
    assert.equal(d.b.public, false)
    assert.deepEqual({ ...d.b, public: undefined }, { ...antes.b, public: undefined })                 // nada más cambió en el bucket
    assert.equal(d.pol.length, 11); assert.equal(d.pol.some(x => x.policyname === 'Allow public read from capturas'), false)
    assert.deepEqual(d.pol, antes.pol.filter(x => x.policyname !== 'Allow public read from capturas'))  // las otras 11, idénticas
    assert.equal(d.pol.filter(x => x.policyname.startsWith('storage_admin_')).length, 3)                // storage_admin_* intactas
    assert.equal(d.pol.filter(x => x.policyname.startsWith('storage_empresa_')).length, 4)
    assert.deepEqual(d.otros, antes.otros); assert.deepEqual(d.obj, antes.obj); assert.equal(d.rls, true)
    assert.equal(await correr(p, POST), null)                                                           // postcheck OK
  })
  test('las huellas de la última fila son IGUALES en precheck, aplicar y postcheck', async () => {
    const p = await mundo(); const c = await p.connect()
    try {
      const huella = async (sql: string) => { const r = await c.query(sql); const f = (Array.isArray(r) ? r[r.length - 1] : r).rows[0]; return [f.huella_otros_buckets, f.huella_otras_11_policies, f.objetos_total].join('|') }
      const h1 = await huella(PRE), h2 = await huella(APLICAR), h3 = await huella(POST)
      assert.equal(h1, h2); assert.equal(h2, h3)
    } finally { c.release() }
  })
  test('el POSTCHECK aborta si se corre sobre el estado ANTERIOR (sin aplicar)', async () => {
    const p = await mundo(); const err = await correr(p, POST); assert.ok(err); assert.match(err!, /sigue PÚBLICO/)
  })
  // APLICAR vuelve a validar TODO dentro de su transacción: ante cualquier desvío del estado auditado aborta SIN modificar nada
  for (const [nombre, sql, re] of DESVIOS_ANTES) {
    test(`APLICAR aborta sin modificar nada ante: ${nombre}`, async () => {
      const p = await mundo(`;${sql};`); const antes = await estado(p)
      const err = await correr(p, APLICAR); assert.ok(err, 'debía abortar'); assert.match(err!, re)
      assert.deepEqual(await estado(p), antes)
    })
  }
  test('doble aplicación: la segunda ABORTA de forma explícita y no cambia nada', async () => {
    const p = await mundo(); assert.equal(await correr(p, APLICAR), null); const e1 = await estado(p)
    const err = await correr(p, APLICAR); assert.ok(err); assert.match(err!, /ESTADO ANTES: capturas ya NO es público/)
    assert.deepEqual(await estado(p), e1)
  })
  test('BLOQUEO: si otra sesión tiene tomada storage.objects, APLICAR aborta por lock_timeout (5 s) sin cambiar nada', async () => {
    const p = await mundo(); const antes = await estado(p)
    const b = await p.connect()
    try {
      await b.query(`begin; create policy en_curso on storage.objects for select to anon using (bucket_id = 'logos')`)   // otra sesión modificando policies (sin confirmar)
      const t0 = Date.now(); const err = await correr(p, APLICAR); const ms = Date.now() - t0
      assert.ok(err); assert.match(err!, /lock timeout/i); assert.ok(ms >= 4500 && ms < 9000, `tardó ${ms} ms`)
    } finally { await b.query('rollback').catch(() => {}); b.release() }
    assert.deepEqual(await estado(p), antes)
    assert.equal(await correr(p, APLICAR), null)                                                         // liberado el bloqueo, aplica normalmente
  })
  test('ATOMICIDAD: si cambia un atributo de OTRO bucket durante el script, la huella lo detecta y se revierte TODO', async () => {
    const p = await mundo(`;
      create function public.toca_otro_bucket() returns trigger language plpgsql as $$ begin update storage.buckets set file_size_limit = 1 where id = 'logos'; return new; end $$;
      create trigger t_toca_otro after update on storage.buckets for each row when (new.id = 'capturas') execute function public.toca_otro_bucket();`)
    const antes = await estado(p)
    const err = await correr(p, APLICAR); assert.ok(err); assert.match(err!, /HUELLA: cambió otro bucket/)
    assert.deepEqual(await estado(p), antes)                                                            // nada quedó aplicado
    assert.equal((await p.query(`select count(*)::int n from pg_policies where policyname = 'Allow public read from capturas'`)).rows[0].n, 1)
  })
  test('ATOMICIDAD: si el bucket capturas cambia de otra forma durante el script (límite), el estado final falla y se revierte todo', async () => {
    const p = await mundo(`;
      create function public.toca_limite() returns trigger language plpgsql as $$ begin new.file_size_limit := 1; return new; end $$;
      create trigger t_toca_limite before update on storage.buckets for each row when (new.id = 'capturas') execute function public.toca_limite();`)
    const antes = await estado(p)
    const err = await correr(p, APLICAR); assert.ok(err); assert.match(err!, /atributos auditados/)
    assert.deepEqual(await estado(p), antes)
  })
  test('ATOMICIDAD: si un objeto se borra durante el script, la huella lo detecta y se revierte TODO (el objeto sigue ahí)', async () => {
    const p = await mundo(`;
      create function public.borra_objeto() returns trigger language plpgsql as $$ begin delete from storage.objects where bucket_id = 'logos'; return new; end $$;
      create trigger t_borra after update on storage.buckets for each row when (new.id = 'capturas') execute function public.borra_objeto();`)
    const antes = await estado(p)
    const err = await correr(p, APLICAR); assert.ok(err); assert.match(err!, /HUELLA: cambió la cantidad de objetos/)
    assert.deepEqual(await estado(p), antes)
  })
  test('ATOMICIDAD: si se crea otra policy durante el script, el estado final falla y se revierte todo (la de capturas sigue existiendo)', async () => {
    const p = await mundo(`;
      create function public.crea_policy() returns trigger language plpgsql as $$ begin execute 'create policy colada on storage.objects for select to anon using (true)'; return new; end $$;
      create trigger t_colada after update on storage.buckets for each row when (new.id = 'capturas') execute function public.crea_policy();`)
    const antes = await estado(p)
    const err = await correr(p, APLICAR); assert.ok(err); assert.match(err!, /Sobrantes \(no auditadas\): \[colada\]/)
    assert.deepEqual(await estado(p), antes)
  })
})

// Estados posteriores a APLICAR que NO son los esperados: el POSTCHECK y la REVERSIÓN deben abortar
const DESVIOS_DESPUES: [string, string, RegExp][] = [
  ['policy pública de capturas recreada', `create policy "Allow public read from capturas" on storage.objects for select to public using (bucket_id = 'capturas')`, /Sobrantes \(no auditadas\): \[Allow public read from capturas\]/],
  ['policy adicional abierta', `create policy abierta on storage.objects for select to anon using (true)`, /Sobrantes \(no auditadas\): \[abierta\]/],
  ['policy adicional restrictiva', `create policy restr on storage.objects as restrictive for select to public using (bucket_id = 'logos')`, /Sobrantes \(no auditadas\): \[restr\]/],
  ['una de las 11 renombrada', `alter policy "Allow read logos" on storage.objects rename to "Allow read logos X"`, /Ausentes: \[Allow read logos\]\. Sobrantes \(no auditadas\): \[Allow read logos X\]/],
  ['una de las 11 con USING alterado', alt('storage_empresa_select', `(bucket_id = any (array['productos','logos','assets','capturas'])) and storage_admin_puede(bucket_id, name)`), /Con definición distinta: \[storage_empresa_select\]/],
  ['una de las 11 ausente', `drop policy public_read_productos on storage.objects`, /Ausentes: \[public_read_productos\]/],
  ['otro bucket pasó a privado', `update storage.buckets set public = false where id = 'productos'`, /buckets \[productos\] no existen o no son públicos/],
  ['capturas vuelve a público', `update storage.buckets set public = true where id = 'capturas'`, /sigue PÚBLICO|ESTADO DESPUÉS/],
  ['RLS desactivado', `alter table storage.objects disable row level security`, /NO tiene RLS activo/],
  ['capturas con atributos cambiados', `update storage.buckets set file_size_limit = 1 where id = 'capturas'`, /atributos auditados/],
]

describe('POSTCHECK y REVERSIÓN sobre estados posteriores distintos del esperado', () => {
  for (const [nombre, sql, re] of DESVIOS_DESPUES) {
    test(`POSTCHECK aborta ante: ${nombre}`, async () => {
      const p = await mundo(); assert.equal(await correr(p, APLICAR), null)
      await p.query(sql)
      const err = await correr(p, POST); assert.ok(err); assert.match(err!, re)
    })
    test(`REVERSIÓN aborta sin cambiar nada ante: ${nombre}`, async () => {
      const p = await mundo(); assert.equal(await correr(p, APLICAR), null)
      await p.query(sql); const antes = await estado(p)
      const err = await correr(p, REVERSION); assert.ok(err, 'debía abortar'); assert.match(err!, re)
      assert.deepEqual(await estado(p), antes)
    })
  }
})

describe('REVERSIÓN', () => {
  test('aplicar → reversión deja EXACTAMENTE el estado original (bucket, policy con su definición, otras policies, objetos, RLS)', async () => {
    const p = await mundo(); const antes = await estado(p)
    assert.equal(await correr(p, APLICAR), null)
    assert.equal(await correr(p, REVERSION), null)
    assert.deepEqual(await estado(p), antes)
    assert.equal(await correr(p, PRE), null)                                                            // y el precheck vuelve a dar OK
  })
  test('reversión sobre el estado original (nunca se aplicó) → ABORTA sin cambios', async () => {
    const p = await mundo(); const antes = await estado(p)
    const err = await correr(p, REVERSION); assert.ok(err); assert.match(err!, /sigue PÚBLICO/)
    assert.deepEqual(await estado(p), antes)
  })
  test('doble reversión: la segunda ABORTA sin cambios', async () => {
    const p = await mundo(); await correr(p, APLICAR); assert.equal(await correr(p, REVERSION), null); const e1 = await estado(p)
    assert.ok(await correr(p, REVERSION)); assert.deepEqual(await estado(p), e1)
  })
  test('ATOMICIDAD de la reversión: si durante el script cambia algo ajeno, no queda NADA revertido', async () => {
    const p = await mundo(); assert.equal(await correr(p, APLICAR), null)
    await p.query(`
      create function public.toca_otro_bucket() returns trigger language plpgsql as $$ begin update storage.buckets set file_size_limit = 1 where id = 'logos'; return new; end $$;
      create trigger t_toca_otro after update on storage.buckets for each row when (new.id = 'capturas') execute function public.toca_otro_bucket();`)
    const antes = await estado(p)
    const err = await correr(p, REVERSION); assert.ok(err); assert.match(err!, /HUELLA: cambió otro bucket/)
    assert.deepEqual(await estado(p), antes)                                                            // capturas sigue privado y sin su policy
    assert.equal(antes.b.public, false)
  })
  test('ciclo completo repetible: aplicar → revertir → aplicar → postcheck', async () => {
    const p = await mundo(); assert.equal(await correr(p, APLICAR), null); assert.equal(await correr(p, REVERSION), null)
    assert.equal(await correr(p, APLICAR), null); assert.equal(await correr(p, POST), null)
  })
  test('la policy restaurada permite leer a anon (comportamiento original) y la aplicada no', async () => {
    const p = await mundo()
    const leerComoAnon = async () => { const c = await p.connect(); try { await c.query('grant usage on schema storage to anon; grant select on storage.objects to anon'); await c.query('begin'); await c.query('set local role anon'); const r = await c.query(`select count(*)::int n from storage.objects where bucket_id = 'capturas'`); await c.query('rollback'); return r.rows[0].n } finally { c.release() } }
    assert.equal(await leerComoAnon(), 4)                                                              // antes: anon ve los 4 objetos (RLS permite)
    await correr(p, APLICAR); assert.equal(await leerComoAnon(), 0)                                    // después: ninguno
    await correr(p, REVERSION); assert.equal(await leerComoAnon(), 4)                                  // revertido: vuelve a ver
  })
})
