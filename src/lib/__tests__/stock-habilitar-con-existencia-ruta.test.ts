// INVENTARIO: habilitar control de stock + existencia inicial EN UN ACTO, **POR SUCURSAL** (CTO 17/11 → GO control por sucursal), por las RUTAS REALES /api/stock y /api/kiosk/catalogo
// contra POSTGRES LOCAL REAL: el script de migración real (supabase/stock-control-por-sucursal.sql) deja las funciones reales v1.9 (ajustar_stock, crear_pedido_stock…).
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
let romperAjustar = false, romperHabilitar = false, romperAgregado = false
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
        if (req.method === 'PATCH' && (t === 'productos' || t === 'producto_stock')) {
          if (t === 'producto_stock' && romperHabilitar) return out(500, { message: 'db unavailable' })   // falla al marcar el control de la fila
          if (t === 'productos' && romperAgregado) return out(500, { message: 'db unavailable' })         // falla al recalcular el agregado del producto
          const f = filtros(url); const ks = Object.keys(body); await db.query(`update ${t} set ${ks.map((k, i) => `"${k}" = $${f.vals.length + i + 1}`).join(', ')}${f.where}`, [...f.vals, ...ks.map(k => body[k])]); return out(200, [])
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
  await db.query(readFileSync(join(SUP, 'tests/stock-por-sucursal/00-extras.sql'), 'utf8'))
  await db.query(readFileSync(join(SUP, 'stock-control-por-sucursal.sql'), 'utf8'))   // la migración REAL: columna + funciones v1.9 (base vacía → 0 filas de compatibilidad)
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
const ctl = async (suc: string) => (await db.query('select controla from producto_stock where producto_id=$1 and sucursal_id=$2', [P, suc])).rows[0]?.controla as boolean | undefined
const flag = async () => (await db.query('select controla_stock from productos where id=$1', [P])).rows[0].controla_stock as boolean
const fila = async (suc: string) => (await db.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [P, suc])).rows[0]?.cantidad as number | undefined
const movs = async (suc?: string) => Number((await db.query(`select count(*) from stock_movimientos where producto_id=$1 ${suc ? 'and sucursal_id=$2' : ''}`, suc ? [P, suc] : [P])).rows[0].count)
const catalogo = async (suc: string) => { const r = await CAT(new Request(`http://x/api/kiosk/catalogo?empresa_id=${w.emp}&sucursal_id=${suc}`)); const d = await r.json() as { productos?: { id: string; agotado?: boolean }[] }; return d.productos?.find(p => p.id === P) }

