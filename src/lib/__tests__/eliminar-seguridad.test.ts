// (eliminar) shim copiado; RUTA REAL /api/pedidos/eliminar. Orig: /api/reparto (posicion → salida automática por GPS, entregar) y /api/operacion/consulta (tiempos_entrega, asignar_cadete) contra un shim PostgREST EN MEMORIA
// (NO es Supabase real: sin RLS ni auth). La aritmética del promedio se prueba contra Postgres real en supabase/tests/tiempo-entrega/prueba_sql.py.
// Ejecutar: npx tsx --test src/lib/__tests__/eliminar-seguridad.test.ts
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

type Row = Record<string, unknown>
const T: Record<string, Row[]> = {}
let rpcLlamadas: { fn: string; args: Row }[] = []
let rpcRespuesta: Record<string, { status: number; body: unknown }> = {}   // respuesta por función RPC (E2-b)
let server: http.Server
const EMP = 'e0000000-0000-4000-8000-000000000001', CAD = 'c0000000-0000-4000-8000-000000000001', CAD2 = 'c0000000-0000-4000-8000-000000000002'
const SUC = 's0000000-0000-4000-8000-000000000001', DISP = 'd0000000-0000-4000-8000-000000000001', PED = 'p0000000-0000-4000-8000-000000000001'

