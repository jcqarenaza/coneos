// RUTAS REALES /api/pedidos y /api/pedidos/eliminar contra POSTGRES LOCAL REAL (funciones SQL reales: crear_pedido_stock v1.7 (operacion_id),
// reclamar_operacion_pedido, devolver_stock_pedido). Entre la ruta y Postgres hay un shim HTTP mínimo que imita PostgREST
// (NO es PostgREST ni Supabase real: sin RLS, sin auth). Requiere el cluster aislado de supabase/tests/stock-v2/README.md.
// Ejecutar: npx tsx --test src/lib/__tests__/pedidos-repetidos-ruta.test.ts   (necesita `npm i pg --no-save`)
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const SUP = join(process.cwd(), 'supabase')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const DB = 'rep_ruta'
let admin: pg.Client, db: pg.Pool, server: http.Server
let romperReclamar = false
let romperCrear: 'perdida' | null = null          // la RPC de creación COMMITEA pero la respuesta se pierde (502 sin código)
let romperCompletar = false                       // completar_operacion_pedido falla (500) sin ejecutarse
let crearRechazo = false                          // la RPC de creación responde un error con SQLSTATE FUERA de la lista de rollback demostrado (sin ejecutarse)
const llamadas: Record<string, number> = {}       // RPC invocadas por el endpoint (para probar qué NO se llama)
const w = { emp: '', suc: '', suc2: '', prod: '', pres: '' }
type J = Record<string, unknown>

// ── shim PostgREST mínimo sobre el Postgres real ──
const REALES = new Set(['pedidos', 'pedido_items', 'pedido_item_opciones'])
const FIXTURES: Record<string, J[]> = { sucursales: [{ activo: true, horario_general: null, mensaje_cerrado: null, tolerancia_cierre: 0, dias_apertura: null, horario_por_dia: null }] }
function filtros(url: URL) {
  const conds: string[] = [], vals: unknown[] = []
  for (const [k, v] of url.searchParams.entries()) {
    if (v.startsWith('eq.')) { vals.push(v.slice(3)); conds.push(`"${k}"::text = $${vals.length}`) }
    else if (v.startsWith('in.(')) { const xs = v.slice(4, -1).split(','); const ph = xs.map(x => { vals.push(x); return `$${vals.length}` }); conds.push(`"${k}"::text in (${ph.join(',')})`) }
  }
  return { where: conds.length ? ' where ' + conds.join(' and ') : '', vals }
}
function arrancarShim(): Promise<number> {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', async () => {
      const url = new URL(req.url!, 'http://x'); const body = raw ? JSON.parse(raw) : undefined
      const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      const out = (st: number, d: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)) }
      try {
        const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
        if (rpc) {
          llamadas[rpc[1]] = (llamadas[rpc[1]] ?? 0) + 1
          if (crearRechazo && rpc[1] === 'crear_pedido_stock') return out(400, { message: 'canceling statement due to statement timeout', code: '57014' })
          if (romperReclamar && rpc[1] === 'reclamar_operacion_pedido') return out(404, { message: 'function not found', code: '42883' })
          if (romperCompletar && rpc[1] === 'completar_operacion_pedido') return out(500, { message: 'db unavailable' })
          const ks = Object.keys(body ?? {}); const esObj = (v: unknown) => typeof v === 'object' && v !== null
          const vals = ks.map(k => esObj(body[k]) ? JSON.stringify(body[k]) : body[k])
          const sql = `select ${rpc[1]}(${ks.map((k, i) => `${k} := $${i + 1}${esObj(body[k]) ? '::jsonb' : ''}`).join(', ')}) as r`
          try { const r = await db.query(sql, vals); if (romperCrear === 'perdida' && rpc[1] === 'crear_pedido_stock') return out(502, { message: 'upstream request timeout' }); return out(200, r.rows[0].r ?? null) } catch (e) { const er = e as pg.DatabaseError; return out(400, { message: er.message, code: er.code }) }
        }
        const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]
        if (t && req.method === 'GET') {
          let filas: J[]
          if (REALES.has(t)) { const f = filtros(url); const cols = (url.searchParams.get('select') ?? '*').replace(/\w+\([^)]*\)/g, '').split(',').map(c => c.trim()).filter(Boolean); filas = (await db.query(`select ${cols.map(c => c === '*' ? '*' : `"${c}"`).join(',')} from ${t}${f.where}`, f.vals)).rows }
          else filas = FIXTURES[t] ?? []
          if (obj) return filas[0] ? out(200, filas[0]) : out(406, { code: 'PGRST116', message: 'no rows' })
          return out(200, filas)
        }
        if (t && req.method === 'DELETE') { if (REALES.has(t)) { const f = filtros(url); await db.query(`delete from ${t}${f.where}`, f.vals) } return out(204, undefined) }
        if (t && req.method === 'PATCH') {
          if (t === 'pedidos') { const f = filtros(url); for (const [k, v] of Object.entries(body as J)) if (['visitante_id', 'hora_retiro'].includes(k)) await db.query(`update pedidos set "${k}" = $${f.vals.length + 1} ${f.where}`, [...f.vals, v]) }
          return out(200, [])
        }
        out(200, [])
      } catch (e) { console.error('shim', e); out(500, { message: String(e) }) }
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
}

