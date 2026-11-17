// MESA: ORDEN DE EFECTOS en la RUTA REAL /api/pedidos (CTO 17/11: «preservar fix y completar validaciones previas»).
// Qué prueba: que todo rechazo que NO depende de la RPC (número de mesa, sabor agotado, promo fuera de vigencia / inválida, reclamo de operación
// EXISTENTE / DUPLICADO / operación inválida) ocurre ANTES de tocar `mesa_cuentas` (no se abre cuenta vacía ni se cierra la cuenta anterior),
// que si falla el alta de la cuenta se LIBERA el reclamo, y deja documentado (sin ocultarlo) el límite conocido: rechazos de la propia RPC.
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
const llamadas: Record<string, number> = {}
type J = Record<string, unknown>
const w = { emp: '', suc: '', prod: '', pres: '' }

const REALES = new Set(['pedidos', 'pedido_items', 'pedido_item_opciones', 'mesa_cuentas'])
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
          await db.query(`update mesa_cuentas set ${ks.map((k, i) => `"${k}" = $${f.vals.length + i + 1}`).join(', ')}${f.where}`, [...f.vals, ...ks.map(k => b[k])])
          return out(204, undefined)
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
  beforeEach(async () => { romperCuenta = false; for (const k of Object.keys(llamadas)) delete llamadas[k]; FIXTURES.stock_sabor = []; FIXTURES.promociones = []; FIXTURES.promo_slots = []; FIXTURES.presentaciones = []; FIXTURES.opciones = []; await mundo(50) })

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

  test('M13) LÍMITE CONOCIDO (documentado, NO resuelto): rechazo de la RPC por SIN_STOCK ocurre DESPUÉS de resolver la cuenta', async () => {
    await db.query('update producto_stock set cantidad = 0 where producto_id=$1', [w.prod])
    const res = await pedirMesa(); assert.equal(res.status, 409)
    assert.equal(await npedidos(), 0); assert.equal(await stock(), 0)
    const cs = await cuentas()
    // Hoy queda una cuenta abierta VACÍA (sin pedidos). Es el residual que el informe al CTO explica; este test fija el comportamiento real, no lo oculta.
    assert.equal(cs.length, 1); assert.equal(Number((await db.query('select count(*) from pedidos where mesa_cuenta_id=$1', [cs[0].id])).rows[0].count), 0)
  })

  test('M14) otros canales (KIOSK): no consultan ni escriben mesa_cuentas', async () => {
    const res = await pedirMesa({ origen: 'KIOSK', tipo_pedido: 'kiosk', numero_mesa: undefined }); assert.equal(res.status, 200)
    assert.equal((await cuentas()).length, 0); assert.equal(llamadas['POST mesa_cuentas'] ?? 0, 0); assert.equal(llamadas['PATCH mesa_cuentas'] ?? 0, 0)
    assert.equal(await stock(), 49)
  })
})
