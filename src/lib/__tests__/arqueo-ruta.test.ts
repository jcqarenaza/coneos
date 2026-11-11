// Ruta REAL /api/operacion/arqueo contra un shim PostgREST EN MEMORIA (sin RLS, sin transacciones).
// Cubre: cadena de identidad (todo fallo = 403 genérico), validaciones, 23505 → 409 ARQUEO_PENDIENTE,
// compensación si fallan los ítems, y que el cliente no decide empresa/sucursal/teórico.
// La unicidad real (índice arqueos_stock_un_pendiente_por_sucursal) se prueba contra Postgres, no acá.
// Ejecutar: npx tsx --test src/lib/__tests__/arqueo-ruta.test.ts
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

type Row = Record<string, unknown>
const T: Record<string, Row[]> = {}
let writes: { t: string; metodo: string; filtro: Record<string, string>; body: unknown }[] = []
let errorInsertArqueo: { code: string } | null = null
let errorInsertItems = false
let server: http.Server
let seq = 0
const EMP = 'e0000000-0000-4000-8000-000000000001', EMP2 = 'e0000000-0000-4000-8000-000000000002'
const S1 = '50000000-0000-4000-8000-000000000001', S2 = '50000000-0000-4000-8000-000000000002'
const DISP = 'd0000000-0000-4000-8000-000000000001', SES = '5e550000-0000-4000-8000-000000000001', OP = '0a000000-0000-4000-8000-000000000001'
const P1 = 'a0000000-0000-4000-8000-000000000001', P2 = 'a0000000-0000-4000-8000-000000000002', PAJENO = 'a0000000-0000-4000-8000-000000000009'
const CAT = 'c0000000-0000-4000-8000-000000000001'
const TOKEN = 'token-caja-valido-123'

function match(row: Row, url: URL) {
  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(k)) continue
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false
    if (v === 'is.null' && row[k] != null) return false
    if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(row[k]))) return false
  }
  return true
}
function arrancar(): Promise<number> {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const url = new URL(req.url!, 'http://x'); const body = raw ? JSON.parse(raw) : undefined
      const out = (st: number, d: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)) }
      const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]; if (!t) return out(404, {})
      const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      const tabla = (T[t] ??= [])
      if (req.method === 'GET') {
        const m = tabla.filter(x => match(x, url))
        if (obj) return m[0] ? out(200, m[0]) : out(406, { code: 'PGRST116', message: 'no rows' })
        return out(200, m)
      }
      writes.push({ t, metodo: req.method!, filtro: Object.fromEntries(url.searchParams.entries()), body })
      if (req.method === 'POST') {
        if (t === 'arqueos_stock' && errorInsertArqueo) return out(409, { code: errorInsertArqueo.code, message: 'duplicate key value violates unique constraint', details: '', hint: '' })
        if (t === 'arqueo_items' && errorInsertItems) return out(500, { code: 'XX000', message: 'boom' })
        const filas = (Array.isArray(body) ? body : [body]).map((b: Row) => ({ id: `ar${++seq}`.padEnd(8, '0') + '-0000-4000-8000-000000000000', estado: 'pendiente', created_at: new Date(Date.now() + seq).toISOString(), ...b }))
        tabla.push(...filas)
        return out(201, obj ? filas[0] : filas)
      }
      if (req.method === 'DELETE') { T[t] = tabla.filter(x => !match(x, url)); return out(204, undefined) }
      out(200, [])
    })
  })
  return new Promise(res => server.listen(0, '127.0.0.1', () => res((server.address() as { port: number }).port)))
}
let ARQUEO: (r: Request) => Promise<Response>
before(async () => {
  const port = await arrancar()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  ARQUEO = (await import('../../app/api/operacion/arqueo/route')).POST as typeof ARQUEO
})
after(() => server?.close())
beforeEach(() => {
  writes = []; errorInsertArqueo = null; errorInsertItems = false; seq = 0
  for (const k of Object.keys(T)) delete T[k]
  T.dispositivos = [{ id: DISP, empresa_id: EMP, sucursal_id: S1, activo: true, tipo: 'CAJA', device_token: TOKEN }]
  T.operator_sessions = [{ id: SES, operador_id: OP, dispositivo_id: DISP, empresa_id: EMP, sucursal_id: S1, estado: 'ACTIVA' }]
  T.operadores = [{ id: OP, nombre: 'Caja Uno', empresa_id: EMP, sucursal_id: S1, puede_cobrar: true, activo: true, deleted_at: null }]
  T.categorias = [{ id: CAT, nombre: 'Dulces', empresa_id: EMP, activo: true, orden: 1 }]
  T.productos = [
    { id: P1, empresa_id: EMP, nombre: 'Alfajor', categoria_id: CAT, controla_stock: true, activo: true, deleted_at: null },
    { id: P2, empresa_id: EMP, nombre: 'Bomba', categoria_id: CAT, controla_stock: true, activo: true, deleted_at: null },
    { id: PAJENO, empresa_id: EMP2, nombre: 'Ajeno', categoria_id: CAT, controla_stock: true, activo: true, deleted_at: null },
  ]
  T.producto_stock = [
    { empresa_id: EMP, sucursal_id: S1, producto_id: P1, cantidad: 10 },
    { empresa_id: EMP, sucursal_id: S2, producto_id: P1, cantidad: 99 },
  ]
  T.arqueos_stock = []; T.arqueo_items = []
})