let POST: (r: Request) => Promise<Response>, ELIMINAR: (r: Request) => Promise<Response>
before(async () => {
  admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect()
  await admin.query(`drop database if exists ${DB} with (force)`); await admin.query(`create database ${DB}`)
  db = new pg.Pool({ ...SOCK, database: DB, max: 30 }); db.on('error', () => {})
  await db.query(readFileSync(join(SUP, 'tests/stock-v2/00-schema-reducido.sql'), 'utf8'))
  await db.query('create table empresa_config (empresa_id uuid primary key, primary_color text); alter table pedidos add column hora_retiro timestamptz, add column visitante_id text')
  for (const f of ['stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql']) await db.query(readFileSync(join(SUP, f), 'utf8'))
  const port = await arrancarShim()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  POST = (await import('../../app/api/pedidos/route')).POST as typeof POST
  ELIMINAR = (await import('../../app/api/pedidos/eliminar/route')).POST as typeof ELIMINAR
})
after(async () => { server?.close(); await db?.end(); await admin?.query(`drop database if exists ${DB} with (force)`); await admin?.end() })

async function mundo(stk = 19, factor = 1) {
  const one = async (sql: string, ...a: unknown[]) => (await db.query(sql, a)).rows[0].id as string
  w.emp = await one('insert into empresas default values returning id'); w.suc = await one('insert into sucursales(empresa_id) values($1) returning id', w.emp); w.suc2 = await one('insert into sucursales(empresa_id) values($1) returning id', w.emp)
  await db.query('insert into catalogo_version(sucursal_id, empresa_id) values($1,$3),($2,$3)', [w.suc, w.suc2, w.emp]); await db.query('insert into empresa_config(empresa_id) values($1)', [w.emp])
  w.prod = await one("insert into productos(empresa_id,nombre,controla_stock) values($1,'Alfajor',true) returning id", w.emp)
  w.pres = await one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values($1,$2,'Unidad',1000,$3) returning id", w.emp, w.prod, factor)
  for (const s of [w.suc, w.suc2]) await db.query('insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values($1,$2,$3,$4)', [w.emp, w.prod, s, stk])
}
const stock = async (suc = w.suc) => Number((await db.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [w.prod, suc])).rows[0].cantidad)
const npedidos = async () => Number((await db.query('select count(*) from pedidos where empresa_id=$1', [w.emp])).rows[0].count)
const envejecer = (min: number) => db.query('update pedido_operaciones set created_at = created_at - make_interval(mins => $1), updated_at = updated_at - make_interval(mins => $1) where empresa_id=$2', [min, w.emp])
const cfg = (activo: boolean, min: number) => db.query('update empresa_config set prevenir_pedidos_repetidos=$1, pedidos_repetidos_minutos=$2 where empresa_id=$3', [activo, min, w.emp])
let seq = 0
const pedir = async (extra: J = {}, cant = 1) => POST(new Request('http://x/api/pedidos', { method: 'POST', body: JSON.stringify({
  empresa_id: w.emp, sucursal_id: w.suc, metodo_pago: 'efectivo', origen: 'KIOSK', tipo_pedido: 'kiosk',
  items: [{ presentacion_id: w.pres, nombre_producto_snap: 'a', nombre_presentacion_snap: 'u', precio_snap: 1000, cantidad: cant, opciones: [] }],
  operacion_id: crypto.randomUUID(), ...extra }) }))