describe('Inventario: habilitar + existencia inicial en un acto (CTO 17/11)', () => {
  beforeEach(async () => { romperAjustar = false; romperHabilitar = false; romperAgregado = false; rpcs.length = 0; await mundo() })

  test('H1) producto nuevo sin control: figura «sin control», sin filas de stock ni movimientos', async () => {
    const inv = await j(await call({ accion: 'inventario', sucursal_id: w.A, todos: true })); const it = inv.items!.find(x => x.producto_id === P)!
    assert.equal(it.controla, false); assert.equal(it.estado, 'sin_control'); assert.equal(await fila(w.A), undefined); assert.equal(await movs(), 0)
  })

  test('H2) existencia inicial POSITIVA: control SOLO en la sucursal elegida + fila + UN movimiento de alta; el agregado del producto queda activo; se ve en el inventario', async () => {
    const r = await j(await alta(12)); assert.equal(r.ok, true); assert.equal(r.cantidad, 12); assert.equal(r.ya_aplicado, false)
    assert.equal(await ctl(w.A), true); assert.equal(await flag(), true, 'agregado: controla en al menos una sucursal'); assert.equal(await fila(w.A), 12); assert.equal(await movs(w.A), 1)
    const m = (await db.query("select delta, motivo, detalle from stock_movimientos where producto_id=$1", [P])).rows[0]; assert.equal(Number(m.delta), 12); assert.equal(m.motivo, 'ajuste'); assert.match(m.detalle, /Alta inicial/)
    const inv = await j(await call({ accion: 'inventario', sucursal_id: w.A })); const it = inv.items!.find(x => x.producto_id === P)!
    assert.equal(it.controla, true); assert.equal(it.cantidad, 12); assert.equal(it.estado, 'ok')
  })

  test('H3) existencia inicial CERO (válido): el control QUEDA ACTIVO con 0 → la sucursal queda sin disponibilidad (agotado), sin movimiento', async () => {
    const r = await j(await alta(0)); assert.equal(r.ok, true)
    assert.equal(await ctl(w.A), true); assert.equal(await flag(), true); assert.equal(await fila(w.A), 0); assert.equal(await movs(), 0)
    assert.equal(await catalogo(w.A), undefined, 'con 0 y mostrar_agotados apagado queda oculto en ESA sucursal: decisión explícita del usuario')
    const pres = (await db.query("insert into presentaciones(empresa_id, producto_id, nombre, precio) values($1,$2,'Unidad',1000) returning id", [w.emp, P])).rows[0].id as string
    const v = await db.query(`select crear_pedido_stock($1,$2,null,$3::jsonb,'efectivo','CAJA','mostrador',0,null,'pendiente','X')`, [w.emp, w.A, JSON.stringify([{ presentacion_id: pres, cantidad: 1, precio_snap: 1000 }])]).then(() => 'vendió', e => String(e.message))
    assert.match(v, /SIN_STOCK/, 'control + 0 → no puede vender (regla real de la base)')
  })

  test('H4) SUCURSAL A habilitada: la sucursal B NO se modifica (sin fila, sin movimientos) y SIGUE VENDIENDO; no se la bloquea ni se avisa de «agotadas»', async () => {
    const r = await j(await alta(12)); assert.equal(await fila(w.B), undefined); assert.equal(await ctl(w.B), undefined); assert.equal(await movs(w.B), 0)
    assert.equal(r.otras_sin_alta, undefined, 'ya no existe el concepto de «otras sucursales agotadas»')
    assert.equal((await db.query('select count(*) from producto_stock where sucursal_id=$1', [w.otraSuc])).rows[0].count, '0')
    const cb = await catalogo(w.B); assert.ok(cb, 'B lo sigue mostrando'); assert.notEqual(cb!.agotado, true)
  })

  test('H5) REINTENTO de la misma operación: no duplica movimiento ni cambia la cantidad (ya_aplicado)', async () => {
    await alta(12); const r2 = await j(await alta(12)); assert.equal(r2.ok, true); assert.equal(r2.ya_aplicado, true)
    assert.equal(await fila(w.A), 12); assert.equal(await movs(), 1)
  })

  test('H6) FALLO al cargar la existencia: NO queda habilitado ni con fila ni movimientos; el reintento funciona', async () => {
    romperAjustar = true; const res = await alta(12); assert.equal(res.status, 500)
    assert.equal(await flag(), false); assert.equal(await fila(w.A), undefined); assert.equal(await ctl(w.A), undefined); assert.equal(await movs(), 0)
    romperAjustar = false; assert.equal((await j(await alta(12))).ok, true); assert.equal(await flag(), true); assert.equal(await ctl(w.A), true); assert.equal(await fila(w.A), 12)
  })

  test('H7) FALLO al marcar el control (después de cargar): la fila queda SIN control (inerte: la sucursal vende libre); nunca «habilitado sin existencia»; reintentar completa SIN duplicar', async () => {
    romperHabilitar = true; const res = await alta(12); assert.equal(res.status, 500); assert.equal((await j(res)).codigo, 'HABILITAR_PENDIENTE')
    assert.equal(await ctl(w.A), false); assert.equal(await flag(), false); assert.equal(await fila(w.A), 12); assert.equal(await movs(), 1)
    const c = await catalogo(w.A); assert.ok(c, 'sigue visible en el catálogo (sin control)'); assert.notEqual(c!.agotado, true)
    romperHabilitar = false; const r2 = await j(await alta(12)); assert.equal(r2.ok, true)
    assert.equal(await ctl(w.A), true); assert.equal(await flag(), true); assert.equal(await fila(w.A), 12); assert.equal(await movs(), 1)
  })

  test('H7b) FALLO al recalcular el agregado del producto: el control de la sucursal YA rige (la venta lo respeta); reintentar corrige el agregado sin duplicar movimientos', async () => {
    romperAgregado = true; const res = await alta(12); assert.equal(res.status, 500); assert.equal((await j(res)).codigo, 'HABILITAR_PENDIENTE')
    assert.equal(await ctl(w.A), true); assert.equal(await flag(), false, 'agregado pendiente'); assert.equal(await fila(w.A), 12); assert.equal(await movs(), 1)
    romperAgregado = false; const r2 = await j(await alta(12)); assert.equal(r2.ok, true); assert.equal(r2.ya_aplicado, true)
    assert.equal(await flag(), true); assert.equal(await movs(), 1)
  })

  test('H8) CATÁLOGO: tras habilitar con existencia, el producto está VISIBLE y no agotado en A (el caso con cero está en H3)', async () => {
    assert.ok(await catalogo(w.A), 'antes: visible (sin control)')
    await alta(12); const c = await catalogo(w.A); assert.ok(c); assert.notEqual(c!.agotado, true)
    const q = await db.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [P, w.A]); assert.equal(q.rows[0].cantidad, 12)
  })

  test('H9) EL CASO COPA SPORT: A controla con 0 (agotada) y B sin control SIGUE vendiendo; si B se habilita con 5, cada una con lo suyo', async () => {
    await alta(0); assert.equal(await catalogo(w.A), undefined, 'A agotada')
    const cb = await catalogo(w.B); assert.ok(cb, 'B (sin control) sigue visible'); assert.notEqual(cb!.agotado, true)
    await alta(5, {}, w.B); assert.equal(await fila(w.A), 0, 'A intacta'); assert.equal(await fila(w.B), 5); assert.ok(await catalogo(w.B)); assert.equal(await catalogo(w.A), undefined)
  })

  test('H10) producto YA controlado en B: habilitarlo en A solo carga A; B (control y existencia) no se toca', async () => {
    await alta(8, {}, w.B); const antesB = await fila(w.B)
    const r = await j(await alta(3)); assert.equal(r.ok, true); assert.equal(await fila(w.A), 3); assert.equal(await ctl(w.A), true)
    assert.equal(await fila(w.B), antesB); assert.equal(await ctl(w.B), true); assert.equal(await movs(w.B), 1)
  })

  test('H11) ya tiene stock distinto → 409 YA_TIENE_STOCK (usar Ajuste general); fila SIN control con existencia previa (p. ej. de una compra) → pide confirmar el reemplazo', async () => {
    await alta(12); const r = await alta(3); assert.equal(r.status, 409); assert.equal((await j(r)).codigo, 'YA_TIENE_STOCK'); assert.equal(await fila(w.A), 12)
    await db.query('update producto_stock set controla=false where producto_id=$1 and sucursal_id=$2', [P, w.A])
    const c = await alta(3); assert.equal(c.status, 409); assert.equal((await j(c)).codigo, 'CONFIRMAR_REEMPLAZO'); assert.equal(await fila(w.A), 12); assert.equal(await ctl(w.A), false)
    assert.equal((await j(await alta(3, { confirmar: true }))).ok, true); assert.equal(await fila(w.A), 3); assert.equal(await ctl(w.A), true)
  })

  test('H12) validaciones y permisos: cantidad inválida → 400; ADMIN_SUCURSAL → 403; producto ajeno → 404; inactivo → 409; rama → 409; sin sesión → 401; nada se escribe', async () => {
    for (const c of [-1, 1.5, '3', null, 1_000_001]) assert.equal((await alta(c)).status, 400)
    assert.equal((await alta(5, {}, w.A, TOK.suc)).status, 403)
    assert.equal((await alta(5, {}, w.A, null)).status, 401)
    assert.equal((await call({ accion: 'habilitar_con_stock', sucursal_id: w.A, producto_id: '00000000-0000-4000-8000-000000000001', cantidad: 1 })).status, 404)
    await db.query('update productos set activo=false where id=$1', [P]); const ina = await alta(5); assert.equal(ina.status, 409); assert.equal((await j(ina)).codigo, 'PRODUCTO_INACTIVO')
    await db.query("update productos set activo=true, modelo_stock='rama', controla_stock=true where id=$1", [P]); const ra = await alta(5); assert.equal(ra.status, 409); assert.equal((await j(ra)).codigo, 'PRODUCTO_MODELO_RAMA')
    await db.query("update productos set modelo_stock='producto', controla_stock=false where id=$1", [P])
    assert.equal(await flag(), false); assert.equal(await fila(w.A), undefined); assert.equal(await movs(), 0); assert.equal(rpcs.filter(x => x === 'ajustar_stock').length, 0)
  })

  test('H13) sucursal de OTRA empresa → 403 y no escribe', async () => {
    assert.equal((await alta(5, {}, w.otraSuc)).status, 403); assert.equal(await flag(), false); assert.equal(await movs(), 0)
  })

  test('H14) YA NO se exige confirmación global (el control es de la sucursal): habilita sin confirma_global; con o sin ese campo el resultado es el mismo', async () => {
    for (const c of [undefined, false, 'true', 1]) { const r = await j(await alta(12, { confirma_global: c }, c === undefined ? w.A : (c === false ? w.B : w.A))); assert.equal(r.ok === true || r.error !== undefined, true) }
    assert.equal(await ctl(w.A), true); assert.equal(await ctl(w.B), true)
  })

  test('H15) QUITAR el control es por sucursal: con existencias pide confirmación; confirmado apaga SOLO esa sucursal; el agregado baja solo cuando ya no controla ninguna', async () => {
    await alta(12); await alta(5, {}, w.B)
    const dq = (suc: string, extra: J = {}) => call({ accion: 'deshabilitar', sucursal_id: suc, producto_id: P, ...extra })
    const r = await dq(w.A); assert.equal(r.status, 409); assert.equal((await j(r)).codigo, 'CONFIRMAR_QUITAR'); assert.equal(await ctl(w.A), true)
    assert.equal((await dq(w.A, { confirmar: true })).status, 200); assert.equal(await ctl(w.A), false); assert.equal(await ctl(w.B), true); assert.equal(await flag(), true, 'B aún controla')
    assert.equal((await dq(w.B, { confirmar: true })).status, 200); assert.equal(await flag(), false, 'ya no controla ninguna sucursal')
    const ca = await catalogo(w.A); assert.ok(ca); assert.notEqual(ca!.agotado, true, 'sin control → vende libre')
  })

  test('H16) `habilitar` (sin existencia) también es por sucursal: deja control con 0 en ESA sucursal; `habilitar_lote` ya no existe en el servidor', async () => {
    const r = await call({ accion: 'habilitar', sucursal_id: w.A, producto_id: P }); assert.equal(r.status, 200)
    assert.equal(await ctl(w.A), true); assert.equal(await fila(w.A), 0); assert.equal(await ctl(w.B), undefined); assert.equal(await flag(), true)
    assert.equal((await call({ accion: 'habilitar_lote', sucursal_id: w.A, producto_ids: [P] })).status, 400)
  })

  test('H17) CATÁLOGO con mostrar_agotados: la sucursal con control y 0 figura agotada (visible) y la libre no', async () => {
    FIXTURES.empresa_config = [{ empresa_id: w.emp, mostrar_agotados: true }]
    await alta(0)
    const ca = await catalogo(w.A); assert.ok(ca); assert.equal(ca!.agotado, true)
    const cb = await catalogo(w.B); assert.ok(cb); assert.notEqual(cb!.agotado, true)
  })
})

// «Habilitar a todos» (lote) retirado de la INTERFAZ (CTO 17/11) y la advertencia/confirmación GLOBAL retirada (CTO 17/11, control por sucursal).
// Control a nivel de código fuente de la pantalla (NO es una prueba de navegador).
describe('Pantalla de stock: control por sucursal, sin advertencia global', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/[empresa]/admin/stock/page.tsx'), 'utf8')
  test('U1) la pantalla no ofrece ni llama a habilitar_lote', () => { assert.ok(!src.includes('habilitar_lote')); assert.ok(!/Habilitar control a/.test(src)); assert.ok(!src.includes('habilitarLote')) })
  test('U2) ya no hay advertencia ni confirmación global; el texto dice que se habilita SOLO en la sucursal seleccionada', () => {
    assert.ok(!/todas las sucursales/i.test(src)); assert.ok(!src.includes('confirma_global')); assert.ok(!src.includes('confirmaGlobal')); assert.ok(!/habilitación global/i.test(src)); assert.ok(!src.includes('otras_sin_alta'))
    assert.match(src, /solo en \{/); assert.match(src, /Las demás sucursales no se modifican/); assert.match(src, /control de stock es por sucursal/)
  })
})
