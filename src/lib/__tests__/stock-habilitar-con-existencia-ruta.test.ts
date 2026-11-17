// INVENTARIO: habilitar control de stock + existencia inicial EN UN ACTO (CTO 17/11), por las RUTAS REALES /api/stock y /api/kiosk/catalogo
// contra POSTGRES LOCAL REAL (tablas productos / sucursales / producto_stock / stock_movimientos reales y la función REAL ajustar_stock de la base viva).
// Entre las rutas y Postgres hay un shim HTTP mínimo que imita PostgREST + Auth (NO es PostgREST ni Supabase real: sin RLS ni auth verdadera).
// usuarios_admin / roles / categorías / presentaciones / config son FIXTURES (mocks). Se prueba en una base descartable local: NO se toca ninguna base real ni /federal.
// Ejecutar: npx tsx --test src/lib/__tests__/stock-habilitar-con-existencia-ruta.test.ts  (necesita `npm i pg --no-save` y el cluster de supabase/tests/stock-v2/README.md)
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const SUP = join(process.cwd(), 'supabase')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const DB = 'inv_alta'
let admin: pg.Client, db: pg.Pool, server: http.Server
let romperAjustar = false, romperHabilitar = false
const rpcs: string[] = []
type J = Record<string, unknown>
const w = { emp: '', A: '', B: '', otraEmp: '', otraSuc: '' }
const TOK = { empresa: 'tok-admin-empresa', suc: 'tok-admin-sucursal-A' }
const REALES = new Set(['productos', 'producto_stock', 'sucursales', 'stock_movimientos'])
const FIXTURES: Record<string, J[]> = {}

function filtros(url: URL) {
  const conds: string[] = [], vals: unknown[] = []
  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
    if (v.startsWith('eq.')) { vals.push(v.slice(3)); conds.push(`"${k}"::text = $${vals.length}`) }
    else if (v === 'is.null') conds.push(`"${k}" is null`)
    else if (v.startsWith('in.(')) { const xs = v.slice(4, -1).split(','); const ph = xs.map(x => { vals.push(x); return `$${vals.length}` }); conds.push(`"${k}"::text in (${ph.join(',')})`) }
  }
  return { where: conds.length ? ' where ' + conds.join(' and ') : '', vals }
}
const matchFix = (row: J, url: URL) => { for (const [k, v] of url.searchParams.entries()) { if (['select', 'order', 'limit', 'offset'].includes(k)) continue; if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false; if (v === 'is.null' && row[k] != null) return false; if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(row[k]))) return false } return true }
function arrancarShim(): Promise<number> {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', async () => {
      const url = new URL(req.url!, 'http://x'); const body = raw ? JSON.parse(raw) : undefined
      const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      const out = (st: number, d: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)) }
      try {
        if (url.pathname === '/auth/v1/user') {
          const tok = String(req.headers.authorization ?? '').replace('Bearer ', '')
          const id = tok === TOK.empresa ? 'u-emp' : tok === TOK.suc ? 'u-suc' : null
          return id ? out(200, { id, aud: 'authenticated', role: 'authenticated', email: 'x@x' }) : out(401, { message: 'invalid' })
        }
        const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
        if (rpc) {
          rpcs.push(rpc[1])
          if (romperAjustar && rpc[1] === 'ajustar_stock') return out(500, { message: 'db unavailable' })
          const ks = Object.keys(body ?? {}); const vals = ks.map(k => body[k])
          try { const r = await db.query(`select ${rpc[1]}(${ks.map((k, i) => `${k} := $${i + 1}`).join(', ')}) as r`, vals); return out(200, r.rows[0].r ?? null) } catch (e) { const er = e as pg.DatabaseError; return out(400, { message: er.message, code: er.code }) }
        }
        const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]; if (!t) return out(404, {})
        if (req.method === 'GET') {
          let filas: J[]
          if (REALES.has(t)) { const f = filtros(url); filas = (await db.query(`select * from ${t}${f.where}`, f.vals)).rows } else filas = (FIXTURES[t] ?? []).filter(x => matchFix(x, url))
          if (obj) return filas[0] ? out(200, filas[0]) : out(406, { code: 'PGRST116', message: 'no rows' })
          return out(200, filas)
        }
        if (req.method === 'PATCH' && t === 'productos') {
          if (romperHabilitar) return out(500, { message: 'db unavailable' })
          const f = filtros(url); const ks = Object.keys(body); await db.query(`update productos set ${ks.map((k, i) => `"${k}" = $${f.vals.length + i + 1}`).join(', ')}${f.where}`, [...f.vals, ...ks.map(k => body[k])]); return out(200, [])
        }
        out(200, [])
      } catch (e) { console.error('shim', e); out(500, { message: String(e) }) }
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
}