const cli = (tel: string): J => ({ tipo_pedido: 'delivery', origen: 'DELIVERY', datos_delivery: { telefono: tel, nombre: 'X' } })
type Resp = { pedido?: { id: string; numero_pedido: number }; reutilizado?: boolean; error?: string; duplicado?: { operacion_id: string; ventana_minutos: number } }
const j = async (r: Response) => (await r.json()) as Resp
const eliminar = (id: string) => { FIXTURES.dispositivos = [{ id: 'd0000000-0000-4000-8000-0000000000c1', empresa_id: w.emp, sucursal_id: w.suc, tipo: 'CAJA', activo: true }]; return ELIMINAR(new Request('http://x', { method: 'POST', body: JSON.stringify({ pedido_id: id, dispositivo_id: 'd0000000-0000-4000-8000-0000000000c1' }) })) }

describe('Stock V2 por la ruta real (demo del CTO: 19 → 17 → 19)', () => {
  beforeEach(() => mundo(19, 1))
  test('venta de 2 descuenta (19→17) y eliminar devuelve (→19); eliminar repetido no devuelve de más', async () => {
    const r = await pedir({}, 2); assert.equal(r.status, 200); const p = (await j(r)).pedido!
    assert.equal(await stock(), 17)
    assert.equal((await eliminar(p.id)).status, 200); assert.equal(await stock(), 19)
    assert.equal((await eliminar(p.id)).status, 404); assert.equal(await stock(), 19)
    const n = Number((await db.query('select coalesce(sum(delta),0) as s from stock_movimientos where empresa_id=$1', [w.emp])).rows[0].s); assert.equal(n, 0, 'el libro cierra')
  })
  test('factor 8: la venta descuenta cantidad×8 y la devolución usa el snapshot aunque el factor cambie', async () => {
    await mundo(100, 8); const p = (await j(await pedir({}, 2))).pedido!; assert.equal(await stock(), 84)
    await db.query('update presentaciones set factor_stock=10 where id=$1', [w.pres])
    await eliminar(p.id); assert.equal(await stock(), 100)
  })
})