function match(row: Row, url: URL) {
  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit'].includes(k)) continue
    if (k === 'or') {   // or=(col.is.null,col.neq.x)
      const ok = v.slice(1, -1).split(',').some(c => { const [col, op, ...rest] = c.split('.'); const val = rest.join('.')
        return op === 'is' ? row[col] == null : op === 'neq' ? String(row[col]) !== val : op === 'eq' && String(row[col]) === val })
      if (!ok) return false; continue
    }
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false
    if (v === 'is.null' && row[k] != null) return false
    if (v === 'not.is.null' && row[k] == null) return false
    if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(row[k]))) return false
  }
  return true
}
function arrancar(): Promise<number> {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const url = new URL(req.url!, 'http://x'); const body = raw ? JSON.parse(raw) : undefined
      const out = (st: number, d: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)) }
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
      if (rpc) { rpcLlamadas.push({ fn: rpc[1], args: body }); if (rpcRespuesta[rpc[1]]) return out(rpcRespuesta[rpc[1]].status, rpcRespuesta[rpc[1]].body); return out(200, { general: { entregas: 2, promedio_min: 15, descartados_por_tope: 0 }, cadetes: [] }) }
      const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]; if (!t) return out(404, {})
      const filas = (T[t] ??= []); const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      if (req.method === 'GET') { const m = filas.filter(r => match(r, url)); if (obj) return m[0] ? out(200, m[0]) : out(406, { code: 'PGRST116', message: 'no rows' }); return out(200, m) }
      if (req.method === 'HEAD') { const m = filas.filter(r => match(r, url)); res.writeHead(200, { 'content-range': `*/${m.length}` }); return res.end() }
      if (req.method === 'PATCH') { const m = filas.filter(r => match(r, url)); m.forEach(r => Object.assign(r, body)); return out(200, m) }
      if (req.method === 'POST' && url.searchParams.get('on_conflict')) { const k = url.searchParams.get('on_conflict')!; const e = filas.find(r => r[k] === body[k]); if (e) Object.assign(e, body); else filas.push({ ...body }); return out(201, [body]) }
      if (req.method === 'POST') { const nuevo = Array.isArray(body) ? body : [body]; filas.push(...nuevo); return out(201, nuevo) }
      if (req.method === 'DELETE') { T[t] = filas.filter(r => !match(r, url)); return out(204, undefined) }
      out(200, [])
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
}
let ELIMINAR: (r: Request) => Promise<Response>
const EMP2 = 'e0000000-0000-4000-8000-000000000002', SUC2 = 's0000000-0000-4000-8000-000000000002'
before(async () => {
  const port = await arrancar()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  ELIMINAR = (await import('../../app/api/pedidos/eliminar/route')).POST as typeof ELIMINAR
})
after(() => server?.close())
beforeEach(() => {
  rpcLlamadas = []; rpcRespuesta = {}
  for (const k of Object.keys(T)) delete T[k]
  T.pedidos = [{ id: PED, estado: 'PENDING_PAYMENT', numero_pedido: 7, empresa_id: EMP, sucursal_id: SUC, stock_descontado: true, numero_mesa: null, pagado: false, tipo_pedido: 'takeaway' }]
  T.dispositivos = [
    { id: DISP, empresa_id: EMP, sucursal_id: SUC, tipo: 'CAJA', activo: true },
    { id: 'd0000000-0000-4000-8000-000000000002', empresa_id: EMP2, sucursal_id: SUC2, tipo: 'CAJA', activo: true },
    { id: 'd0000000-0000-4000-8000-000000000003', empresa_id: EMP, sucursal_id: SUC, tipo: 'CAJA', activo: false },
    { id: 'd0000000-0000-4000-8000-000000000004', empresa_id: EMP, sucursal_id: SUC, tipo: 'KIOSK', activo: true },
    { id: 'd0000000-0000-4000-8000-000000000005', empresa_id: EMP, sucursal_id: SUC2, tipo: 'CAJA', activo: true },
  ]
})
const llamar = (b: unknown) => ELIMINAR(new Request('http://x/api/pedidos/eliminar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }))
const intacto = () => { assert.equal(T.pedidos.length, 1); assert.equal(rpcLlamadas.length, 0) }
describe('eliminar: seguridad', () => {
  test('S1 anónimo (sin dispositivo) → 403, nada borrado ni stock devuelto', async () => { const r = await llamar({ pedido_id: PED }); assert.equal(r.status, 403); intacto() })
  test('S2 dispositivo inexistente → 403', async () => { assert.equal((await llamar({ pedido_id: PED, dispositivo_id: 'd0000000-0000-4000-8000-0000000000ff' })).status, 403); intacto() })
  test('S3 dispositivo inactivo → 403', async () => { assert.equal((await llamar({ pedido_id: PED, dispositivo_id: 'd0000000-0000-4000-8000-000000000003' })).status, 403); intacto() })
  test('S4 dispositivo que no es CAJA (kiosco) → 403', async () => { assert.equal((await llamar({ pedido_id: PED, dispositivo_id: 'd0000000-0000-4000-8000-000000000004' })).status, 403); intacto() })
  test('S5 caja de OTRA empresa → 403', async () => { assert.equal((await llamar({ pedido_id: PED, dispositivo_id: 'd0000000-0000-4000-8000-000000000002' })).status, 403); intacto() })
  test('S6 caja de otra sucursal → 403', async () => { assert.equal((await llamar({ pedido_id: PED, dispositivo_id: 'd0000000-0000-4000-8000-000000000005' })).status, 403); intacto() })
  test('S7 caja correcta → elimina y devuelve stock', async () => {
    const r = await llamar({ pedido_id: PED, dispositivo_id: DISP }); assert.equal(r.status, 200)
    assert.equal(T.pedidos.length, 0); assert.equal(rpcLlamadas.filter(x => x.fn === 'devolver_stock_pedido').length, 1)
  })
  test('S8 caja correcta pero pedido ya cobrado → 409 (regla de negocio intacta)', async () => {
    T.pedidos[0].estado = 'PREPARING'; assert.equal((await llamar({ pedido_id: PED, dispositivo_id: DISP })).status, 409); intacto()
  })
  // ── E2-b: ventas que descontaron de hojas por rama ──
  test('R1 venta con movimientos de rama → devolver_stock_pedido_caja con la caja validada; elimina', async () => {
    T.stock_movimientos = [{ id: 'm1', pedido_id: PED, rama_id: 'r1', empresa_id: EMP }]
    rpcRespuesta.devolver_stock_pedido_caja = { status: 200, body: { estado: 'devuelto', grupos: 1 } }
    const r = await llamar({ pedido_id: PED, dispositivo_id: DISP }); assert.equal(r.status, 200)
    const c = rpcLlamadas.filter(x => x.fn === 'devolver_stock_pedido_caja'); assert.equal(c.length, 1)
    assert.equal(c[0].args.p_dispositivo, DISP); assert.equal(c[0].args.p_pedido, PED); assert.equal(c[0].args.p_empresa, EMP)
    assert.equal(rpcLlamadas.filter(x => x.fn === 'devolver_stock_pedido').length, 0); assert.equal(T.pedidos.length, 0)
  })
  test('R2 repetido (sin_efecto) → elimina igual', async () => {
    T.stock_movimientos = [{ id: 'm1', pedido_id: PED, rama_id: 'r1', empresa_id: EMP }]
    rpcRespuesta.devolver_stock_pedido_caja = { status: 200, body: { estado: 'sin_efecto', repetida: true } }
    assert.equal((await llamar({ pedido_id: PED, dispositivo_id: DISP })).status, 200); assert.equal(T.pedidos.length, 0)
  })
  test('R3 incidencia / inconsistente → 409 y el pedido NO se elimina', async () => {
    T.stock_movimientos = [{ id: 'm1', pedido_id: PED, rama_id: 'r1', empresa_id: EMP }]
    rpcRespuesta.devolver_stock_pedido_caja = { status: 200, body: { estado: 'incidencia', tipo: 'DEVOLUCION_PARCIAL' } }
    assert.equal((await llamar({ pedido_id: PED, dispositivo_id: DISP })).status, 409); assert.equal(T.pedidos.length, 1)
  })
  test('R4 error de la RPC → 500 y el pedido NO se elimina', async () => {
    T.stock_movimientos = [{ id: 'm1', pedido_id: PED, rama_id: 'r1', empresa_id: EMP }]
    rpcRespuesta.devolver_stock_pedido_caja = { status: 400, body: { code: 'P0001', message: 'DISPOSITIVO_NO_AUTORIZADO' } }
    assert.equal((await llamar({ pedido_id: PED, dispositivo_id: DISP })).status, 500); assert.equal(T.pedidos.length, 1)
  })
  test('R5 venta de producto legado (sin movimientos de rama) → camino de siempre', async () => {
    T.stock_movimientos = [{ id: 'm1', pedido_id: PED, rama_id: null, empresa_id: EMP }]
    assert.equal((await llamar({ pedido_id: PED, dispositivo_id: DISP })).status, 200)
    assert.equal(rpcLlamadas.filter(x => x.fn === 'devolver_stock_pedido').length, 1); assert.equal(rpcLlamadas.filter(x => x.fn === 'devolver_stock_pedido_caja').length, 0)
  })
})