const post = (b: Record<string, unknown>) => ARQUEO(new Request('http://x/api/operacion/arqueo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }))
const id = { device_token: TOKEN, session_id: SES }
const guardar = (extra: Record<string, unknown> = {}) => post({ accion: 'guardar', ...id, alcance: 'completo', items: [{ producto_id: P1, fisico: 8 }], ...extra })

describe('identidad (todo fallo = 403 genérico, sin escrituras)', () => {
  const casos: [string, () => void, Record<string, unknown>?][] = [
    ['sin device_token', () => {}, { device_token: undefined }],
    ['device_token inexistente', () => {}, { device_token: 'token-que-no-existe-1' }],
    ['dispositivo inactivo', () => { T.dispositivos[0].activo = false }],
    ['dispositivo no es CAJA', () => { T.dispositivos[0].tipo = 'KIOSK' }],
    ['session_id no es uuid', () => {}, { session_id: 'abc' }],
    ['sesión inexistente', () => { T.operator_sessions = [] }],
    ['sesión CERRADA', () => { T.operator_sessions[0].estado = 'CERRADA' }],
    ['sesión de otro dispositivo', () => { T.operator_sessions[0].dispositivo_id = 'd0000000-0000-4000-8000-0000000000ff' }],
    ['sesión de otra sucursal', () => { T.operator_sessions[0].sucursal_id = S2 }],
    ['sesión de otra empresa', () => { T.operator_sessions[0].empresa_id = EMP2 }],
    ['operador inactivo', () => { T.operadores[0].activo = false }],
    ['operador dado de baja', () => { T.operadores[0].deleted_at = '2026-01-01' }],
    ['operador de otra empresa', () => { T.operadores[0].empresa_id = EMP2 }],
    ['operador de otra sucursal', () => { T.operadores[0].sucursal_id = S2 }],
    ['operador sin puede_cobrar', () => { T.operadores[0].puede_cobrar = false }],
  ]
  for (const accion of ['preparar', 'guardar'] as const) for (const [n, mut, over] of casos) {
    test(`${accion}: ${n}`, async () => {
      mut()
      const r = await post({ accion, ...id, alcance: 'completo', items: [{ producto_id: P1, fisico: 1 }], ...over })
      assert.equal(r.status, 403); assert.deepEqual(await r.json(), { error: 'No autorizado' })
      assert.equal(writes.length, 0)
    })
  }
  test('operador de toda la empresa (sucursal_id null) sí autoriza', async () => {
    T.operadores[0].sucursal_id = null
    assert.equal((await guardar()).status, 200)
  })
})

describe('preparar', () => {
  test('devuelve pendiente=false y los productos de la empresa (no los ajenos)', async () => {
    const j = await (await post({ accion: 'preparar', ...id })).json()
    assert.equal(j.pendiente, false)
    assert.deepEqual((j.productos as Row[]).map(p => p.id).sort(), [P1, P2].sort())
  })
  test('pendiente=true si ya hay uno en la sucursal; uno de OTRA sucursal no cuenta', async () => {
    T.arqueos_stock = [{ id: 'x1', empresa_id: EMP, sucursal_id: S2, estado: 'pendiente' }]
    assert.equal((await (await post({ accion: 'preparar', ...id })).json()).pendiente, false)
    T.arqueos_stock.push({ id: 'x2', empresa_id: EMP, sucursal_id: S1, estado: 'pendiente' })
    assert.equal((await (await post({ accion: 'preparar', ...id })).json()).pendiente, true)
  })
})

describe('guardar', () => {
  test('camino feliz: empresa/sucursal/teórico salen del servidor, aunque el cliente mande otros', async () => {
    const r = await guardar({ empresa_id: EMP2, sucursal_id: S2, teorico: 1234, contado_por: 'Otro' })
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.ok, true); assert.equal(j.cargados, 1)
    const a = T.arqueos_stock[0]; assert.equal(a.empresa_id, EMP); assert.equal(a.sucursal_id, S1); assert.equal(a.contado_por, 'Caja Uno')
    assert.equal(T.arqueo_items[0].teorico, 10); assert.equal(T.arqueo_items[0].fisico, 8)
  })
  test('producto sin fila de stock → teórico 0', async () => {
    assert.equal((await guardar({ items: [{ producto_id: P2, fisico: 3 }] })).status, 200)
    assert.equal(T.arqueo_items[0].teorico, 0)
  })
  test('no escribe en producto_stock ni stock_movimientos', async () => {
    await guardar(); assert.ok(writes.every(w => w.t === 'arqueos_stock' || w.t === 'arqueo_items'))
  })
  for (const [n, f] of [['decimal', 1.5], ['negativo', -1], ['NaN-string', '5'], ['null', null], ['enorme', 1_000_001]] as const) {
    test(`cantidad inválida (${n}) → 400 CANTIDAD_INVALIDA`, async () => {
      const r = await guardar({ items: [{ producto_id: P1, fisico: f }] }); assert.equal(r.status, 400)
      assert.equal((await r.json()).code, 'CANTIDAD_INVALIDA'); assert.equal(writes.length, 0)
    })
  }
  test('0 es válido', async () => { assert.equal((await guardar({ items: [{ producto_id: P1, fisico: 0 }] })).status, 200) })
  test('ítems vacíos / repetidos / no-uuid → 400', async () => {
    for (const items of [[], [{ producto_id: P1, fisico: 1 }, { producto_id: P1, fisico: 2 }], [{ producto_id: 'x', fisico: 1 }]]) {
      assert.equal((await guardar({ items })).status, 400)
    }
    assert.equal(writes.length, 0)
  })
  test('producto de otra empresa → 422 PRODUCTO_INVALIDO', async () => {
    const r = await guardar({ items: [{ producto_id: PAJENO, fisico: 1 }] }); assert.equal(r.status, 422)
    assert.equal((await r.json()).code, 'PRODUCTO_INVALIDO'); assert.equal(writes.length, 0)
  })
  test('alcance: categoría válida guarda "categoria:<nombre>"; de otra empresa → 422', async () => {
    assert.equal((await guardar({ alcance: CAT })).status, 200); assert.equal(T.arqueos_stock[0].alcance, 'categoria:Dulces')
    T.categorias[0].empresa_id = EMP2; T.arqueos_stock = []
    const r = await guardar({ alcance: CAT }); assert.equal(r.status, 422); assert.equal((await r.json()).code, 'ALCANCE_INVALIDO')
  })
  test('ya hay pendiente en la sucursal → 409 ARQUEO_PENDIENTE sin escribir', async () => {
    T.arqueos_stock = [{ id: 'x2', empresa_id: EMP, sucursal_id: S1, estado: 'pendiente' }]
    const r = await guardar(); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'ARQUEO_PENDIENTE')
    assert.equal(writes.length, 0)
  })
  test('23505 en el insert (carrera) → 409 ARQUEO_PENDIENTE, no 500, y no inserta ítems', async () => {
    errorInsertArqueo = { code: '23505' }
    const r = await guardar(); assert.equal(r.status, 409)
    const j = await r.json(); assert.equal(j.code, 'ARQUEO_PENDIENTE'); assert.match(j.error, /PENDIENTE/)
    assert.equal(writes.some(w => w.t === 'arqueo_items'), false)
  })
  test('otro error del insert del arqueo (no 23505) → 500', async () => {
    errorInsertArqueo = { code: '42501' }
    assert.equal((await guardar()).status, 500)
  })
  test('falla el insert de ítems → 500 y compensa borrando SOLO su arqueo', async () => {
    errorInsertItems = true
    const r = await guardar(); assert.equal(r.status, 500); assert.equal((await r.json()).compensado, true)
    const del = writes.find(w => w.metodo === 'DELETE' && w.t === 'arqueos_stock')!
    assert.ok(del.filtro.id?.startsWith('eq.') && del.filtro.empresa_id === `eq.${EMP}`)
    assert.equal(T.arqueos_stock.length, 0)
  })
  test('anti-duplicado post-insert: si el más antiguo es otro, se retira el propio → 409', async () => {
    // Otro pendiente más viejo aparece DESPUÉS del pre-chequeo (2ª lectura de arqueos_stock = relectura post-insert).
    let lecturas = 0
    const r0 = server.listeners('request')[0] as (...a: unknown[]) => void
    server.removeAllListeners('request')
    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.method === 'GET' && req.url!.startsWith('/rest/v1/arqueos_stock')) {
        lecturas++
        if (lecturas === 2) T.arqueos_stock.unshift({ id: 'viejo000-0000-4000-8000-000000000000', empresa_id: EMP, sucursal_id: S1, estado: 'pendiente', created_at: '2000-01-01T00:00:00Z' })
      }
      r0(req, res)
    })
    const r = await guardar(); server.removeAllListeners('request'); server.on('request', r0)
    assert.equal(r.status, 409); assert.equal((await r.json()).code, 'ARQUEO_PENDIENTE')
    assert.equal(T.arqueos_stock.length, 1); assert.equal(T.arqueos_stock[0].id, 'viejo000-0000-4000-8000-000000000000')
  })
  test('acción inválida / cuerpo inválido → 400', async () => {
    assert.equal((await post({ accion: 'borrar', ...id })).status, 400)
    assert.equal((await ARQUEO(new Request('http://x/', { method: 'POST', body: 'no-json' }))).status, 400)
  })
})
