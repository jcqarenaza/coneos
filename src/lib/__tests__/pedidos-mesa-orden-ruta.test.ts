// MESA: ORDEN DE EFECTOS en la RUTA REAL /api/pedidos (CTO 17/11: «preservar fix y completar validaciones previas»).
// Qué prueba: que todo rechazo que NO depende de la RPC (número de mesa, sabor agotado, promo fuera de vigencia / inválida, reclamo de operación
// EXISTENTE / DUPLICADO / operación inválida) ocurre ANTES de tocar `mesa_cuentas` (no se abre cuenta vacía ni se cierra la cuenta anterior),
// que si falla el alta de la cuenta se LIBERA el reclamo, y (M13, GO CTO 18/11) que cuando la RPC rechaza con rollback DEMOSTRADO la ruta restaura las cuentas
// (borra SOLO la cuenta nueva vacía; la anterior queda cerrada, jamás se reabre) y que ante un resultado ambiguo NO toca nada. Tests C1–C14.
// Base: Postgres 16 local REAL con las funciones SQL reales (crear_pedido_stock v1.7, reclamar_operacion_pedido…). `mesa_cuentas` es tabla real
// pero con esquema REDUCIDO (el real no está en el repo). Entre la ruta y Postgres hay un shim HTTP mínimo que imita PostgREST (NO es PostgREST ni
// Supabase real: sin RLS ni auth). stock_sabor / promociones / promo_slots / presentaciones / opciones son FIXTURES (mocks), no tablas.
// Ejecutar: npx tsx --test src/lib/__tests__/pedidos-mesa-orden-ruta.test.ts  (necesita `npm i pg --no-save` y el cluster de supabase/tests/stock-v2/README.md)
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const SUP = join(process.cwd(), 'supabase')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const DB = 'mesa_ruta'
let admin: pg.Client, db: pg.Pool, server: http.Server
let romperCuenta = false                          // el INSERT en mesa_cuentas falla (500)
let hookRpc: ((body: Record<string, unknown>) => Promise<void>) | null = null   // se ejecuta ANTES de crear_pedido_stock (simula operaciones concurrentes)
let errorRpc: { message: string; code?: string } | null = null                  // crear_pedido_stock devuelve este error SIN ejecutarse
let hookDelete: (() => Promise<void>) | null = null                              // se ejecuta ANTES del DELETE de mesa_cuentas (pedido que aparece entre la lectura y el borrado)
let deleteFalso: 'cero' | 'dos' | null = null                                    // el DELETE responde sin error pero con 0 / 2 filas (y no borra nada)
const llamadas: Record<string, number> = {}
type J = Record<string, unknown>
const w = { emp: '', suc: '', prod: '', pres: '' }

