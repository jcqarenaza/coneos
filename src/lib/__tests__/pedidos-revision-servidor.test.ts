// POSIBLE DUPLICADO · revisión en Caja (CTO 14/11, GO condicionado): SERVIDOR por las RUTAS REALES contra POSTGRES LOCAL REAL.
// Rutas: /api/pedidos (ciclo completo: reclamo → pedido → revisión), /api/pedidos/estado (compuerta), /api/mp/webhook (compuerta + condición A),
// /api/operacion/consulta (pedidos_hoy con revisión, resolver, reembolso). SQL real: reclamar_operacion_pedido, crear_pedido_stock v1.7,
// devolver_stock_pedido, resolver_revision_duplicado, pedidos_en_revision. Entre las rutas y Postgres hay un shim HTTP que imita PostgREST
// (NO es PostgREST ni Supabase real: sin RLS ni auth). Mercado Pago, la Edge de facturación y la base de beneficios son dobles que CUENTAN llamadas.
// Dobles de SQL que NO existen en el repo: devolver_sabores_pedido (registra la llamada) y devolver_stock_pedido_caja (rama; solo contrato).
// Ejecutar: npx tsx --test src/lib/__tests__/pedidos-revision-servidor.test.ts   (necesita `npm i pg --no-save` y el cluster de supabase/tests/stock-v2/README.md)
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const SUP = join(process.cwd(), 'supabase')
const SOCK = { host: '/tmp/pgsock', port: 54329, user: 'postgres' }
const DB = 'rev_srv'
let admin: pg.Client, db: pg.Pool, server: http.Server
type J = Record<string, unknown>
const w = { emp: '', suc: '', suc2: '', prod: '', pres: '', disp: '', dispOtraSuc: '', dispNoCaja: '' }
const llamadas: Record<string, number> = {}                 // RPC y rutas especiales vistas por el shim
const contador = (k: string) => llamadas[k] ?? 0
let fallaRpc: Record<string, { status: number; code: string }> = {}   // RPC que responden error SIN ejecutarse
const pagosMP = new Map<string, { status: string; external_reference: string }>()
const llamadasMP: string[] = []                             // TODA llamada a api.mercadopago.com que no sea un GET de payment (p. ej. un reembolso): debe quedar vacía