let STOCK: (r: Request) => Promise<Response>, CAT: (r: Request) => Promise<Response>
before(async () => {
  admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect()
  await admin.query(`drop database if exists ${DB} with (force)`); await admin.query(`create database ${DB}`)
  db = new pg.Pool({ ...SOCK, database: DB, max: 10 }); db.on('error', () => {})
  await db.query(readFileSync(join(SUP, 'tests/stock-v2/00-schema-reducido.sql'), 'utf8'))
  await db.query(`alter table productos add column activo boolean not null default true, add column deleted_at timestamptz, add column modelo_stock text, add column categoria_id text, add column orden int, add column visible_kiosk boolean not null default true, add column visible_delivery boolean not null default true, add column descripcion text, add column imagen_url text;
                  alter table sucursales add column nombre text`)
  const port = await arrancarShim()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  STOCK = (await import('../../app/api/stock/route')).POST as typeof STOCK
  CAT = (await import('../../app/api/kiosk/catalogo/route')).GET as typeof CAT
})
after(async () => { server?.close(); await db?.end(); await admin?.query(`drop database if exists ${DB} with (force)`); await admin?.end() })

let P = ''   // producto bajo prueba
async function mundo() {
  const one = async (sql: string, ...a: unknown[]) => (await db.query(sql, a)).rows[0].id as string
  w.emp = await one('insert into empresas default values returning id'); w.otraEmp = await one('insert into empresas default values returning id')
  w.A = await one("insert into sucursales(empresa_id, nombre) values($1,'Centro') returning id", w.emp); w.B = await one("insert into sucursales(empresa_id, nombre) values($1,'Norte') returning id", w.emp)
  w.otraSuc = await one("insert into sucursales(empresa_id, nombre) values($1,'Ajena') returning id", w.otraEmp)
  P = await one("insert into productos(empresa_id, nombre, controla_stock, categoria_id) values($1,'Alfajor',false,'c1') returning id", w.emp)
  FIXTURES.usuarios_admin = [{ id: 'u-emp', nombre: 'Luci', empresa_id: w.emp, activo: true }, { id: 'u-suc', nombre: 'Encargado', empresa_id: w.emp, activo: true }]
  FIXTURES.usuario_admin_roles = [{ usuario_id: 'u-suc', empresa_id: w.emp, sucursal_id: w.A, rol: 'ADMIN_SUCURSAL' }]   // u-emp: sin fila = toda la empresa (como hoy)
  FIXTURES.categorias = [{ id: 'c1', empresa_id: w.emp, nombre: 'Dulces', orden: 1, activo: true, deleted_at: null, icono_url: null }]
  FIXTURES.presentaciones = [{ id: 'f0000000-0000-4000-8000-000000000001', empresa_id: w.emp, producto_id: P, nombre: 'Unidad', precio: 1000, activo: true, visible_kiosk: true, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1 }]; FIXTURES.empresa_config = [{ empresa_id: w.emp, mostrar_agotados: false }]
}
const call = (b: J, tok: string | null = TOK.empresa) => STOCK(new Request('http://x/api/stock', { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) }))
type R = { ok?: boolean; error?: string; codigo?: string; cantidad?: number; ya_aplicado?: boolean; controla?: boolean; existencias?: number; otras_sin_alta?: { id: string; nombre: string }[]; items?: { producto_id: string; controla: boolean; cantidad: number | null; estado: string }[] }
const j = async (r: Response) => (await r.json()) as R
const alta = (cantidad: unknown, extra: J = {}, suc = w.A, tok: string | null = TOK.empresa) => call({ accion: 'habilitar_con_stock', sucursal_id: suc, producto_id: P, cantidad, ...extra }, tok)
const flag = async () => (await db.query('select controla_stock from productos where id=$1', [P])).rows[0].controla_stock as boolean
const fila = async (suc: string) => (await db.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [P, suc])).rows[0]?.cantidad as number | undefined
const movs = async (suc?: string) => Number((await db.query(`select count(*) from stock_movimientos where producto_id=$1 ${suc ? 'and sucursal_id=$2' : ''}`, suc ? [P, suc] : [P])).rows[0].count)
const catalogo = async (suc: string) => { const r = await CAT(new Request(`http://x/api/kiosk/catalogo?empresa_id=${w.emp}&sucursal_id=${suc}`)); const d = await r.json() as { productos?: { id: string; agotado?: boolean }[] }; return d.productos?.find(p => p.id === P) }