const REALES = new Set(['pedidos', 'pedido_items', 'pedido_item_opciones', 'mesa_cuentas'])
const FIXTURES: Record<string, J[]> = { sucursales: [{ activo: true, horario_general: null, mensaje_cerrado: null, tolerancia_cierre: 0, dias_apertura: null, horario_por_dia: null }] }
function filtros(url: URL) {
  const conds: string[] = [], vals: unknown[] = []
  for (const [k, v] of url.searchParams.entries()) {
    if (v.startsWith('eq.')) { vals.push(v.slice(3)); conds.push(k.endsWith('_at') ? `"${k}" = $${vals.length}::timestamptz` : `"${k}"::text = $${vals.length}`) }
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
          if (rpc[1] === 'crear_pedido_stock') { if (hookRpc) await hookRpc(body ?? {}); if (errorRpc) return out(400, errorRpc) }
          const ks = Object.keys(body ?? {}); const esObj = (v: unknown) => typeof v === 'object' && v !== null
          const vals = ks.map(k => esObj(body[k]) ? JSON.stringify(body[k]) : body[k])
          const sql = `select ${rpc[1]}(${ks.map((k, i) => `${k} := $${i + 1}${esObj(body[k]) ? '::jsonb' : ''}`).join(', ')}) as r`
          try { const r = await db.query(sql, vals); return out(200, r.rows[0].r ?? null) } catch (e) { const er = e as pg.DatabaseError; return out(400, { message: er.message, code: er.code }) }
        }
        const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]
        if (t && req.method === 'GET') {
          let filas: J[]
          if (REALES.has(t) || (t === 'empresa_config' && String(url.searchParams.get('select') ?? '').includes('bloquear_pedidos_duplicados'))) {
            const f = filtros(url); const lim = url.searchParams.get('limit'); const ord = url.searchParams.get('order')
            const orden = ord ? ` order by "${ord.split('.')[0]}" ${ord.endsWith('.desc') ? 'desc' : 'asc'}` : ''
            filas = (await db.query(`select * from ${t}${f.where}${orden}${lim ? ` limit ${Number(lim)}` : ''}`, f.vals)).rows
          } else filas = FIXTURES[t] ?? []
          if (obj) return filas[0] ? out(200, filas[0]) : out(406, { code: 'PGRST116', message: 'no rows' })
          return out(200, filas)
        }
        if (t === 'mesa_cuentas' && req.method === 'POST') {
          llamadas['POST mesa_cuentas'] = (llamadas['POST mesa_cuentas'] ?? 0) + 1
          if (romperCuenta) return out(500, { message: 'db unavailable' })
          const b = body as J; const ks = Object.keys(b)
          const r = await db.query(`insert into mesa_cuentas(${ks.map(k => `"${k}"`).join(',')}) values(${ks.map((_, i) => `$${i + 1}`).join(',')}) returning *`, ks.map(k => b[k]))
          return obj ? out(201, r.rows[0]) : out(201, r.rows)
        }
        if (t === 'mesa_cuentas' && req.method === 'PATCH') {
          llamadas['PATCH mesa_cuentas'] = (llamadas['PATCH mesa_cuentas'] ?? 0) + 1
          const f = filtros(url); const b = body as J; const ks = Object.keys(b)
          const r = await db.query(`update mesa_cuentas set ${ks.map((k, i) => `"${k}" = $${f.vals.length + i + 1}`).join(', ')}${f.where} returning *`, [...f.vals, ...ks.map(k => b[k])])
          return String(req.headers.prefer ?? '').includes('return=representation') ? out(200, r.rows) : out(204, undefined)
        }
        if (t === 'mesa_cuentas' && req.method === 'DELETE') {
          llamadas['DELETE mesa_cuentas'] = (llamadas['DELETE mesa_cuentas'] ?? 0) + 1
          const f = filtros(url)
          if (hookDelete) await hookDelete()
          if (deleteFalso) return out(200, deleteFalso === 'cero' ? [] : [{ id: 'x' }, { id: 'y' }])
          try {
            const r = await db.query(`delete from mesa_cuentas${f.where} returning *`, f.vals)
            return String(req.headers.prefer ?? '').includes('return=representation') ? out(200, r.rows) : out(204, undefined)
          } catch (e) { const er = e as pg.DatabaseError; return out(409, { message: er.message, code: er.code }) }
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

let POST: (r: Request) => Promise<Response>
before(async () => {
  admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect()
  await admin.query(`drop database if exists ${DB} with (force)`); await admin.query(`create database ${DB}`)
  db = new pg.Pool({ ...SOCK, database: DB, max: 20 }); db.on('error', () => {})
  await db.query(readFileSync(join(SUP, 'tests/stock-v2/00-schema-reducido.sql'), 'utf8'))
  await db.query(`create table empresa_config (empresa_id uuid primary key, primary_color text); alter table pedidos add column hora_retiro timestamptz, add column visitante_id text;
    create table mesa_cuentas (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null, numero_mesa integer not null, nombre_cliente text, estado text not null default 'abierta', created_at timestamptz not null default clock_timestamp(), closed_at timestamptz)`)
  await db.query('alter table pedidos add constraint pedidos_mesa_cuenta_id_fkey foreign key (mesa_cuenta_id) references mesa_cuentas(id)')   // igual que producción: la base impide borrar una cuenta con pedidos
  for (const f of ['stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql', 'pedidos-duplicados-bloqueo.sql']) await db.query(readFileSync(join(SUP, f), 'utf8'))
  const port = await arrancarShim()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  POST = (await import('../../app/api/pedidos/route')).POST as typeof POST
})
after(async () => { server?.close(); await db?.end(); await admin?.query(`drop database if exists ${DB} with (force)`); await admin?.end() })

async function mundo(stk = 50) {
  const one = async (sql: string, ...a: unknown[]) => (await db.query(sql, a)).rows[0].id as string
  w.emp = await one('insert into empresas default values returning id'); w.suc = await one('insert into sucursales(empresa_id) values($1) returning id', w.emp)
  await db.query('insert into catalogo_version(sucursal_id, empresa_id) values($1,$2)', [w.suc, w.emp]); await db.query('insert into empresa_config(empresa_id) values($1)', [w.emp])
  w.prod = await one("insert into productos(empresa_id,nombre,controla_stock) values($1,'Alfajor',true) returning id", w.emp)
  w.pres = await one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values($1,$2,'Unidad',1000,1) returning id", w.emp, w.prod)
  await db.query('insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values($1,$2,$3,$4)', [w.emp, w.prod, w.suc, stk])
}
const stock = async () => Number((await db.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [w.prod, w.suc])).rows[0].cantidad)
const npedidos = async () => Number((await db.query('select count(*) from pedidos where empresa_id=$1', [w.emp])).rows[0].count)
const cuentas = async () => (await db.query('select id, numero_mesa, estado, closed_at from mesa_cuentas where empresa_id=$1 order by created_at', [w.emp])).rows as { id: string; numero_mesa: number; estado: string; closed_at: string | null }[]
const operaciones = async () => Number((await db.query('select count(*) from pedido_operaciones where empresa_id=$1', [w.emp])).rows[0].count)
const item = (extra: J = {}): J => ({ presentacion_id: w.pres, nombre_producto_snap: 'a', nombre_presentacion_snap: 'u', precio_snap: 1000, cantidad: 1, opciones: [], ...extra })
const pedirMesa = (extra: J = {}) => POST(new Request('http://x/api/pedidos', { method: 'POST', body: JSON.stringify({
  empresa_id: w.emp, sucursal_id: w.suc, metodo_pago: 'efectivo', origen: 'MESA', tipo_pedido: 'mesa', numero_mesa: 7, nombre_cliente: 'Ana',
  items: [item()], operacion_id: crypto.randomUUID(), ...extra }) }))
