// BLOQUEO DE DUPLICADOS (opción C, CTO 13/11) por la RUTA REAL /api/pedidos contra POSTGRES LOCAL REAL (misma base de pruebas que pedidos-repetidos-ruta.test.ts)
// + pedidos-duplicados-bloqueo.sql. Ejecutar: npx tsx --test src/lib/__tests__/pedidos-bloqueo-ruta.test.ts  (necesita `npm i pg --no-save` y el cluster de supabase/tests/stock-v2/README.md)
// (base heredada) RUTAS REALES /api/pedidos y /api/pedidos/eliminar contra POSTGRES LOCAL REAL (funciones SQL reales: crear_pedido_stock v1.7 (operacion_id),
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
const DB = 'blq_ruta'
let admin: pg.Client, db: pg.Pool, server: http.Server
let romperReclamar = false
let romperCrear: 'perdida' | null = null          // la RPC de creación COMMITEA pero la respuesta se pierde (502 sin código)
let romperCompletar = false                       // completar_operacion_pedido falla (500) sin ejecutarse
let crearRechazo = false                          // la RPC de creación responde un error con SQLSTATE FUERA de la lista de rollback demostrado (sin ejecutarse)
const llamadas: Record<string, number> = {}
const cuerpos: Record<string, J[]> = {}          // cuerpos recibidos por cada RPC (para probar QUÉ parámetros manda el servidor)
let romperLlave = false                           // la lectura de la llave falla (columna inexistente: SQL aún no aplicado)       // RPC invocadas por el endpoint (para probar qué NO se llama)
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
          llamadas[rpc[1]] = (llamadas[rpc[1]] ?? 0) + 1; (cuerpos[rpc[1]] ??= []).push(body ?? {})
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
          if (REALES.has(t) || (t === 'empresa_config' && String(url.searchParams.get('select') ?? '').includes('bloquear_pedidos_duplicados'))) { if (t === 'empresa_config' && romperLlave) return out(400, { message: 'column empresa_config.bloquear_pedidos_duplicados does not exist', code: '42703' }); const f = filtros(url); const cols = (url.searchParams.get('select') ?? '*').replace(/\w+\([^)]*\)/g, '').split(',').map(c => c.trim()).filter(Boolean); filas = (await db.query(`select ${cols.map(c => c === '*' ? '*' : `"${c}"`).join(',')} from ${t}${f.where}`, f.vals)).rows }
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
  for (const f of ['stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql', 'pedidos-duplicados-bloqueo.sql']) await db.query(readFileSync(join(SUP, f), 'utf8'))
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


const llave = (on: boolean, horas = 3) => db.query('update empresa_config set bloquear_pedidos_duplicados=$1, pedido_activo_ventana_horas=$2 where empresa_id=$3', [on, horas, w.emp])
const estadoDe = (id: string, e: string) => db.query('update pedidos set estado=$1 where id=$2', [e, id])
type Bq = Resp & { bloqueo?: { tipo: string; operacion_id: string; id: string | null; numero_pedido: number | null; estado: string | null; permite_otro?: boolean; ventana_horas?: number; ventana_minutos?: number } }
const jb = async (r: Response) => (await r.json()) as Bq
const delivery = (tel: string, extra: J = {}): J => ({ tipo_pedido: 'delivery', origen: 'DELIVERY', datos_delivery: { telefono: tel, nombre: 'Sandra' }, ...extra })
const takeaway = (tel: string, extra: J = {}): J => ({ tipo_pedido: 'takeaway', origen: 'TAKEAWAY', datos_delivery: { telefono: tel, nombre: 'Sandra' }, ...extra })
const reclamos = () => (cuerpos['reclamar_operacion_pedido'] ?? [])