describe('Inventario: habilitar + existencia inicial en un acto (CTO 17/11)', () => {
  beforeEach(async () => { romperAjustar = false; romperHabilitar = false; rpcs.length = 0; await mundo() })

  test('H1) producto nuevo sin control: figura «sin control», sin filas de stock ni movimientos', async () => {
    const inv = await j(await call({ accion: 'inventario', sucursal_id: w.A, todos: true })); const it = inv.items!.find(x => x.producto_id === P)!
    assert.equal(it.controla, false); assert.equal(it.estado, 'sin_control'); assert.equal(await fila(w.A), undefined); assert.equal(await movs(), 0)
  })

  test('H2) existencia inicial POSITIVA: queda con control + fila en la sucursal elegida + UN movimiento de alta; se ve en el inventario', async () => {
    const r = await j(await alta(12)); assert.equal(r.ok, true); assert.equal(r.cantidad, 12); assert.equal(r.ya_aplicado, false)
    assert.equal(await flag(), true); assert.equal(await fila(w.A), 12); assert.equal(await movs(w.A), 1)
    const m = (await db.query("select delta, motivo, detalle from stock_movimientos where producto_id=$1", [P])).rows[0]; assert.equal(Number(m.delta), 12); assert.equal(m.motivo, 'ajuste'); assert.match(m.detalle, /Alta inicial/)
    const inv = await j(await call({ accion: 'inventario', sucursal_id: w.A })); const it = inv.items!.find(x => x.producto_id === P)!
    assert.equal(it.controla, true); assert.equal(it.cantidad, 12); assert.notEqual(it.estado, 'sin_alta')
  })

  test('H3) existencia inicial CERO (válido): control + fila en 0, sin movimiento (no hay nada que mover); queda agotado A PROPÓSITO', async () => {
    const r = await j(await alta(0)); assert.equal(r.ok, true)
    assert.equal(await flag(), true); assert.equal(await fila(w.A), 0); assert.equal(await movs(), 0)
    assert.equal(await catalogo(w.A), undefined, 'con 0 y mostrar_agotados apagado queda oculto: decisión explícita del usuario')
  })

  test('H4) SUCURSAL A habilitada: la sucursal B no recibe fila ni movimientos (no se la modifica); se avisa que quedará sin alta', async () => {
    const r = await j(await alta(12)); assert.equal(await fila(w.B), undefined); assert.equal(await movs(w.B), 0)
    assert.deepEqual(r.otras_sin_alta, [{ id: w.B, nombre: 'Norte' }])
    assert.equal((await db.query('select count(*) from producto_stock where sucursal_id=$1', [w.otraSuc])).rows[0].count, '0')
  })

  test('H5) REINTENTO de la misma operación: no duplica movimiento ni cambia la cantidad (ya_aplicado)', async () => {
    await alta(12); const r2 = await j(await alta(12)); assert.equal(r2.ok, true); assert.equal(r2.ya_aplicado, true)
    assert.equal(await fila(w.A), 12); assert.equal(await movs(), 1)
  })

  test('H6) FALLO al cargar la existencia: NO queda habilitado ni con fila ni movimientos; el reintento funciona', async () => {
    romperAjustar = true; const res = await alta(12); assert.equal(res.status, 500)
    assert.equal(await flag(), false); assert.equal(await fila(w.A), undefined); assert.equal(await movs(), 0)
    romperAjustar = false; assert.equal((await j(await alta(12))).ok, true); assert.equal(await flag(), true); assert.equal(await fila(w.A), 12)
  })

  test('H7) FALLO al habilitar (después de cargar): nunca «habilitado sin existencia»; el producto sigue sin control y vendible; reintentar completa SIN duplicar', async () => {
    romperHabilitar = true; const res = await alta(12); assert.equal(res.status, 500); assert.equal((await j(res)).codigo, 'HABILITAR_PENDIENTE')
    assert.equal(await flag(), false); assert.equal(await fila(w.A), 12); assert.equal(await movs(), 1)
    const c = await catalogo(w.A); assert.ok(c, 'sigue visible en el catálogo (sin control)'); assert.notEqual(c!.agotado, true)
    romperHabilitar = false; const r2 = await j(await alta(12)); assert.equal(r2.ok, true)
    assert.equal(await flag(), true); assert.equal(await fila(w.A), 12); assert.equal(await movs(), 1)
  })

  test('H8) CATÁLOGO: tras habilitar con existencia, el producto está VISIBLE y no agotado en A (el caso con cero está en H3)', async () => {
    assert.ok(await catalogo(w.A), 'antes: visible (sin control)')
    await alta(12); const c = await catalogo(w.A); assert.ok(c); assert.notEqual(c!.agotado, true)
    const q = await db.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [P, w.A]); assert.equal(q.rows[0].cantidad, 12)
  })

  test('H9) LÍMITE DOCUMENTADO: con el control encendido, la sucursal B (sin fila) queda AGOTADA en el catálogo hasta que se le cargue', async () => {
    await alta(12); assert.equal(await catalogo(w.B), undefined, 'B ya no lo muestra (agotado); es el efecto del flag por producto')
    await alta(5, {}, w.B); const cb = await catalogo(w.B); assert.ok(cb, 'al cargarle B vuelve a verse'); assert.equal(await fila(w.A), 12, 'A intacta')
  })

  test('H10) producto que ya controlaba sin fila en esta sucursal (caso «habilité y no cargué»): solo carga la existencia, no vuelve a tocar el control', async () => {
    await db.query('update productos set controla_stock=true where id=$1', [P]); assert.equal(await catalogo(w.A), undefined, 'estaba oculto/agotado')
    const r = await j(await alta(8)); assert.equal(r.ok, true); assert.equal(await fila(w.A), 8); assert.ok(await catalogo(w.A))
  })

  test('H11) ya tiene stock distinto → 409 YA_TIENE_STOCK (usar Ajuste general); con control apagado y fila previa → pide confirmar el reemplazo', async () => {
    await alta(12); const r = await alta(3); assert.equal(r.status, 409); assert.equal((await j(r)).codigo, 'YA_TIENE_STOCK'); assert.equal(await fila(w.A), 12)
    await db.query('update productos set controla_stock=false where id=$1', [P])
    const c = await alta(3); assert.equal(c.status, 409); assert.equal((await j(c)).codigo, 'CONFIRMAR_REEMPLAZO'); assert.equal(await fila(w.A), 12)
    assert.equal((await j(await alta(3, { confirmar: true }))).ok, true); assert.equal(await fila(w.A), 3)
  })

  test('H12) validaciones y permisos: cantidad inválida → 400; ADMIN_SUCURSAL → 403; producto ajeno → 404; inactivo → 409; rama → 409; sin sesión → 401; nada se escribe', async () => {
    for (const c of [-1, 1.5, '3', null, 1_000_001]) assert.equal((await alta(c)).status, 400)
    assert.equal((await alta(5, {}, w.A, TOK.suc)).status, 403)
    assert.equal((await alta(5, {}, w.A, null)).status, 401)
    assert.equal((await call({ accion: 'habilitar_con_stock', sucursal_id: w.A, producto_id: '00000000-0000-4000-8000-000000000001', cantidad: 1 })).status, 404)
    await db.query('update productos set activo=false where id=$1', [P]); const ina = await alta(5); assert.equal(ina.status, 409); assert.equal((await j(ina)).codigo, 'PRODUCTO_INACTIVO')
    await db.query("update productos set activo=true, modelo_stock='rama' where id=$1", [P]); const ra = await alta(5); assert.equal(ra.status, 409); assert.equal((await j(ra)).codigo, 'PRODUCTO_MODELO_RAMA')
    assert.equal(await flag(), false); assert.equal(await fila(w.A), undefined); assert.equal(await movs(), 0); assert.equal(rpcs.filter(x => x === 'ajustar_stock').length, 0)
  })

  test('H13) sucursal de OTRA empresa → 403 y no escribe', async () => {
    assert.equal((await alta(5, {}, w.otraSuc)).status, 403); assert.equal(await flag(), false); assert.equal(await movs(), 0)
  })
})
