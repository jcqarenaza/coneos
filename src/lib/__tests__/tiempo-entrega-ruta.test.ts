// RUTAS REALES /api/reparto (posicion → salida automática por GPS, entregar) y /api/operacion/consulta (tiempos_entrega, asignar_cadete) contra un shim PostgREST EN MEMORIA
// (NO es Supabase real: sin RLS ni auth). La aritmética del promedio se prueba contra Postgres real en supabase/tests/tiempo-entrega/prueba_sql.py.
// Ejecutar: npx tsx --test src/lib/__tests__/tiempo-entrega-ruta.test.ts
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

type Row = Record<string, unknown>
const T: Record<string, Row[]> = {}
let rpcLlamadas: { fn: string; args: Row }[] = []
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
      if (rpc) { rpcLlamadas.push({ fn: rpc[1], args: body }); return out(200, { general: { entregas: 2, promedio_min: 15, descartados_por_tope: 0 }, cadetes: [] }) }
      const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]; if (!t) return out(404, {})
      const filas = (T[t] ??= []); const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      if (req.method === 'GET') { const m = filas.filter(r => match(r, url)); if (obj) return m[0] ? out(200, m[0]) : out(406, { code: 'PGRST116', message: 'no rows' }); return out(200, m) }
      if (req.method === 'HEAD') return out(200, undefined)
      if (req.method === 'PATCH') { const m = filas.filter(r => match(r, url)); m.forEach(r => Object.assign(r, body)); return out(200, m) }
      if (req.method === 'POST' && url.searchParams.get('on_conflict')) { const k = url.searchParams.get('on_conflict')!; const e = filas.find(r => r[k] === body[k]); if (e) Object.assign(e, body); else filas.push({ ...body }); return out(201, [body]) }
      if (req.method === 'POST') { const nuevo = Array.isArray(body) ? body : [body]; filas.push(...nuevo); return out(201, nuevo) }
      if (req.method === 'DELETE') { T[t] = filas.filter(r => !match(r, url)); return out(204, undefined) }
      out(200, [])
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
}
let REPARTO: (r: Request) => Promise<Response>, CONSULTA: (r: Request) => Promise<Response>
before(async () => {
  const port = await arrancar()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  REPARTO = (await import('../../app/api/reparto/route')).POST as typeof REPARTO
  CONSULTA = (await import('../../app/api/operacion/consulta/route')).POST as typeof CONSULTA
})
after(() => server?.close())
beforeEach(() => {
  rpcLlamadas = []
  for (const k of Object.keys(T)) delete T[k]
  T.empresa_config = [{ empresa_id: EMP, modulos: { reparto: true } }]
  T.colaborador_sesiones = [{ token: 'tok1', colaborador_id: CAD, empresa_id: EMP, expira_at: new Date(Date.now() + 3600e3).toISOString() },
    { token: 'tok2', colaborador_id: CAD2, empresa_id: EMP, expira_at: new Date(Date.now() + 3600e3).toISOString() }]
  T.colaboradores = [{ id: CAD, empresa_id: EMP, nombre: 'Ana', rol: 'cadete', activo: true }, { id: CAD2, empresa_id: EMP, nombre: 'Beto', rol: 'cadete', activo: true }]
  T.pedidos = [{ id: PED, empresa_id: EMP, estado: 'READY', colaborador_id: CAD, tipo_pedido: 'delivery', metodo_pago: 'qr', pagado: true, salio_at: null, entregado_at: null }]
  T.dispositivos = [{ id: DISP, empresa_id: EMP, sucursal_id: SUC, activo: true }]
})
const rep = async (accion: string, extra: Row = {}, token = 'tok1') => { const r = await REPARTO(new Request('http://x', { method: 'POST', body: JSON.stringify({ accion, token, ...extra }) })); return { st: r.status, j: await r.json() as Row } }
const ped = () => T.pedidos[0]

const LOCAL = { lat: -35.6600, lng: -63.7500 }, A_100M = { lat: -35.6609, lng: -63.7500 }, A_20M = { lat: -35.66018, lng: -63.7500 }
const ping = async (pos: { lat: number; lng: number }, token = 'tok1') => {
  if (T.reparto_posiciones?.[0]) T.reparto_posiciones[0].updated_at = new Date(Date.now() - 60e3).toISOString()   // salta el throttle de 8 s
  return rep('posicion', pos, token)
}
const base = () => T.reparto_posiciones?.[0]