type Resp = { pedido?: { id: string; numero_pedido: number }; reutilizado?: boolean; error?: string; codigo?: string }
const j = async (r: Response) => (await r.json()) as Resp
const base = () => ({ post: llamadas['POST mesa_cuentas'] ?? 0, patch: llamadas['PATCH mesa_cuentas'] ?? 0, rpc: llamadas['crear_pedido_stock'] ?? 0 })
const sinEfectosEn = (b: ReturnType<typeof base>) => { assert.equal(llamadas['POST mesa_cuentas'] ?? 0, b.post, 'no insertó cuenta'); assert.equal(llamadas['PATCH mesa_cuentas'] ?? 0, b.patch, 'no cerró cuenta'); assert.equal(llamadas['crear_pedido_stock'] ?? 0, b.rpc, 'no llamó a la RPC') }
const hayCuentaAbiertaConPedidoPagado = async () => { // estado previo: cuenta A abierta, con un pedido YA PAGADO
  const r = await j(await pedirMesa()); assert.ok(r.pedido, 'setup: el primer pedido de mesa se crea')
  await db.query('update pedidos set pagado = true where id = $1', [r.pedido!.id])
  const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].estado, 'abierta'); return cs[0].id
}

describe('MESA — orden de efectos en la ruta real (CTO 17/11)', () => {
  beforeEach(async () => { romperCuenta = false; hookRpc = null; errorRpc = null; hookDelete = null; deleteFalso = null; for (const k of Object.keys(llamadas)) delete llamadas[k]; FIXTURES.stock_sabor = []; FIXTURES.promociones = []; FIXTURES.promo_slots = []; FIXTURES.presentaciones = []; FIXTURES.opciones = []; await mundo(50) })

  test('M1) camino feliz: primer pedido abre cuenta, descuenta stock y queda enlazado a la cuenta', async () => {
    const r = await j(await pedirMesa()); assert.ok(r.pedido)
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].estado, 'abierta')
    assert.equal((await db.query('select mesa_cuenta_id from pedidos where id=$1', [r.pedido!.id])).rows[0].mesa_cuenta_id, cs[0].id)
    assert.equal(await stock(), 49)
  })

  test('M2) cuenta con pedido PENDIENTE (no pagado): el nuevo pedido se SUMA a la misma cuenta (no abre otra)', async () => {
    await j(await pedirMesa()); const r2 = await j(await pedirMesa()); assert.ok(r2.pedido)
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].estado, 'abierta')
    assert.equal(Number((await db.query('select count(*) from pedidos where mesa_cuenta_id=$1', [cs[0].id])).rows[0].count), 2)
  })

  test('M3) cuenta anterior con todo pagado: un pedido VÁLIDO la cierra y abre una nueva (comportamiento original intacto)', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); const r = await j(await pedirMesa()); assert.ok(r.pedido)
    const cs = await cuentas(); assert.equal(cs.length, 2)
    assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada'); assert.ok(cs[0].closed_at)
    assert.equal(cs[1].estado, 'abierta'); assert.equal((await db.query('select mesa_cuenta_id from pedidos where id=$1', [r.pedido!.id])).rows[0].mesa_cuenta_id, cs[1].id)
  })

  test('M4) SABOR AGOTADO: 409 y SIN efectos — no abre cuenta, no cierra la anterior, no reclama operación, no toca stock', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); const op0 = await operaciones(); const s0 = await stock(); const p0 = await npedidos(); const b0 = base()
    FIXTURES.stock_sabor = [{ opcion_id: 'o1', kg: 0 }]
    const res = await pedirMesa({ items: [item({ opciones: [{ opcion_id: 'o1', nombre_snap: 'Frutilla' }] })] })
    assert.equal(res.status, 409); assert.equal((await j(res)).codigo, 'SABOR_AGOTADO')
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'abierta'); assert.equal(cs[0].closed_at, null)
    assert.equal(await operaciones(), op0); assert.equal(await stock(), s0); assert.equal(await npedidos(), p0)
    sinEfectosEn(b0)
  })

  test('M5) SABOR AGOTADO en mesa SIN cuenta previa: no queda ninguna cuenta vacía', async () => {
    FIXTURES.stock_sabor = [{ opcion_id: 'o1', kg: 0 }]
    const res = await pedirMesa({ items: [item({ opciones: [{ opcion_id: 'o1', nombre_snap: 'Frutilla' }] })] }); assert.equal(res.status, 409)
    assert.equal((await cuentas()).length, 0); assert.equal(await operaciones(), 0)
  })

  test('M6) PROMO FUERA DE VIGENCIA: 409 y SIN efectos sobre la cuenta ni el reclamo', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); const op0 = await operaciones(); const b0 = base()
    FIXTURES.promociones = [{ id: 'pr1', nombre: 'Vencida', precio: 900, activo: true, vigencia_desde: '2000-01-01', vigencia_hasta: '2000-01-02', hora_desde: null, hora_hasta: null, gracia_cierre_min: 5 }]
    FIXTURES.promo_slots = [{ id: 'sl1', orden: 1 }]; FIXTURES.presentaciones = [{ id: w.pres, precio: 1000 }]
    const res = await pedirMesa({ items: [item({ combo_ref: 'c1', promo_id: 'pr1', promo_slot_id: 'sl1' })] })
    assert.equal(res.status, 409); assert.equal((await j(res)).codigo, 'PROMO_FUERA_DE_VIGENCIA')
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'abierta')
    assert.equal(await operaciones(), op0); sinEfectosEn(b0)
  })

  test('M7) PROMO INVÁLIDA (no existe): 400 y SIN efectos sobre la cuenta', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); const b0 = base()
    FIXTURES.promociones = []; FIXTURES.promo_slots = []; FIXTURES.presentaciones = [{ id: w.pres, precio: 1000 }]
    const res = await pedirMesa({ items: [item({ combo_ref: 'c1', promo_id: 'prX', promo_slot_id: 'slX' })] })
    assert.equal(res.status, 400); assert.equal((await j(res)).error, 'Promoción inválida')
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'abierta'); sinEfectosEn(b0)
  })

  test('M8) NÚMERO DE MESA faltante: 400, sin reclamo y sin cuenta', async () => {
    for (const n of [undefined, 0, -1]) { const res = await pedirMesa({ numero_mesa: n }); assert.equal(res.status, 400); assert.equal((await j(res)).error, 'Falta el número de mesa') }
    assert.equal((await cuentas()).length, 0); assert.equal(await operaciones(), 0); assert.equal(llamadas['reclamar_operacion_pedido'] ?? 0, 0)
  })

  test('M9) RECLAMO EXISTENTE (reintento con la MISMA operacion_id): devuelve el pedido original y NO toca la cuenta', async () => {
    const op = crypto.randomUUID(); const r1 = await j(await pedirMesa({ operacion_id: op })); assert.ok(r1.pedido)
    const antes = await cuentas(); const p0 = await npedidos(); const s0 = await stock(); const b0 = base()
    const r2 = await j(await pedirMesa({ operacion_id: op })); assert.equal(r2.pedido?.id, r1.pedido!.id)
    assert.deepEqual(await cuentas(), antes); assert.equal(await npedidos(), p0); assert.equal(await stock(), s0)
    sinEfectosEn(b0)
  })

  test('M10) OPERACIÓN INVÁLIDA POR CONTENIDO (misma operacion_id, otro carrito): 409 «Tu pedido cambió» y SIN tocar la cuenta', async () => {
    const op = crypto.randomUUID(); const r1 = await j(await pedirMesa({ operacion_id: op })); assert.ok(r1.pedido)
    const antes = await cuentas(); const p0 = await npedidos(); const s0 = await stock(); const b0 = base()
    const res = await pedirMesa({ operacion_id: op, items: [item({ cantidad: 3 })] }); assert.equal(res.status, 409); assert.equal((await j(res)).error, 'Tu pedido cambió. Revisalo y volvé a confirmar.')
    assert.deepEqual(await cuentas(), antes); assert.equal(await npedidos(), p0); assert.equal(await stock(), s0); sinEfectosEn(b0)
  })

  test('M11) OPERACIÓN INVÁLIDA (operacion_id que no es UUID): rechazo sin cuenta', async () => {
    const res = await pedirMesa({ operacion_id: 'no-es-uuid' }); assert.ok(res.status >= 400)
    assert.equal((await cuentas()).length, 0); assert.equal(llamadas['POST mesa_cuentas'] ?? 0, 0); assert.equal(await npedidos(), 0)
  })

  test('M12) FALLA EL ALTA DE LA CUENTA: 500, el reclamo se LIBERA (no queda EN_CURSO) y el reintento con la misma operacion_id funciona', async () => {
    const op = crypto.randomUUID(); romperCuenta = true
    const res = await pedirMesa({ operacion_id: op }); assert.equal(res.status, 500); assert.equal((await j(res)).error, 'No se pudo abrir la cuenta de la mesa')
    assert.equal(await operaciones(), 0, 'el reclamo quedó liberado'); assert.equal(await npedidos(), 0); assert.equal(await stock(), 50); assert.equal(llamadas['crear_pedido_stock'] ?? 0, 0)
    romperCuenta = false; const r2 = await j(await pedirMesa({ operacion_id: op })); assert.ok(r2.pedido, 'reintento exitoso con la misma operación'); assert.equal(await stock(), 49)
  })

  // ── M13 · COMPENSACIÓN (GO CTO 18/11) ──
  const sinStock = () => db.query('update producto_stock set cantidad = 0 where producto_id=$1', [w.prod])
  const pedidosDe = async (cuenta: string) => Number((await db.query('select count(*) from pedidos where mesa_cuenta_id=$1', [cuenta])).rows[0].count)

  test('C1) M13: cuenta anterior cerrada + cuenta nueva y la RPC rechaza por SIN_STOCK → se borra la nueva y la anterior PERMANECE CERRADA (sin UPDATE posterior); el reintento con la misma operación funciona', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); await sinStock(); const p0 = await npedidos(); const op0 = await operaciones(); const op = crypto.randomUUID()
    const res = await pedirMesa({ operacion_id: op }); assert.equal(res.status, 409)
    const cs = await cuentas(); assert.equal(cs.length, 1, 'no queda cuenta vacía'); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada', 'la anterior queda cerrada'); assert.ok(cs[0].closed_at)
    assert.equal(llamadas['PATCH mesa_cuentas'], 1, 'el único UPDATE es el cierre original: nada la reabre'); assert.equal(llamadas['DELETE mesa_cuentas'], 1)
    assert.equal(await npedidos(), p0); assert.equal(await stock(), 0); assert.equal(await operaciones(), op0, 'la operación quedó liberada (solo queda la del primer pedido)')
    await db.query('update producto_stock set cantidad = 50 where producto_id=$1', [w.prod])
    const r2 = await j(await pedirMesa({ operacion_id: op })); assert.ok(r2.pedido, 'el reintento con la misma operación crea el pedido')
    const c2 = await cuentas(); assert.equal(c2.length, 2); assert.equal(c2[0].estado, 'cerrada'); assert.equal(c2[1].estado, 'abierta'); assert.equal(await pedidosDe(c2[1].id), 1)
  })

  test('C2) M13: mesa SIN cuenta previa y la RPC rechaza por SIN_STOCK → la cuenta nueva vacía se elimina', async () => {
    await sinStock(); const res = await pedirMesa(); assert.equal(res.status, 409)
    assert.equal((await cuentas()).length, 0); assert.equal(await npedidos(), 0); assert.equal(llamadas['DELETE mesa_cuentas'], 1)
  })

  test('C3) M13: la cuenta nueva YA tiene un pedido (visible en la verificación previa) → NO se borra y la anterior sigue cerrada; la FK de la base lo impide igual', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); let nueva = ''
    hookRpc = async b => { nueva = String(b.p_mesa_cuenta_id); await db.query("insert into pedidos(empresa_id,sucursal_id,numero_pedido,fecha_pedido,mesa_cuenta_id,pagado) values($1,$2,99,current_date,$3,false)", [w.emp, w.suc, nueva]) }
    errorRpc = { code: 'P0001', message: 'SIN_STOCK: Alfajor' }
    const res = await pedirMesa(); assert.equal(res.status, 409)
    const cs = await cuentas(); assert.equal(cs.length, 2); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada', 'la anterior sigue cerrada'); assert.equal(cs[1].id, nueva); assert.equal(await pedidosDe(nueva), 1)
    assert.equal(llamadas['DELETE mesa_cuentas'] ?? 0, 0, 'ni siquiera intentó borrar')
    await assert.rejects(db.query('delete from mesa_cuentas where id=$1', [nueva]), (e: pg.DatabaseError) => e.code === '23503')   // garantía de la base
  })

  test('C4a) M13: la cuenta anterior fue modificada por otro después del cierre → se borra la nueva y la anterior no se toca (conserva el closed_at ajeno)', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); await sinStock(); let ajeno = ''
    hookRpc = async () => { ajeno = (await db.query("update mesa_cuentas set closed_at = closed_at + interval '1 second' where id=$1 returning closed_at::text as c", [a])).rows[0].c }
    const res = await pedirMesa(); assert.equal(res.status, 409)
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada')
    assert.equal((await db.query('select closed_at::text as c from mesa_cuentas where id=$1', [a])).rows[0].c, ajeno, 'la ruta no escribió sobre la cuenta anterior'); assert.equal(llamadas['PATCH mesa_cuentas'], 1)
  })

  test('C4b) M13: otra operación concurrente ya abrió una cuenta para la mesa → se borra solo la propia; la anterior sigue cerrada y la ajena queda intacta', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); await sinStock(); let ajena = ''
    hookRpc = async () => { ajena = (await db.query("insert into mesa_cuentas(empresa_id,sucursal_id,numero_mesa) values($1,$2,7) returning id", [w.emp, w.suc])).rows[0].id }
    const res = await pedirMesa(); assert.equal(res.status, 409)
    const cs = await cuentas(); assert.equal(cs.length, 2); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada'); assert.equal(cs[1].id, ajena); assert.equal(cs[1].estado, 'abierta')
  })

  test('C5) M13: resultado AMBIGUO (corte de transporte, timeout 57014, 23505) → 503/500, NO se compensa y se conserva la operación', async () => {
    for (const err of [{ message: 'fetch failed' }, { code: '57014', message: 'canceling statement due to statement timeout' }, { code: '23505', message: 'duplicate key' }]) {
      await db.query('delete from pedido_operaciones where empresa_id=$1', [w.emp]); await db.query('delete from mesa_cuentas where empresa_id=$1', [w.emp])
      errorRpc = null; hookRpc = null; const a = await hayCuentaAbiertaConPedidoPagado(); errorRpc = err
      const res = await pedirMesa(); assert.ok(res.status === 503 || res.status === 500, JSON.stringify(err))
      const cs = await cuentas(); assert.equal(cs.length, 2, 'se conserva el estado: ' + JSON.stringify(err)); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada'); assert.equal(cs[1].estado, 'abierta')
      assert.equal(llamadas['DELETE mesa_cuentas'] ?? 0, 0); await db.query('delete from pedidos where mesa_cuenta_id is not null and empresa_id=$1', [w.emp]); for (const k of Object.keys(llamadas)) delete llamadas[k]
    }
  })

  test('C6) M13: RPC exitosa → se conserva la cuenta nueva con su pedido y la anterior queda cerrada (nada se compensa)', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); const r = await j(await pedirMesa()); assert.ok(r.pedido)
    const cs = await cuentas(); assert.equal(cs.length, 2); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada'); assert.equal(cs[1].estado, 'abierta'); assert.equal(await pedidosDe(cs[1].id), 1)
    assert.equal(llamadas['DELETE mesa_cuentas'] ?? 0, 0)
  })

  test('C7) M13: PRECIO_INVALIDO real de la RPC → 409 «precios» y las cuentas quedan restauradas', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); const res = await pedirMesa({ items: [item({ precio_snap: 1 })] }); assert.equal(res.status, 409)
    assert.equal((await j(res)).error, 'Los precios se actualizaron. Revisá tu pedido.')
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada'); assert.ok(cs[0].closed_at)
  })

  test('C8) M13: deadlock 40P01 (rollback demostrado) sí compensa; un P0001 con nombre FUERA de la lista demostrada no compensa', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); errorRpc = { code: '40P01', message: 'deadlock detected' }
    assert.ok((await pedirMesa()).status >= 400); let cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada', 'cuenta nueva eliminada; la anterior queda cerrada')
    errorRpc = { code: 'P0001', message: 'CANTIDAD_INVALIDA' }; for (const k of Object.keys(llamadas)) delete llamadas[k]
    assert.equal((await pedirMesa()).status, 409); cs = await cuentas(); assert.equal(cs.length, 2, 'CANTIDAD_INVALIDA no está en la lista demostrada: se preserva'); assert.equal(cs[0].estado, 'cerrada'); assert.equal(llamadas['DELETE mesa_cuentas'] ?? 0, 0)
  })

  test('C9) M13: el pedido SUMA a una cuenta existente con pendiente y la RPC rechaza → no se inserta, cierra ni borra ninguna cuenta', async () => {
    const r0 = await j(await pedirMesa()); assert.ok(r0.pedido); const antes = await cuentas(); await sinStock(); for (const k of Object.keys(llamadas)) delete llamadas[k]
    const res = await pedirMesa(); assert.equal(res.status, 409)
    const despues = await cuentas(); assert.deepEqual(despues, antes); assert.equal(llamadas['POST mesa_cuentas'] ?? 0, 0); assert.equal(llamadas['PATCH mesa_cuentas'] ?? 0, 0); assert.equal(llamadas['DELETE mesa_cuentas'] ?? 0, 0)
  })

  test('C10) M13: no se afectan cuentas de OTRAS mesas ni de otras sucursales', async () => {
    const otraMesa = (await db.query("insert into mesa_cuentas(empresa_id,sucursal_id,numero_mesa) values($1,$2,8) returning id", [w.emp, w.suc])).rows[0].id as string
    await sinStock(); assert.equal((await pedirMesa()).status, 409)
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(cs[0].id, otraMesa); assert.equal(cs[0].estado, 'abierta'); assert.equal(cs[0].numero_mesa, 8)
  })

  test('C11) M13: aparece un pedido que referencia la cuenta nueva ENTRE la lectura previa y el DELETE → la FK impide el borrado; se preserva todo y no se toca la cuenta anterior', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); await sinStock()
    errorRpc = { code: 'P0001', message: 'SIN_STOCK: Alfajor' }
    hookDelete = async () => { const nueva = (await cuentas()).find(c => c.id !== a)!.id; await db.query("insert into pedidos(empresa_id,sucursal_id,numero_pedido,fecha_pedido,mesa_cuenta_id,pagado) values($1,$2,98,current_date,$3,false)", [w.emp, w.suc, nueva]) }
    const res = await pedirMesa(); assert.equal(res.status, 409, 'la respuesta es la del rechazo original')
    const cs = await cuentas(); assert.equal(cs.length, 2, 'la cuenta nueva sobrevive (tiene pedido)'); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada', 'la anterior queda cerrada, sin reabrir')
    assert.equal(cs[1].estado, 'abierta'); assert.equal(await pedidosDe(cs[1].id), 1)
    assert.equal(llamadas['DELETE mesa_cuentas'], 1, 'intentó el DELETE una sola vez'); assert.equal(llamadas['PATCH mesa_cuentas'], 1, 'ningún UPDATE posterior sobre la cuenta anterior')
  })

  test('C12) M13: el DELETE responde SIN error pero con CERO filas → no se considera borrada, se registra y se detiene sin más cambios', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); await sinStock(); errorRpc = { code: 'P0001', message: 'SIN_STOCK: Alfajor' }; deleteFalso = 'cero'; const post0 = llamadas['POST mesa_cuentas']
    const res = await pedirMesa(); assert.equal(res.status, 409)
    const cs = await cuentas(); assert.equal(cs.length, 2); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada'); assert.equal(cs[1].estado, 'abierta')
    assert.equal(llamadas['DELETE mesa_cuentas'], 1); assert.equal(llamadas['PATCH mesa_cuentas'], 1); assert.equal(llamadas['POST mesa_cuentas'], post0 + 1, 'solo el alta original, nada más')
  })

  test('C13) M13: el DELETE responde con MÁS de una fila → tampoco se considera exitoso (se registra y se detiene)', async () => {
    const a = await hayCuentaAbiertaConPedidoPagado(); await sinStock(); errorRpc = { code: 'P0001', message: 'SIN_STOCK: Alfajor' }; deleteFalso = 'dos'
    const res = await pedirMesa(); assert.equal(res.status, 409)
    const cs = await cuentas(); assert.equal(cs.length, 2); assert.equal(cs[0].id, a); assert.equal(cs[0].estado, 'cerrada'); assert.equal(llamadas['PATCH mesa_cuentas'], 1)
  })

  test('C14) M13: ORDEN — durante la compensación la operación sigue EN_CURSO y un segundo envío de la misma operacion_id NO avanza; recién después se libera y el reintento funciona', async () => {
    const op = crypto.randomUUID(); errorRpc = { code: 'P0001', message: 'SIN_STOCK: Alfajor' }
    let durante: { estado: string | null; filas: number } | null = null; let segundo: { status: number; enProceso: unknown; rpc: number; cuentas: number } | null = null
    hookDelete = async () => {   // se ejecuta DENTRO de la compensación, justo antes del DELETE de la cuenta nueva
      const f = (await db.query('select estado from pedido_operaciones where operacion_id=$1', [op])).rows as { estado: string }[]
      durante = { estado: f[0]?.estado ?? null, filas: f.length }
      const rpc0 = llamadas['crear_pedido_stock'] ?? 0; const hook = hookDelete; hookDelete = null; const err = errorRpc; errorRpc = null
      const r = await pedirMesa({ operacion_id: op }); const b = (await r.json()) as { en_proceso?: boolean }
      segundo = { status: r.status, enProceso: b.en_proceso, rpc: (llamadas['crear_pedido_stock'] ?? 0) - rpc0, cuentas: (await cuentas()).length }
      hookDelete = hook; errorRpc = err
    }
    const res = await pedirMesa({ operacion_id: op }); assert.equal(res.status, 409, 'respuesta original del rechazo')
    assert.deepEqual(durante, { estado: 'EN_CURSO', filas: 1 }, 'mientras se compensa, la operación sigue reclamada')
    assert.deepEqual(segundo, { status: 409, enProceso: true, rpc: 0, cuentas: 1 }, 'el segundo reclamo recibe EN_PROCESO, no llega a la RPC y no toca cuentas')
    assert.equal((await cuentas()).length, 0, 'la cuenta nueva vacía fue eliminada')
    assert.equal(Number((await db.query('select count(*) from pedido_operaciones where operacion_id=$1', [op])).rows[0].count), 0, 'después de compensar, la operación queda liberada')
    hookDelete = null; errorRpc = null; const r2 = await j(await pedirMesa({ operacion_id: op })); assert.ok(r2.pedido, 'el reintento con la misma operación avanza')
    const cs = await cuentas(); assert.equal(cs.length, 1); assert.equal(await pedidosDe(cs[0].id), 1)
  })

  test('M14) otros canales (KIOSK): no consultan ni escriben mesa_cuentas', async () => {
    const res = await pedirMesa({ origen: 'KIOSK', tipo_pedido: 'kiosk', numero_mesa: undefined }); assert.equal(res.status, 200)
    assert.equal((await cuentas()).length, 0); assert.equal(llamadas['POST mesa_cuentas'] ?? 0, 0); assert.equal(llamadas['PATCH mesa_cuentas'] ?? 0, 0)
    assert.equal(await stock(), 49)
  })
})