// ── shim PostgREST mínimo sobre el Postgres real ──
const REALES = new Set(['pedidos', 'pedido_items', 'pedido_item_opciones', 'pedido_revisiones_duplicado', 'pedido_estados_log', 'dispositivos', 'mp_credenciales', 'facturacion_config', 'stock_movimientos'])
const FIXTURES: Record<string, J[]> = {
  sucursales: [{ activo: true, horario_general: null, mensaje_cerrado: null, tolerancia_cierre: 0, dias_apertura: null, horario_por_dia: null }],
  takeaway_config: [{ activo: true, horarios: [], tolerancia_cierre: 5, mensaje_fuera_horario: null, acepta_anticipado: false }],
}
function filtros(url: URL) {
  const conds: string[] = [], vals: unknown[] = []
  const una = (k: string, v: string): string | null => {
    const m = v.match(/^(not\.)?(eq|neq|is|in|gt|gte|lt|lte)\.(.*)$/); if (!m) return null
    const [, no, op, raw] = m; let c: string
    if (op === 'is') c = raw === 'null' ? `"${k}" is null` : `"${k}" is ${raw}`
    else if (op === 'in') { const ph = raw.slice(1, -1).split(',').map(x => { vals.push(x); return `$${vals.length}` }); c = `"${k}"::text in (${ph.join(',')})` }
    else { vals.push(raw); c = `"${k}"::text ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} $${vals.length}` }
    return no ? `not (${c})` : c
  }
  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue
    if (k === 'or') {
      if (v.includes('and(')) continue                       // el filtro de fecha de pedidos_hoy (fecha_pedido): el shim no lo evalúa
      const partes = v.slice(1, -1).split(',').map(p => { const [col, ...resto] = p.split('.'); return una(col, resto.join('.')) }).filter(Boolean)
      if (partes.length) conds.push(`(${partes.join(' or ')})`)
      continue
    }
    const c = una(k, v); if (c) conds.push(c)
  }
  return { where: conds.length ? ' where ' + conds.join(' and ') : '', vals }
}
const jsonVal = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v)
async function adjuntarItems(filas: J[], select: string) {
  if (!select.includes('pedido_items(')) return filas
  for (const f of filas) {
    const its = (await db.query('select * from pedido_items where pedido_id=$1 order by id', [f.id])).rows
    for (const it of its) it.pedido_item_opciones = (await db.query('select nombre_snap, emoji_snap from pedido_item_opciones where pedido_item_id=$1', [it.id])).rows
    f.pedido_items = its
  }
  return filas
}
function arrancarShim(): Promise<number> {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', async () => {
      const url = new URL(req.url!, 'http://x'); const body = raw ? JSON.parse(raw) : undefined
      const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      const pideRep = String(req.headers.prefer ?? '').includes('return=representation')
      const pideCount = String(req.headers.prefer ?? '').includes('count=exact')
      const out = (st: number, d: unknown, h: Record<string, string> = {}) => { res.writeHead(st, { 'content-type': 'application/json', ...h }); res.end(d === undefined ? '' : JSON.stringify(d)) }
      try {
        if (url.pathname === '/functions/v1/arca-facturar') { llamadas['edge:facturar'] = contador('edge:facturar') + 1; return out(200, { ok: true, cae: '1', nro_cbte: 1 }) }
        const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
        if (rpc) {
          llamadas[rpc[1]] = contador(rpc[1]) + 1
          if (fallaRpc[rpc[1]]) { const f = fallaRpc[rpc[1]]; return out(f.status, { message: 'falla simulada', code: f.code }) }
          const ks = Object.keys(body ?? {})
          const esJson = (v: unknown) => typeof v === 'object' && v !== null && !(Array.isArray(v) && v.every(x => typeof x === 'string'))
          const vals = ks.map(k => esJson(body[k]) ? JSON.stringify(body[k]) : body[k])
          const llamada = `${rpc[1]}(${ks.map((k, i) => `${k} := $${i + 1}${esJson(body[k]) ? '::jsonb' : ''}`).join(', ')})`
          try {
            // PostgREST devuelve una funcion que retorna TABLA como arreglo de objetos JSON (no como compuesto): se imita
            const esTabla = (await db.query('select bool_or(proretset) as t from pg_proc where proname=$1', [rpc[1]])).rows[0].t === true
            if (esTabla) { const r = await db.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from ${llamada} t`, vals); return out(200, r.rows[0].r) }
            const r = await db.query(`select ${llamada} as r`, vals); return out(200, r.rows[0].r ?? null)
          }
          catch (e) { const er = e as { code?: string; message?: string }; return out(400, { message: er.message, code: er.code }) }
        }
        const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]
        if (!t) return out(200, [])
        llamadas[`tabla:${t}`] = contador(`tabla:${t}`) + 1
        const sel = String(url.searchParams.get('select') ?? '*')
        const real = REALES.has(t) || (t === 'empresa_config' && sel.includes('bloquear_pedidos_duplicados'))
        if (req.method === 'GET' || req.method === 'HEAD') {
          let filas: J[] = []
          if (real) {
            const f = filtros(url); const ord = url.searchParams.get('order'); const lim = url.searchParams.get('limit')
            const orden = ord ? ' order by ' + ord.split(',').map(o => { const [c, d] = o.split('.'); return `"${c}" ${d === 'desc' ? 'desc' : 'asc'}` }).join(', ') : ''
            filas = (await db.query(`select * from ${t}${f.where}${orden}${lim ? ` limit ${Number(lim)}` : ''}`, f.vals)).rows
            filas = await adjuntarItems(filas, sel)
          } else filas = FIXTURES[t] ?? []
          const cr = { 'content-range': `*/${filas.length}` }
          if (req.method === 'HEAD') { res.writeHead(200, cr); return res.end() }
          if (obj) return filas[0] ? out(200, filas[0]) : out(406, { code: 'PGRST116', message: 'no rows' })
          return out(200, filas, pideCount ? cr : {})
        }
        if (!real) return out(200, [])
        if (req.method === 'DELETE') { const f = filtros(url); await db.query(`delete from ${t}${f.where}`, f.vals); return out(204, undefined) }
        if (req.method === 'PATCH') {
          const f = filtros(url); const ks = Object.keys(body as J); const vals = [...f.vals]
          // los marcadores del WHERE ya usan $1..$n: los del SET siguen después
          const set = ks.map(k => { vals.push(jsonVal((body as J)[k])); return `"${k}" = $${vals.length}` }).join(', ')
          const r = await db.query(`update ${t} set ${set}${f.where} returning *`, vals)
          return pideRep ? out(200, r.rows) : out(204, undefined)
        }
        if (req.method === 'POST') {
          const filasIn = (Array.isArray(body) ? body : [body]) as J[]; const salida: J[] = []
          for (const fi of filasIn) {
            const ks = Object.keys(fi); const r = await db.query(`insert into ${t} (${ks.map(k => `"${k}"`).join(',')}) values (${ks.map((_, i) => `$${i + 1}`).join(',')}) returning *`, ks.map(k => jsonVal(fi[k])))
            salida.push(r.rows[0])
          }
          return pideRep ? out(201, salida) : out(201, undefined)
        }
        out(200, [])
      } catch (e) { console.error('shim', e); out(500, { message: String(e) }) }
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
}

let POST: (r: Request) => Promise<Response>, ESTADO: (r: Request) => Promise<Response>, WEBHOOK: (r: Request) => Promise<Response>, CONSULTA: (r: Request) => Promise<Response>
const fetchReal = globalThis.fetch
before(async () => {
  admin = new pg.Client({ ...SOCK, database: 'postgres' }); await admin.connect()
  await admin.query(`drop database if exists ${DB} with (force)`); await admin.query(`create database ${DB}`)
  db = new pg.Pool({ ...SOCK, database: DB, max: 30 }); db.on('error', () => {})
  await db.query(readFileSync(join(SUP, 'tests/stock-v2/00-schema-reducido.sql'), 'utf8'))
  await db.query(`
    create table empresa_config (empresa_id uuid primary key, primary_color text);
    alter table pedidos add column hora_retiro timestamptz, add column visitante_id text, add column mp_payment_id text, add column notas text,
      add column updated_at timestamptz default now(), add column mp_credencial_id uuid, add column descuento_cobro numeric, add column receptor_doc_tipo int,
      add column receptor_doc_nro text, add column receptor_cond_iva int, add column transferencia_cuenta_id uuid, add column created_at timestamptz default now();
    alter table stock_movimientos add column rama_id uuid;
    create table pedido_estados_log (id uuid primary key default gen_random_uuid(), pedido_id uuid, operador_id uuid, estado_anterior text, estado_nuevo text, created_at timestamptz default now());
    create table dispositivos (id uuid primary key default gen_random_uuid(), empresa_id uuid, sucursal_id uuid, tipo text, activo boolean default true);
    create table mp_credenciales (id uuid primary key default gen_random_uuid(), empresa_id uuid, sucursal_id uuid, access_token text, updated_at timestamptz default now());
    create table facturacion_config (id uuid primary key default gen_random_uuid(), empresa_id uuid, sucursal_id uuid, es_fallback boolean default true, activo boolean, auto_facturar boolean, metodos_auto jsonb, cert_pem text, key_pem text, estado text);
    -- dobles de funciones que NO están en el repo (ver cabecera)
    create table sabores_llamadas (pedido uuid); create table sabores_falla (on_ boolean);
    create function devolver_sabores_pedido(p_empresa uuid, p_pedido uuid) returns void language plpgsql as $f$
      begin if exists (select 1 from sabores_falla where on_) then raise exception 'falla simulada de sabores'; end if; insert into sabores_llamadas values (p_pedido); end $f$;
    create table caja_llamadas (pedido uuid, dispositivo uuid);
    create function devolver_stock_pedido_caja(p_empresa uuid, p_pedido uuid, p_dispositivo uuid) returns jsonb language plpgsql as $f$
      begin insert into caja_llamadas values (p_pedido, p_dispositivo); return '{"estado":"devuelto"}'::jsonb; end $f$;`)
  for (const f of ['stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql', 'pedidos-duplicados-bloqueo.sql']) await db.query(readFileSync(join(SUP, f), 'utf8'))
  const port = await arrancarShim()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  // Mercado Pago es un doble: GET payment responde lo configurado; CUALQUIER otra llamada a MP (p. ej. un reembolso) queda registrada y debe ser vacía
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (u.startsWith('https://api.mercadopago.com')) {
      const m = u.match(/\/v1\/payments\/(\d+)$/); const metodo = (init?.method ?? 'GET').toUpperCase()
      if (m && metodo === 'GET') { const p = pagosMP.get(m[1]); return p ? new Response(JSON.stringify(p), { status: 200 }) : new Response('{}', { status: 404 }) }
      llamadasMP.push(`${metodo} ${u}`); return new Response('{}', { status: 200 })
    }
    return fetchReal(input as never, init)
  }) as typeof fetch
  POST = (await import('../../app/api/pedidos/route')).POST as typeof POST
  ESTADO = (await import('../../app/api/pedidos/estado/route')).POST as typeof ESTADO
  WEBHOOK = (await import('../../app/api/mp/webhook/route')).POST as typeof WEBHOOK
  CONSULTA = (await import('../../app/api/operacion/consulta/route')).POST as typeof CONSULTA
})
after(async () => { globalThis.fetch = fetchReal; server?.close(); await db?.end(); await admin?.query(`drop database if exists ${DB} with (force)`); await admin?.end() })

async function mundo(stk = 50) {
  const one = async (sql: string, ...a: unknown[]) => (await db.query(sql, a)).rows[0].id as string
  w.emp = await one('insert into empresas default values returning id'); w.suc = await one('insert into sucursales(empresa_id) values($1) returning id', w.emp); w.suc2 = await one('insert into sucursales(empresa_id) values($1) returning id', w.emp)
  await db.query('insert into catalogo_version(sucursal_id, empresa_id) values($1,$3),($2,$3)', [w.suc, w.suc2, w.emp])
  await db.query('insert into empresa_config(empresa_id, primary_color) values($1,null)', [w.emp]); await db.query('alter table empresa_config add column if not exists bloquear_pedidos_duplicados boolean')   // (ya existe tras el SQL; no-op)
  await db.query('update empresa_config set bloquear_pedidos_duplicados=true where empresa_id=$1', [w.emp])
  w.prod = await one("insert into productos(empresa_id,nombre,controla_stock) values($1,'Alfajor',true) returning id", w.emp)
  w.pres = await one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values($1,$2,'Unidad',1000,1) returning id", w.emp, w.prod)
  for (const s of [w.suc, w.suc2]) await db.query('insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values($1,$2,$3,$4)', [w.emp, w.prod, s, stk])
  w.disp = await one("insert into dispositivos(empresa_id,sucursal_id,tipo,activo) values($1,$2,'CAJA',true) returning id", w.emp, w.suc)
  w.dispOtraSuc = await one("insert into dispositivos(empresa_id,sucursal_id,tipo,activo) values($1,$2,'CAJA',true) returning id", w.emp, w.suc2)
  w.dispNoCaja = await one("insert into dispositivos(empresa_id,sucursal_id,tipo,activo) values($1,$2,'KIOSK',true) returning id", w.emp, w.suc)
  await db.query('delete from mp_credenciales'); await db.query("insert into mp_credenciales(empresa_id, access_token) values($1,'tok-prueba')", [w.emp])
  await db.query("insert into facturacion_config(empresa_id, activo, auto_facturar, metodos_auto, cert_pem, key_pem, estado) values($1,true,true,'[\"mp\",\"efectivo\",\"transferencia\"]'::jsonb,'c','k','validado')", [w.emp])
}
const stock = async (suc = w.suc) => Number((await db.query('select cantidad from producto_stock where producto_id=$1 and sucursal_id=$2', [w.prod, suc])).rows[0].cantidad)
const npedidos = async () => Number((await db.query('select count(*) from pedidos where empresa_id=$1', [w.emp])).rows[0].count)
const fila = async (id: string) => (await db.query('select * from pedidos where id=$1', [id])).rows[0]
const logDe = async (id: string) => (await db.query('select estado_anterior, estado_nuevo from pedido_estados_log where pedido_id=$1 order by created_at', [id])).rows
const revDe = async (pedido: string) => (await db.query('select r.* from pedido_revisiones_duplicado r join pedidos p on p.operacion_id=r.operacion_id and p.empresa_id=r.empresa_id where p.id=$1', [pedido])).rows[0]
const sabores = async () => Number((await db.query('select count(*) from sabores_llamadas')).rows[0].count)
let seq = 0
const tel = () => `23${String(++seq).padStart(8, '0')}`
const pedir = (tel_: string, vis: string, cant: number, extra: J = {}) => POST(new Request('http://x/api/pedidos', { method: 'POST', body: JSON.stringify({
  empresa_id: w.emp, sucursal_id: w.suc, metodo_pago: 'efectivo', tipo_pedido: 'delivery', origen: 'DELIVERY', visitante_id: vis, dispositivo_id: crypto.randomUUID(),
  datos_delivery: { telefono: tel_, nombre: 'Sandra' },
  items: [{ presentacion_id: w.pres, nombre_producto_snap: 'Alfajor', nombre_presentacion_snap: 'Unidad', precio_snap: 1000, cantidad: cant, opciones: [] }],
  operacion_id: crypto.randomUUID(), ...extra }) }))
type Resp = { pedido?: { id: string; numero_pedido: number }; error?: string; bloqueo?: J }
const j = async (r: Response) => (await r.json()) as Resp
/** Primer pedido del teléfono (sin aviso). */
async function primero(t: string, vis: string, cant: number) { const r = await pedir(t, vis, cant); assert.equal(r.status, 200); return (await j(r)).pedido! }
/** Flujo del cliente que insiste: aviso 409 → «Es otro pedido, continuar» sobre la MISMA operación. Devuelve el pedido creado (queda en revisión). */
async function continuar(t: string, vis: string, cant: number) {
  const op = crypto.randomUUID(), disp = crypto.randomUUID(); const a = await pedir(t, vis, cant, { operacion_id: op, dispositivo_id: disp }); assert.equal(a.status, 409)
  const b = await pedir(t, vis, cant, { operacion_id: op, dispositivo_id: disp, confirmar_otro_pedido: true }); assert.equal(b.status, 200, JSON.stringify(await b.clone().json())); return (await j(b)).pedido!
}
const estadoReq = (pedido_id: string, estado_nuevo: string) => ESTADO(new Request('http://x/api/pedidos/estado', { method: 'POST', body: JSON.stringify({ pedido_id, estado_nuevo, operador_id: null }) }))
let seqPago = 1000
async function webhook(pedido_id: string, pagoId = String(++seqPago)) {
  pagosMP.set(pagoId, { status: 'approved', external_reference: pedido_id })
  const r = await WEBHOOK(new Request('http://x/api/mp/webhook', { method: 'POST', body: JSON.stringify({ type: 'payment', data: { id: pagoId } }) })); return { status: r.status, pagoId }
}
const consulta = async (accion: string, extra: J = {}, dispositivo_id = w.disp) => { const r = await CONSULTA(new Request('http://x/api/operacion/consulta', { method: 'POST', body: JSON.stringify({ dispositivo_id, accion, ...extra }) })); return { status: r.status, d: (await r.json()) as J } }
const resolver = (pedido_id: string, resolucion: string, dispositivo_id = w.disp) => consulta('revision_resolver', { pedido_id, resolucion }, dispositivo_id)
const pasarAMP = (id: string) => db.query("update pedidos set metodo_pago='mp' where id=$1", [id])
const reset = () => { for (const k of Object.keys(llamadas)) delete llamadas[k]; llamadasMP.length = 0; fallaRpc = {} }

describe('Posible duplicado: ciclo completo por las rutas reales (CTO 14/11)', () => {
  beforeEach(async () => { reset(); await db.query('delete from sabores_falla; delete from sabores_llamadas; delete from caja_llamadas'); await mundo() })

  test('S1) CASO REAL #43/#49: el segundo cliente continúa → se crea su pedido propio, el #43 queda INTACTO y el nuevo queda con revisión PENDIENTE que apunta al #43', async () => {
    const t = tel(); const p43 = await primero(t, 'celu-sandra', 2); const p49 = await continuar(t, 'otro-celu', 3)
    assert.equal(await npedidos(), 2); assert.equal(await stock(), 45)
    const rv = await revDe(p49.id); assert.equal(rv.estado, 'PENDIENTE'); assert.equal(rv.coincidencia, 'DISTINTA'); assert.equal(rv.candidatos.length, 1)
    const op43 = (await fila(p43.id)).operacion_id; assert.equal(rv.candidatos[0], op43)
    assert.equal((await fila(p43.id)).estado, 'PENDING_PAYMENT'); assert.equal(await revDe(p43.id), undefined, 'el original no tiene revisión')
    const ret = await db.query('select pedido_id, revision_estado from pedidos_en_revision($1, $2::uuid[])', [w.emp, [p43.id, p49.id]]); assert.deepEqual(ret.rows, [{ pedido_id: p49.id, revision_estado: 'PENDIENTE' }])
  })

  test('S2) COMPUERTA /api/pedidos/estado: el pedido retenido NO se cobra, prepara, deja listo ni entrega (409 REVISION_DUPLICADO, sin cambios ni log); el original y la cancelación NO se frenan', async () => {
    const t = tel(); const p1 = await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3)
    for (const e of ['PAID', 'PREPARING', 'READY', 'DELIVERED']) {
      const r = await estadoReq(p2.id, e); const d = (await r.json()) as J
      assert.equal(r.status, 409, e); assert.equal(d.codigo, 'REVISION_DUPLICADO'); assert.equal(d.revision_estado, 'PENDIENTE')
    }
    assert.equal((await fila(p2.id)).estado, 'PENDING_PAYMENT'); assert.deepEqual(await logDe(p2.id), []); assert.equal(contador('edge:facturar'), 0)
    assert.equal((await estadoReq(p1.id, 'PAID')).status, 200); assert.equal((await fila(p1.id)).estado, 'PREPARING', 'el original sigue su circuito (PAID → PREPARING)')
    assert.equal((await estadoReq(p2.id, 'CANCELLED')).status, 200); assert.equal((await fila(p2.id)).estado, 'CANCELLED')
  })

  test('S3) LEGITIMO libera: el pedido recién se puede cobrar, el original no se toca, la revisión guarda quién y cuándo, y repetir no hace nada', async () => {
    const t = tel(); const p1 = await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3)
    const antes = await fila(p1.id)
    const r = await resolver(p2.id, 'LEGITIMO'); assert.equal(r.status, 200); assert.equal(r.d.resolucion, 'LEGITIMO'); assert.equal(r.d.ya_resuelta, false)
    const rv = await revDe(p2.id); assert.equal(rv.estado, 'LEGITIMO'); assert.ok(rv.resuelto_at)
    assert.deepEqual(await fila(p1.id), antes, 'el pedido original no se modificó')
    assert.equal((await estadoReq(p2.id, 'PAID')).status, 200); assert.equal((await fila(p2.id)).estado, 'PREPARING')
    const r2 = await resolver(p2.id, 'LEGITIMO'); assert.equal(r2.status, 200); assert.equal(r2.d.ya_resuelta, true)
    const r3 = await resolver(p2.id, 'DUPLICADO'); assert.equal(r3.status, 409); assert.equal(r3.d.codigo, 'YA_RESUELTA')
    assert.equal((await fila(p2.id)).estado, 'PREPARING', 'un DUPLICADO tardío no pisa la decisión ni toca el pedido')
  })

  test('S4) DUPLICADO: el pedido se CONSERVA (no se cancela ni borra), queda retenido para siempre, devuelve el stock UNA vez con las funciones existentes y llama a la devolución de sabores', async () => {
    const t = tel(); const p1 = await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3)
    assert.equal(await stock(), 45)
    const r = await resolver(p2.id, 'DUPLICADO'); assert.equal(r.status, 200); assert.equal(r.d.resolucion, 'DUPLICADO'); assert.equal(r.d.reembolso_pendiente, false)
    assert.equal(await stock(), 48, 'se devolvieron las 3 unidades del duplicado; las 2 del original siguen descontadas')
    const f = await fila(p2.id); assert.equal(f.estado, 'PENDING_PAYMENT'); assert.equal(f.stock_descontado, false)
    assert.equal(await sabores(), 1); const rv = await revDe(p2.id); assert.equal(rv.estado, 'DUPLICADO'); assert.ok(rv.stock_devuelto_at)
    // idempotencia: repetir la acción no devuelve de nuevo
    assert.equal((await resolver(p2.id, 'DUPLICADO')).status, 200); assert.equal(await stock(), 48); assert.equal(await sabores(), 1)
    const libro = await db.query("select delta from stock_movimientos where pedido_id=$1 order by created_at", [p2.id]); assert.deepEqual(libro.rows.map(x => Number(x.delta)), [-3, 3])
    // sigue retenido: no se cobra ni prepara
    for (const e of ['PAID', 'PREPARING']) { const x = await estadoReq(p2.id, e); assert.equal(x.status, 409); assert.equal(((await x.json()) as J).revision_estado, 'DUPLICADO') }
    assert.equal((await fila(p1.id)).stock_descontado, true, 'el stock del original no se tocó')
  })

  test('S5) DUPLICADO con fallo parcial: la revisión queda resuelta, el reclamo se suelta y REPETIR la acción completa la devolución sin devolver dos veces', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3)
    await db.query('insert into sabores_falla values (true)')
    const r = await resolver(p2.id, 'DUPLICADO'); assert.equal(r.status, 500); assert.equal(r.d.codigo, 'EFECTOS_PENDIENTES')
    let rv = await revDe(p2.id); assert.equal(rv.estado, 'DUPLICADO'); assert.equal(rv.stock_devuelto_at, null, 'el reclamo se soltó para poder reintentar')
    await db.query('delete from sabores_falla')
    assert.equal((await resolver(p2.id, 'DUPLICADO')).status, 200)
    rv = await revDe(p2.id); assert.ok(rv.stock_devuelto_at); assert.equal(await stock(), 48, 'devuelto exactamente UNA vez'); assert.equal(await sabores(), 1)
  })

  test('S6) Pedido con stock por RAMA: se usa devolver_stock_pedido_caja (doble: el SQL real no está en el repo) y NO devolver_stock_pedido', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3)
    await db.query("insert into stock_movimientos(empresa_id,sucursal_id,producto_id,delta,motivo,pedido_id,rama_id) values($1,$2,$3,-1,'venta',$4,gen_random_uuid())", [w.emp, w.suc, w.prod, p2.id])
    reset(); assert.equal((await resolver(p2.id, 'DUPLICADO')).status, 200)
    assert.equal(contador('devolver_stock_pedido_caja'), 1); assert.equal(contador('devolver_stock_pedido'), 0)
    assert.deepEqual((await db.query('select dispositivo from caja_llamadas')).rows.map(r => r.dispositivo), [w.disp])
  })

  test('S7) AUTORIZACIÓN de las acciones nuevas: solo una CAJA de la sucursal del pedido; kiosco, otra sucursal, resolución inválida y pedido ajeno se rechazan sin tocar nada', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3)
    assert.equal((await resolver(p2.id, 'LEGITIMO', w.dispNoCaja)).status, 403)
    assert.equal((await resolver(p2.id, 'LEGITIMO', w.dispOtraSuc)).status, 403)
    assert.equal((await resolver(p2.id, 'ANULAR')).status, 400)
    assert.equal((await consulta('revision_resolver', { pedido_id: 'no-es-uuid', resolucion: 'LEGITIMO' })).status, 400)
    assert.equal((await resolver(crypto.randomUUID(), 'LEGITIMO')).status, 403)
    assert.equal((await revDe(p2.id)).estado, 'PENDIENTE'); assert.equal(await stock(), 45)
    const sinRev = await primero(tel(), 'z', 1); assert.equal((await resolver(sinRev.id, 'DUPLICADO')).status, 409, 'un pedido sin revisión no se puede marcar duplicado')
    assert.equal(await stock(), 44)
  })

  test('S8) FAIL-CLOSED / base vieja: si no se puede saber si está retenido → 503 y no avanza; si la función no existe (SQL sin aplicar) → flujo de siempre', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3); const sueltoP = await primero(tel(), 'z', 1)
    fallaRpc = { pedidos_en_revision: { status: 500, code: 'XX000' } }
    assert.equal((await estadoReq(p2.id, 'PAID')).status, 503); assert.equal((await fila(p2.id)).estado, 'PENDING_PAYMENT')
    await pasarAMP(p2.id); const wh = await webhook(p2.id); assert.equal(wh.status, 503, 'MP reintenta el aviso'); const f = await fila(p2.id); assert.equal(f.estado, 'PENDING_PAYMENT'); assert.equal(f.mp_payment_id, null); assert.equal(contador('edge:facturar'), 0)
    fallaRpc = { pedidos_en_revision: { status: 404, code: 'PGRST202' } }                       // función inexistente: SQL todavía no aplicado
    assert.equal((await estadoReq(sueltoP.id, 'PAID')).status, 200); assert.equal((await fila(sueltoP.id)).estado, 'PREPARING')
  })
})

describe('Condición A · Mercado Pago confirma el pago mientras la revisión está PENDIENTE', () => {
  beforeEach(async () => { reset(); await db.query('delete from sabores_falla; delete from sabores_llamadas; delete from caja_llamadas'); await mundo() })

  test('A1) el pago se REGISTRA pero NO se prepara ni se factura; un segundo aviso del mismo pago no repite nada; al resolver LEGITIMO el circuito se REANUDA una sola vez (PREPARING + log + factura + puntos)', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3); await pasarAMP(p2.id)
    const wh = await webhook(p2.id); assert.equal(wh.status, 200)
    let f = await fila(p2.id)
    assert.equal(f.estado, 'PENDING_PAYMENT', 'NO empezó la preparación'); assert.equal(f.pagado, true); assert.equal(f.mp_payment_id, wh.pagoId); assert.match(f.notas, new RegExp(`MP payment ${wh.pagoId}`))
    assert.equal(contador('edge:facturar'), 0, 'NO se facturó'); assert.deepEqual(await logDe(p2.id), [])
    await webhook(p2.id, wh.pagoId); f = await fila(p2.id)
    assert.equal(f.notas.split(`MP payment ${wh.pagoId}`).length - 1, 1, 'la nota del pago no se duplica'); assert.equal(contador('edge:facturar'), 0)
    const r = await resolver(p2.id, 'LEGITIMO'); assert.equal(r.status, 200); assert.equal(r.d.reanudado, true)
    f = await fila(p2.id); assert.equal(f.estado, 'PREPARING')
    assert.deepEqual(await logDe(p2.id), [{ estado_anterior: 'PENDING_PAYMENT', estado_nuevo: 'PREPARING' }])
    assert.equal(contador('edge:facturar'), 1, 'se facturó exactamente una vez'); assert.equal(contador('tabla:beneficios_config'), 1, 'se intentó acreditar puntos una vez')
    assert.ok((await revDe(p2.id)).reanudado_at)
    // repetir / doble click / otro webhook: NADA se duplica
    await resolver(p2.id, 'LEGITIMO'); await webhook(p2.id, wh.pagoId)
    assert.equal(contador('edge:facturar'), 1); assert.equal((await logDe(p2.id)).length, 1); assert.equal((await fila(p2.id)).estado, 'PREPARING')
  })

  test('A2) CARRERA webhook ∥ LEGITIMO (12 rondas): sea cual sea el orden, el pedido termina PREPARING, con un único registro de estado y UNA sola factura', async () => {
    for (let i = 0; i < 12; i++) {
      reset(); await mundo(); const t = tel(); await primero(t, 'a', 1); const p2 = await continuar(t, 'b', 1); await pasarAMP(p2.id)
      pagosMP.set(`9${i}0`, { status: 'approved', external_reference: p2.id })
      const [rw, rr] = await Promise.all([
        WEBHOOK(new Request('http://x/api/mp/webhook', { method: 'POST', body: JSON.stringify({ type: 'payment', data: { id: `9${i}0` } }) })),
        resolver(p2.id, 'LEGITIMO'),
      ])
      assert.equal(rw.status, 200); assert.equal(rr.status, 200)
      const f = await fila(p2.id)
      assert.equal(f.estado, 'PREPARING', `ronda ${i}: quedó ${f.estado}`); assert.equal(f.mp_payment_id, `9${i}0`)
      assert.equal((await logDe(p2.id)).length, 1, `ronda ${i}: log duplicado`); assert.equal(contador('edge:facturar'), 1, `ronda ${i}: facturas=${contador('edge:facturar')}`)
    }
  })

  test('A3) un pedido que NO está en revisión: el webhook se comporta EXACTAMENTE como antes (PREPARING + factura), sin tocar el circuito', async () => {
    const p = await primero(tel(), 'a', 2); await pasarAMP(p.id); const wh = await webhook(p.id)
    const f = await fila(p.id); assert.equal(f.estado, 'PREPARING'); assert.equal(f.pagado, true); assert.equal(f.mp_payment_id, wh.pagoId); assert.equal(contador('edge:facturar'), 1)
  })
})

describe('Condición E · DUPLICADO ya pagado por Mercado Pago: reembolso MANUAL', () => {
  beforeEach(async () => { reset(); await db.query('delete from sabores_falla; delete from sabores_llamadas; delete from caja_llamadas'); await mundo() })

  test('E1) pagó ANTES de resolver: DUPLICADO deja reembolso_pendiente; el sistema NO llama a MP para devolver; el pedido no se prepara ni factura; «gestionado» deja constancia (idempotente)', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3); await pasarAMP(p2.id); await webhook(p2.id)
    const r = await resolver(p2.id, 'DUPLICADO'); assert.equal(r.status, 200); assert.equal(r.d.reembolso_pendiente, true)
    assert.equal((await fila(p2.id)).estado, 'PENDING_PAYMENT'); assert.equal(contador('edge:facturar'), 0); assert.deepEqual(llamadasMP, [], 'ninguna llamada de reembolso a Mercado Pago')
    let rv = await revDe(p2.id); assert.equal(rv.reembolso_pendiente, true); assert.equal(rv.reembolso_gestionado_at, null)
    const g = await consulta('revision_reembolso', { pedido_id: p2.id, operador_id: crypto.randomUUID() }); assert.equal(g.status, 200)
    rv = await revDe(p2.id); assert.ok(rv.reembolso_gestionado_at); const cuando = rv.reembolso_gestionado_at
    await consulta('revision_reembolso', { pedido_id: p2.id }); assert.deepEqual((await revDe(p2.id)).reembolso_gestionado_at, cuando, 'repetir no cambia la constancia')
    assert.deepEqual(llamadasMP, [])
  })

  test('E2) pagó DESPUÉS de resolver DUPLICADO: el pago se registra, queda reembolso_pendiente y el pedido sigue sin prepararse ni facturarse', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3); await pasarAMP(p2.id)
    await resolver(p2.id, 'DUPLICADO'); assert.equal((await revDe(p2.id)).reembolso_pendiente, false, 'todavía no había pago')
    const wh = await webhook(p2.id); assert.equal(wh.status, 200)
    const f = await fila(p2.id); assert.equal(f.estado, 'PENDING_PAYMENT'); assert.equal(f.mp_payment_id, wh.pagoId); assert.equal(contador('edge:facturar'), 0)
    assert.equal((await revDe(p2.id)).reembolso_pendiente, true); assert.deepEqual(llamadasMP, [])
  })

  test('E3) CARRERA webhook ∥ DUPLICADO (12 rondas): no importa el orden, queda el reembolso pendiente y nada se prepara', async () => {
    for (let i = 0; i < 12; i++) {
      reset(); await mundo(); const t = tel(); await primero(t, 'a', 1); const p2 = await continuar(t, 'b', 1); await pasarAMP(p2.id)
      pagosMP.set(`8${i}0`, { status: 'approved', external_reference: p2.id })
      const [rw, rr] = await Promise.all([
        WEBHOOK(new Request('http://x/api/mp/webhook', { method: 'POST', body: JSON.stringify({ type: 'payment', data: { id: `8${i}0` } }) })),
        resolver(p2.id, 'DUPLICADO'),
      ])
      assert.equal(rw.status, 200); assert.equal(rr.status, 200)
      const f = await fila(p2.id), rv = await revDe(p2.id)
      assert.equal(f.estado, 'PENDING_PAYMENT', `ronda ${i}`); assert.equal(f.mp_payment_id, `8${i}0`, `ronda ${i}: el pago no se registró`)
      assert.equal(rv.reembolso_pendiente, true, `ronda ${i}: se perdió el reembolso pendiente`); assert.equal(contador('edge:facturar'), 0)
    }
  })

  test('E4) un pedido MP que NUNCA se pagó y se marca DUPLICADO NO simula plata: sin reembolso pendiente', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3); await pasarAMP(p2.id)
    const r = await resolver(p2.id, 'DUPLICADO'); assert.equal(r.d.reembolso_pendiente, false)
    assert.equal((await consulta('revision_reembolso', { pedido_id: p2.id })).status, 409)
  })
})

describe('Condición B · concurrencia del CICLO COMPLETO por la ruta (reclamo → pedido → revisión)', () => {
  beforeEach(async () => { reset(); await db.query('delete from sabores_llamadas'); await mundo(500) })

  test('B1) dos clientes ya avisados confirman «Es otro pedido» AL MISMO TIEMPO (15 rondas): se crean los 2 pedidos, cada uno con su revisión, y NINGUNA relación se pierde (el posterior apunta al anterior y al original)', async () => {
    for (let i = 0; i < 15; i++) {
      const t = tel(); const p0 = await primero(t, 'dueña', 1); const op0 = (await fila(p0.id)).operacion_id
      const opA = crypto.randomUUID(), opB = crypto.randomUUID(), dA = crypto.randomUUID(), dB = crypto.randomUUID()
      assert.equal((await pedir(t, 'cliente-A', 2, { operacion_id: opA, dispositivo_id: dA })).status, 409); assert.equal((await pedir(t, 'cliente-B', 3, { operacion_id: opB, dispositivo_id: dB })).status, 409)
      const [ra, rb] = await Promise.all([pedir(t, 'cliente-A', 2, { operacion_id: opA, dispositivo_id: dA, confirmar_otro_pedido: true }), pedir(t, 'cliente-B', 3, { operacion_id: opB, dispositivo_id: dB, confirmar_otro_pedido: true })])
      assert.equal(ra.status, 200, `ronda ${i} A`); assert.equal(rb.status, 200, `ronda ${i} B`)
      const pa = (await j(ra)).pedido!, pb = (await j(rb)).pedido!
      const rva = await revDe(pa.id), rvb = await revDe(pb.id)
      assert.ok(rva && rvb, `ronda ${i}: falta una revisión`); assert.equal(rva.estado, 'PENDIENTE'); assert.equal(rvb.estado, 'PENDIENTE')
      assert.ok(rva.candidatos.includes(op0) && rvb.candidatos.includes(op0), `ronda ${i}: se perdió el original`)
      const opPa = (await fila(pa.id)).operacion_id, opPb = (await fila(pb.id)).operacion_id
      assert.ok(rva.candidatos.includes(opPb) || rvb.candidatos.includes(opPa), `ronda ${i}: los dos nuevos no se relacionan entre sí`)
      const ret = await db.query('select pedido_id from pedidos_en_revision($1, $2::uuid[])', [w.emp, [p0.id, pa.id, pb.id]]); assert.deepEqual(ret.rows.map(r => r.pedido_id).sort(), [pa.id, pb.id].sort())
    }
  })
})

describe('Vista Caja · datos de la revisión (pedidos_hoy) y regresiones de otros circuitos', () => {
  beforeEach(async () => { reset(); await db.query('delete from sabores_falla; delete from sabores_llamadas; delete from caja_llamadas'); await mundo() })
  type PH = { pedidos: { id: string; estado: string; revision?: { estado: string; coincidencia: string; reembolso_pendiente: boolean; stock_devuelto: boolean; candidatos: { numero_pedido: number; estado: string; cliente: string | null; comparacion: { identicos: boolean; lineas: { nombre: string; nuevo: number; candidato: number; estado: string }[] } }[] } | null }[] }

  test('V1) CASO #43/#49: pedidos_hoy entrega la revisión del nuevo con el #43 como candidato (número, estado, cliente) y la comparación REAL (2 vs 3); el original NO tiene revisión', async () => {
    const t = tel(); const p43 = await primero(t, 'celu-sandra', 2); const p49 = await continuar(t, 'otro-celu', 3)
    const { status, d } = await consulta('pedidos_hoy'); assert.equal(status, 200); const ped = (d as unknown as PH).pedidos
    const n = ped.find(p => p.id === p49.id)!, o = ped.find(p => p.id === p43.id)!
    assert.equal(o.revision, null); assert.ok(n.revision); assert.equal(n.revision!.estado, 'PENDIENTE'); assert.equal(n.revision!.coincidencia, 'DISTINTA')
    const c = n.revision!.candidatos; assert.equal(c.length, 1); assert.equal(c[0].numero_pedido, p43.numero_pedido); assert.equal(c[0].estado, 'PENDING_PAYMENT'); assert.equal(c[0].cliente, 'Sandra')
    assert.equal(c[0].comparacion.identicos, false); assert.deepEqual(c[0].comparacion.lineas.map(l => [l.nombre, l.nuevo, l.candidato, l.estado]), [['Alfajor', 3, 2, 'distinto']])
  })

  test('V2) contenido IDÉNTICO: coincidencia IDENTICA y comparación «igual»; con VARIOS pedidos activos del teléfono se listan todos, el del MISMO visitante primero', async () => {
    const t = tel(); const pa = await primero(t, 'visitante-1', 2)
    const pb = await continuar(t, 'visitante-2', 5)                                // otro activo del mismo teléfono (queda en revisión)
    const pn = await continuar(t, 'visitante-1', 2)                                // idéntico al primero, MISMO visitante que el primero
    const ped = ((await consulta('pedidos_hoy')).d as unknown as PH).pedidos; const rv = ped.find(p => p.id === pn.id)!.revision!
    assert.equal(rv.coincidencia, 'IDENTICA'); assert.equal(rv.candidatos.length, 2)
    assert.equal(rv.candidatos[0].numero_pedido, pa.numero_pedido, 'el del mismo visitante va primero'); assert.equal(rv.candidatos[0].comparacion.identicos, true)
    assert.equal(rv.candidatos[1].numero_pedido, pb.numero_pedido); assert.equal(rv.candidatos[1].comparacion.identicos, false)
  })

  test('V3) tras LEGITIMO la alerta desaparece (revision null); tras DUPLICADO el pedido sigue en la lista, marcado, con stock_devuelto', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3); const p3 = await continuar(t, 'c', 4)
    await resolver(p2.id, 'LEGITIMO'); await resolver(p3.id, 'DUPLICADO')
    const ped = ((await consulta('pedidos_hoy')).d as unknown as PH).pedidos
    assert.equal(ped.find(p => p.id === p2.id)!.revision, null)
    const r3 = ped.find(p => p.id === p3.id)!; assert.equal(r3.estado, 'PENDING_PAYMENT'); assert.equal(r3.revision!.estado, 'DUPLICADO'); assert.equal(r3.revision!.stock_devuelto, true)
  })

  test('V4) otra sucursal NO ve la revisión ni los candidatos (la consulta se acota a la sucursal del dispositivo)', async () => {
    const t = tel(); await primero(t, 'a', 2); const p2 = await continuar(t, 'b', 3)
    const d = (await consulta('pedidos_hoy', {}, w.dispOtraSuc)).d as unknown as PH
    assert.equal(d.pedidos.find(p => p.id === p2.id)?.revision ?? null, null)
  })

  test('R1) KIOSCO / CAJA / fuera de alcance: mismo teléfono y mismo contenido NO crean revisión y el circuito de estados es el de siempre', async () => {
    const t = tel(); const k1 = await pedir(t, 'a', 2, { tipo_pedido: 'kiosk', origen: 'KIOSK' }); const k2 = await pedir(t, 'a', 2, { tipo_pedido: 'kiosk', origen: 'KIOSK' })
    assert.equal(k1.status, 200); assert.equal(k2.status, 409, 'el kiosco conserva su advertencia histórica')
    const k3 = await pedir(t, 'a', 2, { tipo_pedido: 'kiosk', origen: 'KIOSK', operacion_id: (await j(k2)) && crypto.randomUUID(), confirmar_advertencia: true }); assert.ok([200, 409].includes(k3.status))
    assert.equal(Number((await db.query('select count(*) from pedido_revisiones_duplicado where empresa_id=$1', [w.emp])).rows[0].count), 0)
    const k = (await j(k1)).pedido!; assert.equal((await estadoReq(k.id, 'PAID')).status, 200); assert.equal((await fila(k.id)).estado, 'PREPARING')
  })
})