describe('Tiempo de entrega por las rutas reales (sin botón: arranca al mover la moto)', () => {
  test('G1 primer ping con pedido listo: fija el punto de partida y NO marca salida', async () => {
    const r = await ping(LOCAL); assert.equal(r.st, 200)
    assert.equal(base().base_lat, LOCAL.lat); assert.equal(ped().salio_at, null)
  })
  test('G2 ruido de GPS parado (20 m): sigue sin salida', async () => {
    await ping(LOCAL); await ping(A_20M); assert.equal(ped().salio_at, null); assert.equal(base().base_lat, LOCAL.lat)
  })
  test('G3 la moto se aleja 100 m del punto de partida: salio_at se marca y el punto se limpia', async () => {
    await ping(LOCAL); await ping(A_100M)
    assert.ok(ped().salio_at); assert.equal(base().base_lat, null)
  })
  test('G4 más pings en ruta NO pisan la hora de salida', async () => {
    await ping(LOCAL); await ping(A_100M); const t = ped().salio_at
    await new Promise(r => setTimeout(r, 15)); await ping({ lat: -35.67, lng: -63.76 }); await ping({ lat: -35.68, lng: -63.77 })
    assert.equal(ped().salio_at, t)
  })
  test('G5 un pedido en PREPARING no cuenta salida aunque la moto se mueva', async () => {
    ped().estado = 'PREPARING'; await ping(LOCAL); await ping(A_100M); assert.equal(ped().salio_at, null)
  })
  test('G6 pedido de OTRO cadete no recibe salida', async () => {
    await ping(LOCAL, 'tok2'); await ping(A_100M, 'tok2'); assert.equal(ped().salio_at, null)
  })
  test('G7 ping throttleado (<8 s) no cambia nada ni rompe', async () => {
    await ping(LOCAL); const r = await rep('posicion', A_100M); assert.equal(r.j.throttled, true); assert.equal(ped().salio_at, null)
  })
  test('G8 entregar registra entregado_at y la salida previa se conserva (entregado >= salida)', async () => {
    await ping(LOCAL); await ping(A_100M); await new Promise(r => setTimeout(r, 15))
    const r = await rep('entregar', { pedido_id: PED }); assert.equal(r.st, 200)
    assert.equal(ped().estado, 'DELIVERED'); assert.ok(new Date(ped().entregado_at as string) >= new Date(ped().salio_at as string))
  })
  test('G9 entregar dos veces: idempotente, entregado_at NO cambia', async () => {
    await rep('entregar', { pedido_id: PED }); const t1 = ped().entregado_at; await new Promise(r => setTimeout(r, 15))
    const r2 = await rep('entregar', { pedido_id: PED }); assert.equal(r2.j.ya_entregado, true); assert.equal(ped().entregado_at, t1)
  })
  test('G10 entregar sin haber salido funciona y no inventa salio_at (no entra al promedio)', async () => {
    const r = await rep('entregar', { pedido_id: PED }); assert.equal(r.st, 200); assert.equal(ped().salio_at, null); assert.ok(ped().entregado_at)
  })
  test('G11 sin sesión válida → 401 y nada escrito', async () => {
    const r = await rep('posicion', LOCAL, 'token-falso'); assert.equal(r.st, 401); assert.equal(T.reparto_posiciones, undefined)
  })
  test('C1 consulta tiempos_entrega: empresa y sucursal salen del DISPOSITIVO (nunca del cliente) y llama a la RPC', async () => {
    const r = await CONSULTA(new Request('http://x', { method: 'POST', body: JSON.stringify({ dispositivo_id: DISP, accion: 'tiempos_entrega', dias: 7, empresa_id: 'otra', p_empresa_id: 'otra' }) }))
    const j = await r.json() as Row; assert.equal(r.status, 200); assert.equal((j.general as Row).promedio_min, 15); assert.equal(j.dias, 7)
    assert.equal(rpcLlamadas.length, 1); assert.equal(rpcLlamadas[0].args.p_empresa_id, EMP); assert.equal(rpcLlamadas[0].args.p_sucursal_id, SUC)
  })
  test('C2 dispositivo inactivo → 403, no consulta', async () => {
    T.dispositivos[0].activo = false
    const r = await CONSULTA(new Request('http://x', { method: 'POST', body: JSON.stringify({ dispositivo_id: DISP, accion: 'tiempos_entrega' }) }))
    assert.equal(r.status, 403); assert.equal(rpcLlamadas.length, 0)
  })
  test('C3 reasignar a OTRO cadete borra salio_at; al MISMO lo conserva', async () => {
    ped().salio_at = new Date().toISOString(); const antes = ped().salio_at
    const asignar = (col: string) => CONSULTA(new Request('http://x', { method: 'POST', body: JSON.stringify({ dispositivo_id: DISP, accion: 'asignar_cadete', pedido_ids: [PED], colaborador_id: col }) }))
    await asignar(CAD); assert.equal(ped().salio_at, antes)
    await asignar(CAD2); assert.equal(ped().salio_at, null); assert.equal(ped().colaborador_id, CAD2)
  })
})