describe('Bloqueo de duplicados por la ruta real (opción C, CTO 13/11)', () => {
  FIXTURES.takeaway_config = [{ activo: true, horarios: [], tolerancia_cierre: 5, mensaje_fuera_horario: null, acepta_anticipado: false }]   // take away abierto (sin franjas)
  beforeEach(async () => { romperReclamar = false; romperCrear = null; romperCompletar = false; crearRechazo = false; romperLlave = false; for (const k of Object.keys(llamadas)) delete llamadas[k]; for (const k of Object.keys(cuerpos)) delete cuerpos[k]; await mundo(50, 1) })
  const tel = () => `23${String(++seq).padStart(8, '0')}`

  test('A1) CASO REAL #43/#49: mismo teléfono, otra cantidad, otro visitante, otro dispositivo → 409 ACTIVO, no se crea pedido ni se descuenta stock', async () => {
    await llave(true); const t = tel()
    const p1 = await pedir(delivery(t, { visitante_id: 'celu-sandra', dispositivo_id: crypto.randomUUID() }), 2); assert.equal(p1.status, 200)
    const r = await pedir(delivery(t, { visitante_id: 'otro-dispositivo', dispositivo_id: crypto.randomUUID() }), 3); const d = await jb(r)
    assert.equal(r.status, 409); assert.equal(d.bloqueo?.tipo, 'ACTIVO'); assert.equal(d.bloqueo?.permite_otro, true); assert.equal(d.bloqueo?.estado, 'PENDING_PAYMENT')
    assert.ok(d.bloqueo?.numero_pedido != null && d.bloqueo?.id); assert.equal(d.bloqueo?.ventana_horas, 3)
    assert.equal(d.duplicado, undefined, 'una pestaña vieja NO debe abrir el modal con "Sí, continuar": la clave es `bloqueo`')
    assert.match(d.error ?? '', /ya tiene un pedido en curso/); assert.equal(await npedidos(), 1); assert.equal(await stock(), 48)
  })
  test('A2) contenido IDÉNTICO → 409 IDENTICO sin salida: ni confirmar_advertencia ni confirmar_otro_pedido (ni ambos) lo saltean', async () => {
    await llave(true); const t = tel(); assert.equal((await pedir(delivery(t))).status, 200)
    const op = crypto.randomUUID(); const res = []
    for (const extra of [{}, { confirmar_advertencia: true }, { confirmar_otro_pedido: true }, { confirmar_advertencia: true, confirmar_otro_pedido: true }]) {
      const r = await pedir(delivery(t, { operacion_id: op, ...extra })); const d = await jb(r); res.push([r.status, d.bloqueo?.tipo, d.duplicado])
    }
    assert.deepEqual(res, [[409, 'IDENTICO', undefined], [409, 'IDENTICO', undefined], [409, 'IDENTICO', undefined], [409, 'IDENTICO', undefined]])
    assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
  })
  test('A3) familiar con el mismo teléfono: 409 ACTIVO; con confirmar_otro_pedido sobre la MISMA operación se crea (200); sin advertencia previa no autoriza', async () => {
    await llave(true); const t = tel(); await pedir(delivery(t), 1)
    const sinAviso = await pedir(delivery(t, { confirmar_otro_pedido: true }), 2); assert.equal(sinAviso.status, 409, 'excepción sin advertencia previa de esa operación: no vale')
    const op = crypto.randomUUID(); const a = await pedir(delivery(t, { operacion_id: op }), 3); assert.equal(a.status, 409); assert.equal((await jb(a)).bloqueo?.tipo, 'ACTIVO')
    const leg = await pedir(delivery(t, { operacion_id: op, confirmar_advertencia: true }), 3); assert.equal(leg.status, 409, 'la confirmación legacy no es la excepción del nivel 2')
    const ok = await pedir(delivery(t, { operacion_id: op, confirmar_otro_pedido: true }), 3); assert.equal(ok.status, 200); assert.equal(await npedidos(), 2); assert.equal(await stock(), 46)
    const otra = await pedir(delivery(t), 4); assert.equal(otra.status, 409, 'la excepción no es permanente')
  })
  test('A4) take away también está en alcance', async () => {
    await llave(true); const t = tel(); assert.equal((await pedir(takeaway(t), 1)).status, 200)
    const r = await pedir(takeaway(t), 2); assert.equal(r.status, 409); assert.equal((await jb(r)).bloqueo?.tipo, 'ACTIVO')
    const r2 = await pedir(takeaway(t), 1); assert.equal((await jb(r2)).bloqueo?.tipo, 'IDENTICO')
  })
  test('A5) pedido CANCELADO o ENTREGADO: permite un pedido nuevo (distinto e idéntico)', async () => {
    await llave(true)
    for (const e of ['CANCELLED', 'DELIVERED']) {
      const t = tel(); const p = (await jb(await pedir(delivery(t), 1))).pedido!; await estadoDe(p.id, e)
      assert.equal((await pedir(delivery(t), 2)).status, 200, `${e}: contenido distinto`)
      const t2 = tel(); const q = (await jb(await pedir(delivery(t2), 1))).pedido!; await estadoDe(q.id, e)
      assert.equal((await pedir(delivery(t2), 1)).status, 200, `${e}: contenido idéntico`)
    }
  })
  test('A6) dos teléfonos distintos con contenido idéntico: la identidad existente no los cruza', async () => {
    await llave(true); assert.equal((await pedir(delivery(tel()), 1)).status, 200); assert.equal((await pedir(delivery(tel()), 1)).status, 200)
  })
  test('A7) LLAVE APAGADA (por defecto): comportamiento anterior — 409 `duplicado` con "Sí, continuar"; contenido distinto pasa; y el servidor llama con los 8 parámetros históricos', async () => {
    const t = tel(); const p1 = await pedir(delivery(t), 1); assert.equal(p1.status, 200)
    assert.equal((await pedir(delivery(t), 2)).status, 200, 'contenido distinto, mismo teléfono: sin aviso con la llave apagada')
    const op = crypto.randomUUID(); const r = await pedir(delivery(t, { operacion_id: op }), 1); const d = await jb(r)
    assert.equal(r.status, 409); assert.ok(d.duplicado); assert.equal(d.bloqueo, undefined)
    assert.equal((await pedir(delivery(t, { operacion_id: op, confirmar_advertencia: true }), 1)).status, 200, '"Sí, continuar" legacy sigue funcionando')
    assert.ok(reclamos().length > 0 && reclamos().every(b => !('p_alcance_bloqueo' in b) && !('p_confirmar_otro' in b)), 'con la llave apagada la llamada es idéntica a la histórica (sin parámetros nuevos)')
  })
  test('A8) KIOSCO (y fuera de alcance) con la llave PRENDIDA: sin cambios, y la RPC NO recibe parámetros de bloqueo', async () => {
    await llave(true); const d1 = crypto.randomUUID()
    assert.equal((await pedir({ dispositivo_id: d1 })).status, 200); const r = await pedir({ dispositivo_id: d1 }); assert.equal(r.status, 409); const d = await jb(r)
    assert.ok(d.duplicado); assert.equal(d.bloqueo, undefined)
    assert.equal((await pedir({ dispositivo_id: d1, operacion_id: d.duplicado!.operacion_id, confirmar_advertencia: true })).status, 200, '"Sí, continuar" del kiosco intacto')
    assert.ok(reclamos().every(b => !('p_alcance_bloqueo' in b)), 'kiosco: ninguna llamada lleva p_alcance_bloqueo')
  })
  test('A9) el servidor manda los parámetros de bloqueo SOLO para delivery/take away con la llave prendida', async () => {
    await llave(true); await pedir(delivery(tel()), 1)
    const b = reclamos().at(-1)!; assert.equal(b.p_alcance_bloqueo, true); assert.equal(b.p_confirmar_otro, false)
    await pedir(takeaway(tel()), 1); assert.equal(reclamos().at(-1)!.p_alcance_bloqueo, true)
  })
  test('A10) código NUEVO con base VIEJA (la lectura de la llave falla: SQL sin aplicar): comportamiento anterior, no se rompe el pedido', async () => {
    romperLlave = true; const t = tel()
    assert.equal((await pedir(delivery(t), 1)).status, 200)
    const r = await pedir(delivery(t), 1); assert.equal(r.status, 409); assert.ok((await jb(r)).duplicado)
    assert.ok(reclamos().every(b => !('p_alcance_bloqueo' in b)), 'sin llave legible → llamada histórica de 8 parámetros')
  })
  test('A11) FAIL-CLOSED intacto: si reclamar_operacion_pedido no responde, 503 y NO se crea el pedido (también con la llave prendida)', async () => {
    await llave(true); romperReclamar = true; const r = await pedir(delivery(tel()), 1)
    assert.equal(r.status, 503); assert.equal(await npedidos(), 0); assert.equal(llamadas['crear_pedido_stock'] ?? 0, 0)
  })
  test('A12) idempotencia intacta con la llave prendida: el MISMO envío reintentado devuelve el MISMO pedido', async () => {
    await llave(true); const t = tel(); const op = crypto.randomUUID()
    const a = await jb(await pedir(delivery(t, { operacion_id: op }), 1)); const b = await jb(await pedir(delivery(t, { operacion_id: op }), 1))
    assert.equal(b.reutilizado, true); assert.equal(a.pedido!.id, b.pedido!.id); assert.equal(await npedidos(), 1); assert.equal(await stock(), 49)
  })
  test('A13) CONCURRENCIA por la ruta: 2 envíos simultáneos del mismo teléfono con contenido distinto → exactamente 1 pedido (8 rondas)', async () => {
    await llave(true)
    for (let k = 0; k < 8; k++) {
      const t = tel(); const rs = await Promise.all([pedir(delivery(t, { visitante_id: `a${k}` }), 1), pedir(delivery(t, { visitante_id: `b${k}` }), 2)])
      assert.deepEqual(rs.map(r => r.status).sort(), [200, 409], `ronda ${k}`)
    }
    assert.equal(await npedidos(), 8)
  })
  test('A14) CONCURRENCIA por la ruta: 6 envíos simultáneos del mismo teléfono (3 contenidos) → 1 pedido; teléfonos distintos no se frenan entre sí', async () => {
    await llave(true); const t = tel()
    const rs = await Promise.all([1, 2, 3, 1, 2, 3].map((c, i) => pedir(delivery(t, { visitante_id: `v${i}` }), c)))
    assert.equal(rs.filter(r => r.status === 200).length, 1); assert.equal(await npedidos(), 1)
    const rs2 = await Promise.all([1, 2, 3, 4].map(i => pedir(delivery(tel()), i))); assert.ok(rs2.every(r => r.status === 200)); assert.equal(await npedidos(), 5)
  })
})