describe('Pedidos repetidos por la ruta real', () => {
  beforeEach(async () => { romperReclamar = false; romperCrear = null; romperCompletar = false; crearRechazo = false; for (const k of Object.keys(llamadas)) delete llamadas[k]; await mundo(50, 1) })
  const tel = () => `11${String(++seq).padStart(8, '0')}`

  test('1) mismo cliente, mismo pedido, dentro de la ventana: 409 con el texto del CTO y NO se crea pedido ni se descuenta stock', async () => {
    const t = tel(); assert.equal((await pedir(cli(t))).status, 200)
    const r = await pedir(cli(t)); const d = await j(r)
    assert.equal(r.status, 409); assert.equal(d.error, 'Estás cargando un pedido igual al que realizaste hace unos minutos. ¿Querés generar otro pedido?')
    assert.equal(d.duplicado?.ventana_minutos, 30); assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
  })
  test('2) ventana configurable: con 2 min advierte y a los 3 deja pasar; hasta el máximo de 1440 min (24 h)', async () => {
    const t = tel(); await cfg(true, 2); await pedir(cli(t)); assert.equal((await pedir(cli(t))).status, 409); await envejecer(3); assert.equal((await pedir(cli(t))).status, 200)
    const t2 = tel(); await cfg(true, 1440); await pedir(cli(t2)); await envejecer(1400); assert.equal((await pedir(cli(t2))).status, 409)
    await assert.rejects(cfg(true, 1441), /check|rango/i); await assert.rejects(cfg(true, 0), /check|rango/i)   // la base impone 1..1440
  })
  test('3) fuera del período (31 min con ventana 30): sin advertencia', async () => {
    const t = tel(); await pedir(cli(t)); await envejecer(31); assert.equal((await pedir(cli(t))).status, 200)
  })
  test('4) clientes diferentes: sin advertencia cruzada', async () => {
    assert.equal((await pedir(cli(tel()))).status, 200); assert.equal((await pedir(cli(tel()))).status, 200)
  })
  test('5) sin cliente identificado: se valida por dispositivo (kiosco)', async () => {
    const d1 = crypto.randomUUID(), d2 = crypto.randomUUID()
    assert.equal((await pedir({ dispositivo_id: d1 })).status, 200); assert.equal((await pedir({ dispositivo_id: d1 })).status, 409); assert.equal((await pedir({ dispositivo_id: d2 })).status, 200)
  })
  test('6) sucursales diferentes: no se mezclan', async () => {
    const t = tel(); await pedir(cli(t)); assert.equal((await pedir({ ...cli(t), sucursal_id: w.suc2 })).status, 200)
  })
  test('7) cantidades diferentes: no son idénticos', async () => {
    const t = tel(); await pedir(cli(t), 1); assert.equal((await pedir(cli(t), 2)).status, 200)
  })
  test('9) el cliente VUELVE: no se crea pedido; la operación advertida queda sin pedido', async () => {
    const t = tel(); await pedir(cli(t)); const d = await j(await pedir(cli(t))); assert.equal(await npedidos(), 1)
    const r = (await db.query('select estado, pedido_id from pedido_operaciones where operacion_id=$1', [d.duplicado!.operacion_id])).rows[0]; assert.equal(r.estado, 'ADVERTIDA'); assert.equal(r.pedido_id, null)
  })
  test('10) el cliente CONFIRMA con la misma operación advertida: se crea el segundo pedido; reenviar la confirmación devuelve ese mismo pedido', async () => {
    const t = tel(); await pedir(cli(t)); const op = (await j(await pedir(cli(t)))).duplicado!.operacion_id
    const r = await pedir({ ...cli(t), operacion_id: op, confirmar_advertencia: true }); assert.equal(r.status, 200); const p = (await j(r)).pedido!; assert.equal(await npedidos(), 2)
    const r2 = await pedir({ ...cli(t), operacion_id: op, confirmar_advertencia: true }); const d2 = await j(r2); assert.equal(r2.status, 200); assert.equal(d2.pedido!.id, p.id); assert.equal(d2.reutilizado, true); assert.equal(await npedidos(), 2)
  })
  test('10b) confirmar SIN advertencia previa, o con otro contenido/identidad/sucursal: no autoriza nada', async () => {
    const t = tel(); await pedir(cli(t))
    assert.equal((await pedir({ ...cli(t), confirmar_advertencia: true })).status, 409)
    const op = (await j(await pedir(cli(t)))).duplicado!.operacion_id
    assert.equal((await pedir({ ...cli(t), operacion_id: op, confirmar_advertencia: true }, 3)).status, 409)
    assert.equal((await pedir({ ...cli(tel()), operacion_id: op, confirmar_advertencia: true })).status, 409)
    assert.equal((await pedir({ ...cli(t), sucursal_id: w.suc2, operacion_id: op, confirmar_advertencia: true })).status, 409)
    assert.equal(await npedidos(), 1)
  })
  test('10c) reenviar la operación advertida SIN confirmar_advertencia (reintento/doble clic): sigue siendo 409, no se cuela un pedido', async () => {
    const t = tel(); await pedir(cli(t)); const op = (await j(await pedir(cli(t)))).duplicado!.operacion_id
    for (let i = 0; i < 3; i++) assert.equal((await pedir({ ...cli(t), operacion_id: op })).status, 409)
    assert.equal(await npedidos(), 1)
  })
  test('11) doble clic: 10 envíos simultáneos de la MISMA operación → un único pedido, todos reciben el mismo, stock descontado una vez', async () => {
    const op = crypto.randomUUID(), t = tel(); const rs = await Promise.all(Array.from({ length: 10 }, () => pedir({ ...cli(t), operacion_id: op })))
    const ds = await Promise.all(rs.map(j)); assert.ok(rs.every(r => r.status === 200), rs.map(r => r.status).join(',')); assert.equal(new Set(ds.map(d => d.pedido!.id)).size, 1)
    assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
  })
  test('12) timeout y reintento (misma operación, después): devuelve el mismo pedido, sin duplicar ni descontar de nuevo', async () => {
    const op = crypto.randomUUID(), t = tel(); const a = await j(await pedir({ ...cli(t), operacion_id: op })); const b = await j(await pedir({ ...cli(t), operacion_id: op }))
    assert.equal(a.pedido!.id, b.pedido!.id); assert.equal(b.reutilizado, true); assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
  })
  test('13) 10 operaciones DISTINTAS con el mismo contenido y la misma persona, simultáneas: pasa una, las otras 9 reciben la advertencia', async () => {
    const t = tel(); const rs = await Promise.all(Array.from({ length: 10 }, () => pedir(cli(t)))); const st = rs.map(r => r.status).sort()
    assert.deepEqual(st, [200, 409, 409, 409, 409, 409, 409, 409, 409, 409]); assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
  })
  test('13b) sin falsos positivos: 8 pedidos con cantidades distintas (1 a 8) a la vez, todos pasan', async () => {
    const t = tel(); const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => pedir(cli(t), i + 1))); assert.ok(rs.every(r => r.status === 200)); assert.equal(await npedidos(), 8)
  })
  test('14) prevención desactivada: nunca advierte', async () => {
    await cfg(false, 30); const t = tel(); await pedir(cli(t)); assert.equal((await pedir(cli(t))).status, 200)
  })
  test('15) empresas con configuración distinta: cada una la suya', async () => {
    const t = tel(); await pedir(cli(t)); const e1 = { ...w }; await mundo(50, 1); await cfg(false, 5); await pedir(cli(t))
    assert.equal((await pedir(cli(t))).status, 200)                       // empresa 2: desactivada
    Object.assign(w, e1); assert.equal((await pedir(cli(t))).status, 409) // empresa 1: activa
  })
  test('16) pedido cancelado no cuenta; pedido eliminado tampoco', async () => {
    const t = tel(); const p = (await j(await pedir(cli(t)))).pedido!; await db.query("update pedidos set estado='CANCELLED' where id=$1", [p.id]); assert.equal((await pedir(cli(t))).status, 200)
    const t2 = tel(); const p2 = (await j(await pedir(cli(t2)))).pedido!; await eliminar(p2.id); assert.equal((await pedir(cli(t2))).status, 200)
  })
  test('17) falla de creación (SIN_STOCK): 409 de stock, la operación se libera y el reintento con la misma operación funciona al reponer', async () => {
    await db.query('update producto_stock set cantidad=0 where producto_id=$1', [w.prod]); const op = crypto.randomUUID(), t = tel()
    const r = await pedir({ ...cli(t), operacion_id: op }); assert.equal(r.status, 409); assert.match((await j(r)).error!, /stock/i)
    // CTO B8: SIN_STOCK REAL → rollback completo (sin pedido, ítems ni movimientos, numeración sin consumir) y RECIÉN ENTONCES la operación se libera y se puede reclamar de nuevo
    assert.equal(await npedidos(), 0); assert.equal(Number((await db.query('select count(*) from pedido_items i join pedidos p on p.id=i.pedido_id where p.empresa_id=$1', [w.emp])).rows[0].count), 0)
    assert.equal(Number((await db.query('select count(*) from stock_movimientos where empresa_id=$1', [w.emp])).rows[0].count), 0); assert.equal(await stock(), 0)
    assert.equal(llamadas['crear_pedido_stock'], 1); assert.equal(llamadas['liberar_operacion_pedido'], 1, 'se liberó DESPUÉS del rechazo probado')
    assert.equal((await db.query('select count(*) from pedido_operaciones where operacion_id=$1', [op])).rows[0].count, '0')
    await db.query('update producto_stock set cantidad=5 where producto_id=$1', [w.prod]); const ok = await pedir({ ...cli(t), operacion_id: op }); assert.equal(ok.status, 200)
    assert.equal((await j(ok)).pedido!.numero_pedido, 1, 'la numeración no se consumió en el intento fallido')
  })
  test('19) UUID OBLIGATORIO: sin operacion_id (cliente viejo) o con uno inválido → 400, no se crea nada, no se reclama, no se toca el stock (el servidor NO inventa la identidad)', async () => {
    const t = tel()
    for (const op of [undefined, '', 'no-es-uuid', 123, null]) {
      const r = await pedir({ ...cli(t), operacion_id: op }); const d = (await r.json()) as { codigo?: string }
      assert.equal(r.status, 400, String(op)); assert.equal(d.codigo, 'OPERACION_ID_REQUERIDO')
    }
    assert.equal(await npedidos(), 0); assert.equal(await stock(), 50); assert.equal(llamadas['reclamar_operacion_pedido'] ?? 0, 0); assert.equal(llamadas['crear_pedido_stock'] ?? 0, 0)
    assert.equal((await db.query('select count(*) from pedido_operaciones where empresa_id=$1', [w.emp])).rows[0].count, '0')
    assert.equal((await pedir({ ...cli(t), confirmar_duplicado: true, operacion_id: undefined })).status, 400)
  })
  test('20) FAIL-CLOSED: si no se puede reclamar la operación (falla de la base / SQL sin aplicar) NO se crea el pedido sin protección: 503 recuperable, sin pedido ni descuento de stock', async () => {
    romperReclamar = true; const t = tel(); const op = crypto.randomUUID(); const r = await pedir({ ...cli(t), operacion_id: op }); const d = (await r.json()) as { error: string; reintentable?: boolean }
    assert.equal(r.status, 503); assert.equal(d.reintentable, true); assert.match(d.error, /NO fue creado/); assert.equal(await npedidos(), 0); assert.equal(await stock(), 50)
    // CTO B7: fallo del reclamo → NO llama a crear_pedido_stock, NO descuenta stock (ni movimientos), NO llama a liberar_ (el resultado podría ser incierto) y no deja filas
    assert.equal(llamadas['reclamar_operacion_pedido'], 1); assert.equal(llamadas['crear_pedido_stock'] ?? 0, 0, 'no se creó nada'); assert.equal(llamadas['liberar_operacion_pedido'] ?? 0, 0, 'no se liberó nada')
    assert.equal(Number((await db.query('select count(*) from stock_movimientos where empresa_id=$1', [w.emp])).rows[0].count), 0)
    assert.equal((await db.query('select count(*) from pedido_operaciones where operacion_id=$1', [op])).rows[0].count, '0')
    const dbl = await Promise.all([pedir(cli(t)), pedir(cli(t))]); assert.ok(dbl.every(x => x.status === 503)); assert.equal(await npedidos(), 0)
    romperReclamar = false; assert.equal((await pedir(cli(t))).status, 200); assert.equal(await npedidos(), 1)   // al recuperarse, el reintento funciona
  })
  test('22) RESPUESTA PERDIDA: la base crea el pedido pero la respuesta nunca llega (502 sin SQLSTATE) → 503, la operación NO se libera, y el reintento recupera el MISMO pedido (un solo pedido, stock una vez)', async () => {
    const op = crypto.randomUUID(), t = tel(); romperCrear = 'perdida'
    const r = await pedir({ ...cli(t), operacion_id: op }); const d = (await r.json()) as { reintentable?: boolean }
    assert.equal(r.status, 503); assert.equal(d.reintentable, true)
    assert.equal(await npedidos(), 1, 'el pedido SÍ se creó aunque el cliente no lo supo'); assert.equal(await stock(), 49)
    const fila = (await db.query('select estado, pedido_id from pedido_operaciones where operacion_id=$1', [op])).rows[0]; assert.ok(fila, 'la operación no se liberó'); assert.equal(fila.estado, 'EN_CURSO')
    romperCrear = null; await envejecer(2)                                // la operación EN_CURSO queda "abandonada" (>90 s)
    const r2 = await pedir({ ...cli(t), operacion_id: op }); const d2 = await j(r2)
    assert.equal(r2.status, 200); assert.equal(d2.reutilizado, true); assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
    const idUnico = (await db.query('select id from pedidos where empresa_id=$1', [w.emp])).rows[0].id; assert.equal(d2.pedido!.id, idUnico)
    const fin = (await db.query('select estado, pedido_id from pedido_operaciones where operacion_id=$1', [op])).rows[0]; assert.equal(fin.estado, 'COMPLETADA'); assert.equal(fin.pedido_id, idUnico)
  })
  test('23) completar_ FALLA tras crear el pedido: el cliente recibe éxito; pasados 90 s el reintento (aunque cambió el precio) devuelve el MISMO pedido, sin duplicar', async () => {
    const op = crypto.randomUUID(), t = tel(); romperCompletar = true
    const r = await pedir({ ...cli(t), operacion_id: op }); assert.equal(r.status, 200); const p = (await j(r)).pedido!
    assert.equal((await db.query('select estado from pedido_operaciones where operacion_id=$1', [op])).rows[0].estado, 'EN_CURSO')
    romperCompletar = false; await envejecer(2); await db.query('update presentaciones set precio=1500 where id=$1', [w.pres])   // otro precio: un carrito nuevo se rechazaría
    const r2 = await pedir({ ...cli(t), operacion_id: op }); const d2 = await j(r2)
    assert.equal(r2.status, 200); assert.equal(d2.pedido!.id, p.id); assert.equal(d2.reutilizado, true); assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
    const nuevo = await pedir(cli(tel())); assert.equal(nuevo.status, 409, 'control: una operación NUEVA con el precio viejo sí se rechaza (precios actualizados)')
  })
  test('23b) completar_ FALLA y el cliente reintenta DE INMEDIATO (<90 s): recupera el MISMO pedido al instante (200 reutilizado), sin esperar ni 409, sin duplicar', async () => {
    const op = crypto.randomUUID(), t = tel(); romperCompletar = true
    const p = (await j(await pedir({ ...cli(t), operacion_id: op }))).pedido!; romperCompletar = false
    const t0 = Date.now(); const r2 = await pedir({ ...cli(t), operacion_id: op }); const d2 = await j(r2)
    assert.equal(r2.status, 200); assert.equal(d2.pedido!.id, p.id); assert.equal(d2.reutilizado, true); assert.ok(Date.now() - t0 < 3000, 'sin espera de polling')
    assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
    assert.equal((await db.query('select estado from pedido_operaciones where operacion_id=$1', [op])).rows[0].estado, 'COMPLETADA', 'reclamar_ cerró la operación')
  })
  test('23c) error de la base FUERA de la lista de rollback demostrado (p. ej. 57014 statement timeout): 503, la operación NO se libera y se conserva EN_CURSO', async () => {
    const op = crypto.randomUUID(), t = tel(); crearRechazo = true
    const r = await pedir({ ...cli(t), operacion_id: op }); const d = (await r.json()) as { reintentable?: boolean }
    assert.equal(r.status, 503); assert.equal(d.reintentable, true); assert.equal(llamadas['liberar_operacion_pedido'] ?? 0, 0)
    assert.equal((await db.query('select estado from pedido_operaciones where operacion_id=$1', [op])).rows[0].estado, 'EN_CURSO'); assert.equal(await npedidos(), 0)
    crearRechazo = false; await envejecer(2)                                // tras 90 s la operación abandonada se retoma: el reintento con el MISMO id crea UN pedido
    const r2 = await pedir({ ...cli(t), operacion_id: op }); assert.equal(r2.status, 200); assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
  })
  test('24) error de la base que PRUEBA que no hay pedido (SQLSTATE): la operación se libera; un error AMBIGUO no la libera (ver 22)', async () => {
    await db.query('update producto_stock set cantidad=0 where producto_id=$1', [w.prod]); const op = crypto.randomUUID()
    assert.equal((await pedir({ ...cli(tel()), operacion_id: op })).status, 409)
    assert.equal((await db.query('select count(*) from pedido_operaciones where operacion_id=$1', [op])).rows[0].count, '0')
  })
  test('25) eliminar con stock_descontado NULL: se trata EXPLÍCITAMENTE como no descontado (no devuelve stock, no llama a la RPC) y el pedido se elimina', async () => {
    await db.query('alter table pedidos alter column stock_descontado drop not null')
    try {
      const p = (await j(await pedir(cli(tel())))).pedido!; assert.equal(await stock(), 49); await db.query('update pedidos set stock_descontado=null where id=$1', [p.id])
      for (const k of Object.keys(llamadas)) delete llamadas[k]
      const r = await eliminar(p.id); assert.equal(r.status, 200); assert.equal(llamadas['devolver_stock_pedido'] ?? 0, 0); assert.equal(await stock(), 49, 'no se devolvió lo que no se probó descontado'); assert.equal(await npedidos(), 0)
    } finally { await db.query('update pedidos set stock_descontado=false where stock_descontado is null; alter table pedidos alter column stock_descontado set not null') }
  })
  test('21) la regla vieja fija de 30 min ya no existe: con ventana de 1 min, a los 2 min el mismo pedido pasa', async () => {
    const t = tel(); await cfg(true, 1); await pedir(cli(t)); await envejecer(2); assert.equal((await pedir(cli(t))).status, 200)
  })
})
