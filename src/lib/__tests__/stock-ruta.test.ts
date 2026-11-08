// Ruta REAL /api/stock contra un shim PostgREST/Auth EN MEMORIA (sin RLS). La regla de stock se prueba contra Postgres real
// en supabase/tests/stock-ajuste/prueba_sql.py; acá: sesión, rol, sucursal, forma del pedido, errores y trazabilidad.
// Ejecutar: npx tsx --test src/lib/__tests__/stock-ruta.test.ts
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

type Row = Record<string, unknown>
const T: Record<string, Row[]> = {}
let rpc: { fn: string; args: Row }[] = []
let rpcRespuesta: { status: number; body: unknown } = { status: 200, body: { ok: true } }
let server: http.Server
const U = (n: number) => `u0000000-0000-4000-8000-00000000000${n}`
const EMP = 'e0000000-0000-4000-8000-000000000001', EMP2 = 'e0000000-0000-4000-8000-000000000002'
const S1 = '50000000-0000-4000-8000-000000000001', S2 = '50000000-0000-4000-8000-000000000002', S3 = '50000000-0000-4000-8000-000000000003'
const P1 = 'a0000000-0000-4000-8000-000000000001', P2 = 'a0000000-0000-4000-8000-000000000002', LOTE = 'b0000000-0000-4000-8000-000000000001'
const TOKENS: Record<string, string> = { adminEmp: U(1), adminSuc: U(2), caja: U(3), sinRol: U(4), adminEmp2: U(5), superAdmin: U(6) }

function match(row: Row, url: URL) {
  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
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
      if (url.pathname === '/auth/v1/user') {
        const tok = String(req.headers.authorization ?? '').replace('Bearer ', '')
        const id = Object.values(TOKENS).includes(tok) ? tok : null
        return id ? out(200, { id, aud: 'authenticated', role: 'authenticated', email: 'x@x' }) : out(401, { message: 'invalid' })
      }
      const r = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
      if (r) { rpc.push({ fn: r[1], args: body }); return out(rpcRespuesta.status, rpcRespuesta.body) }
      const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]; if (!t) return out(404, {})
      const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      let m = (T[t] ??= []).filter(x => match(x, url))
      const rg = String(req.headers.range ?? '').match(/^(\d+)-(\d+)$/); if (rg) m = m.slice(+rg[1], +rg[2] + 1)
      if (req.method === 'GET') { if (obj) return m[0] ? out(200, m[0]) : out(406, { code: 'PGRST116', message: 'no rows' }); return out(200, m) }
      out(200, [])
    })
  })
  return new Promise(res => server.listen(0, '127.0.0.1', () => res((server.address() as { port: number }).port)))
}
let STOCK: (r: Request) => Promise<Response>
before(async () => {
  const port = await arrancar()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  STOCK = (await import('../../app/api/stock/route')).POST as typeof STOCK
})
after(() => server?.close())
beforeEach(() => {
  rpc = []; rpcRespuesta = { status: 200, body: { ok: true } }
  for (const k of Object.keys(T)) delete T[k]
  T.usuario_admin_roles = [
    { usuario_id: TOKENS.adminEmp, empresa_id: EMP, sucursal_id: null, rol: 'ADMIN_EMPRESA' },
    { usuario_id: TOKENS.adminSuc, empresa_id: EMP, sucursal_id: S1, rol: 'ADMIN_SUCURSAL' },
    { usuario_id: TOKENS.adminEmp2, empresa_id: EMP2, sucursal_id: null, rol: 'ADMIN_EMPRESA' },
    { usuario_id: TOKENS.superAdmin, empresa_id: EMP, sucursal_id: null, rol: 'SUPER_ADMIN' },
  ]
  T.sucursales = [{ id: S1, nombre: 'Centro', empresa_id: EMP }, { id: S2, nombre: 'Norte', empresa_id: EMP }, { id: S3, nombre: 'Otra', empresa_id: EMP2 }]
  T.usuarios_admin = [{ id: TOKENS.adminEmp, nombre: 'Luci', empresa_id: EMP }, { id: TOKENS.adminSuc, nombre: 'Encargado Centro', empresa_id: EMP }]
  T.productos = [
    { id: P1, empresa_id: EMP, nombre: 'Alfajor', categoria_id: 'c1', controla_stock: true, activo: true, deleted_at: null },
    { id: P2, empresa_id: EMP, nombre: 'Bomba', categoria_id: 'c1', controla_stock: true, activo: true, deleted_at: null },
    { id: 'a0000000-0000-4000-8000-000000000009', empresa_id: EMP, nombre: 'SinControl', categoria_id: 'c1', controla_stock: false, activo: true, deleted_at: null },
  ]
  T.categorias = [{ id: 'c1', empresa_id: EMP, nombre: 'Dulces', orden: 1 }]
  T.producto_stock = [{ empresa_id: EMP, sucursal_id: S1, producto_id: P1, cantidad: 4, stock_minimo: 5, updated_at: '2026-11-08T10:00:00Z' }]
  T.stock_movimientos = []; T.stock_ajustes = []; T.pedidos = []
})
const llamar = (b: unknown, tok: string | null = TOKENS.adminEmp) => STOCK(new Request('http://x/api/stock', { method: 'POST',
  headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) }))
const ITEMS = [{ producto_id: P1, contado: 3 }]
const AJ = { accion: 'aplicar', sucursal_id: S1, lote_id: LOTE, motivo_tipo: 'conteo', items: ITEMS }

describe('/api/stock: acceso', () => {
  test('A1 sin sesión → 401', async () => { assert.equal((await llamar({ accion: 'sucursales' }, null)).status, 401) })
  test('A2 token inválido → 401', async () => { assert.equal((await llamar({ accion: 'sucursales' }, 'basura')).status, 401) })
  test('A3 usuario sin rol de admin (operador de caja) → 403 y no aplica nada', async () => {
    for (const t of [TOKENS.caja, TOKENS.sinRol]) { assert.equal((await llamar(AJ, t)).status, 403) }
    assert.equal(rpc.length, 0)
  })
  test('A4 SUPER_ADMIN no entra por esta ruta (fuera del alcance del CTO) → 403', async () => { assert.equal((await llamar(AJ, TOKENS.superAdmin)).status, 403); assert.equal(rpc.length, 0) })
  test('A5 ADMIN_EMPRESA ve todas las sucursales de SU empresa y no las de otra', async () => {
    const j = await (await llamar({ accion: 'sucursales' })).json(); assert.deepEqual(j.sucursales.map((s: Row) => s.id).sort(), [S1, S2])
  })
  test('A6 ADMIN_SUCURSAL ve solo su sucursal', async () => {
    const j = await (await llamar({ accion: 'sucursales' }, TOKENS.adminSuc)).json(); assert.deepEqual(j.sucursales.map((s: Row) => s.id), [S1])
  })
  test('A7 ADMIN_SUCURSAL no puede operar otra sucursal (misma empresa) → 403', async () => {
    assert.equal((await llamar({ ...AJ, sucursal_id: S2 }, TOKENS.adminSuc)).status, 403); assert.equal(rpc.length, 0)
    assert.equal((await llamar({ accion: 'inventario', sucursal_id: S2 }, TOKENS.adminSuc)).status, 403)
  })
  test('A8 admin de otra empresa no puede operar sucursal ajena → 403', async () => {
    assert.equal((await llamar({ ...AJ, sucursal_id: S3 })).status, 403); assert.equal((await llamar({ ...AJ }, TOKENS.adminEmp2)).status, 403); assert.equal(rpc.length, 0)
  })
})

describe('/api/stock: inventario', () => {
  test('I1 lista solo productos con control de stock, con estado y sin_alta', async () => {
    const j = await (await llamar({ accion: 'inventario', sucursal_id: S1 })).json()
    assert.equal(j.items.length, 2)
    const a = j.items.find((i: Row) => i.producto_id === P1), b = j.items.find((i: Row) => i.producto_id === P2)
    assert.equal(a.cantidad, 4); assert.equal(a.estado, 'bajo'); assert.equal(a.categoria, 'Dulces')
    assert.equal(b.cantidad, null); assert.equal(b.estado, 'sin_alta')
    assert.ok(j.ahora)
  })
  test('I2 sucursal sin filas: todo «sin alta» (no se inventa stock)', async () => {
    const j = await (await llamar({ accion: 'inventario', sucursal_id: S2 })).json(); assert.ok(j.items.every((i: Row) => i.estado === 'sin_alta'))
  })
})

describe('/api/stock: ajuste', () => {
  test('J1 aplicar: pasa usuario, nombre y empresa DE LA SUCURSAL (no del body) a la función SQL', async () => {
    const r = await llamar({ ...AJ, empresa_id: EMP2 }); assert.equal(r.status, 200)
    assert.equal(rpc.length, 1); assert.equal(rpc[0].fn, 'aplicar_ajuste_stock')
    assert.equal(rpc[0].args.p_empresa_id, EMP); assert.equal(rpc[0].args.p_usuario_id, TOKENS.adminEmp); assert.equal(rpc[0].args.p_usuario_nombre, 'Luci')
    assert.equal(rpc[0].args.p_sucursal_id, S1); assert.equal(rpc[0].args.p_lote_id, LOTE)
  })
  test('J2 previsualizar llama a la función de solo lectura', async () => {
    await llamar({ ...AJ, accion: 'previsualizar' }); assert.equal(rpc[0].fn, 'previsualizar_ajuste_stock')
  })
  test('J3 validaciones de forma → 400 y no llega a la base', async () => {
    const malos = [
      { ...AJ, motivo_tipo: undefined }, { ...AJ, motivo_tipo: 'robo' }, { ...AJ, motivo_tipo: 'conciliacion' }, { ...AJ, motivo_tipo: 'otro' }, { ...AJ, motivo_tipo: 'otro', descripcion: ' a ' },
      { ...AJ, items: [] }, { ...AJ, items: [{ producto_id: P1, base: 4, contado: -1 }] }, { ...AJ, items: [{ producto_id: P1, base: 4, contado: 1.5 }] },
      { ...AJ, items: [...ITEMS, ...ITEMS] }, { ...AJ, items: [{ producto_id: 'x', contado: 1 }] }, { ...AJ, lote_id: 'no-uuid' },
      { ...AJ, sucursal_id: undefined },
    ]
    for (const b of malos) assert.equal((await llamar(b)).status, 400, JSON.stringify(b).slice(0, 80))
    assert.equal(rpc.length, 0)
  })
  test('J3b la base NUNCA viaja del navegador a la base: una base inventada se descarta (solo producto_id y contado)', async () => {
    await llamar({ ...AJ, items: [{ producto_id: P1, contado: 3, base: 9999 }] }); await llamar({ ...AJ, accion: 'previsualizar', items: [{ producto_id: P1, contado: 3, base: 9999, x: 1 }] })
    for (const c of rpc) assert.deepEqual(c.args.p_items, [{ producto_id: P1, contado: 3 }])
    assert.equal(rpc.length, 2); assert.ok(!('p_iniciado_at' in rpc[0].args))
  })
  test('J4 motivo «otro» con descripción es válido', async () => { assert.equal((await llamar({ ...AJ, motivo_tipo: 'otro', descripcion: 'Regalo a cliente' })).status, 200) })
  test('J5 huella de confirmación solo si es sha256 hex; basura se descarta', async () => {
    await llamar({ ...AJ, huella_confirmada: 'x' }); assert.equal(rpc[0].args.p_huella_confirmada, null)
    const h = 'a'.repeat(64); await llamar({ ...AJ, huella_confirmada: h }); assert.equal(rpc[1].args.p_huella_confirmada, h)
  })
  test('J6 errores SQL se traducen: confirmación requerida → 409 con código; desconocido → 500 sin filtrar texto interno', async () => {
    rpcRespuesta = { status: 400, body: { code: 'P0001', message: 'CONFIRMACION_REQUERIDA' } }
    let r = await llamar(AJ); assert.equal(r.status, 409); assert.equal((await r.json()).codigo, 'CONFIRMACION_REQUERIDA')
    rpcRespuesta = { status: 400, body: { code: 'P0001', message: 'CONFIRMACION_INVALIDA' } }
    r = await llamar(AJ); assert.equal(r.status, 409); assert.equal((await r.json()).codigo, 'CONFIRMACION_INVALIDA')
    rpcRespuesta = { status: 500, body: { code: 'XX000', message: 'relation secreta.tabla falla' } }
    r = await llamar(AJ); assert.equal(r.status, 500); assert.ok(!JSON.stringify(await r.json()).includes('secreta'))
    rpcRespuesta = { status: 409, body: { code: '40P01', message: 'deadlock detected' } }
    r = await llamar(AJ); assert.equal(r.status, 503)
  })
})

describe('/api/stock: iniciar conteo (el servidor congela la base)', () => {
  test('C1 inicia con usuario, nombre y empresa de la sucursal validada; devuelve lo que responde la función', async () => {
    rpcRespuesta = { status: 200, body: { lote_id: LOTE, iniciado_at: '2026-11-08T20:00:00Z', items: [] } }
    const r = await llamar({ accion: 'iniciar', sucursal_id: S1, empresa_id: EMP2 }); assert.equal(r.status, 200); assert.equal((await r.json()).lote_id, LOTE)
    assert.equal(rpc[0].fn, 'iniciar_conteo_stock'); assert.equal(rpc[0].args.p_empresa_id, EMP); assert.equal(rpc[0].args.p_usuario_id, TOKENS.adminEmp); assert.equal(rpc[0].args.p_usuario_nombre, 'Luci')
  })
  test('C2 sin sesión 401; caja/SUPER_ADMIN/otra sucursal/otra empresa 403; no llega a la base', async () => {
    assert.equal((await llamar({ accion: 'iniciar', sucursal_id: S1 }, null)).status, 401)
    for (const t of [TOKENS.caja, TOKENS.superAdmin]) assert.equal((await llamar({ accion: 'iniciar', sucursal_id: S1 }, t)).status, 403)
    assert.equal((await llamar({ accion: 'iniciar', sucursal_id: S2 }, TOKENS.adminSuc)).status, 403)
    assert.equal((await llamar({ accion: 'iniciar', sucursal_id: S3 })).status, 403); assert.equal(rpc.length, 0)
  })
  test('C3 errores del conteo se traducen (no existe / ya aplicado / de otro usuario / fuera del conteo)', async () => {
    for (const [cod, st] of [['CONTEO_NO_ENCONTRADO', 409], ['CONTEO_YA_APLICADO', 409], ['CONTEO_DE_OTRO_USUARIO', 403], ['PRODUCTO_FUERA_DEL_CONTEO', 400]] as const) {
      rpcRespuesta = { status: 400, body: { code: 'P0001', message: cod } }; const r = await llamar(AJ); assert.equal(r.status, st, cod); assert.equal((await r.json()).codigo, cod)
    }
  })
})

describe('/api/stock: movimientos (trazabilidad)', () => {
  const ped = 'f0000000-0000-4000-8000-000000000001'
  beforeEach(() => {
    T.stock_ajustes = [{ id: LOTE, empresa_id: EMP, usuario_nombre: 'Luci', motivo_tipo: 'merma', descripcion: null }]
    T.stock_movimientos = [
      { id: 'm1', empresa_id: EMP, sucursal_id: S1, producto_id: P1, delta: -2, motivo: 'ajuste', ajuste_id: LOTE, pedido_id: null, detalle: 'x', created_at: '2026-11-08T12:00:00Z' },
      { id: 'm2', empresa_id: EMP, sucursal_id: S1, producto_id: P1, delta: -1, motivo: 'venta', ajuste_id: null, pedido_id: ped, detalle: null, created_at: '2026-11-08T11:00:00Z' },
      { id: 'm3', empresa_id: EMP, sucursal_id: S1, producto_id: P1, delta: 1, motivo: 'devolucion', ajuste_id: null, pedido_id: 'f0000000-0000-4000-8000-0000000000aa', detalle: null, created_at: '2026-11-08T10:30:00Z' },
      { id: 'm4', empresa_id: EMP, sucursal_id: S2, producto_id: P1, delta: 9, motivo: 'compra', ajuste_id: null, pedido_id: null, detalle: null, created_at: '2026-11-08T10:00:00Z' },
      { id: 'm5', empresa_id: EMP2, sucursal_id: S3, producto_id: P1, delta: 7, motivo: 'compra', ajuste_id: null, pedido_id: null, detalle: null, created_at: '2026-11-08T09:00:00Z' },
    ]
    T.pedidos = [{ id: ped, empresa_id: EMP, numero_pedido: 12, origen: 'CAJA', operator_session_id: 'os1', dispositivo_id: 'dp1' }]
    T.operator_sessions = [{ id: 'os1', operador_id: 'op1' }]; T.operadores = [{ id: 'op1', nombre: 'Marta' }]; T.dispositivos = [{ id: 'dp1', nombre: 'Caja 1', tipo: 'CAJA' }]
  })
  test('M1 muestra solo la sucursal pedida; el ajuste trae usuario y motivo; la venta cruza con el operador', async () => {
    const j = await (await llamar({ accion: 'movimientos', sucursal_id: S1 })).json()
    assert.deepEqual(j.items.map((x: Row) => x.id), ['m1', 'm2', 'm3'])
    assert.equal(j.items[0].responsable, 'Luci'); assert.equal(j.items[0].motivo_tipo, 'merma'); assert.equal(j.items[0].producto, 'Alfajor')
    assert.equal(j.items[1].responsable, 'Caja: Marta')
  })
  test('M2 devolución cuyo pedido fue eliminado → «No registrado» (no se inventa)', async () => {
    const j = await (await llamar({ accion: 'movimientos', sucursal_id: S1 })).json(); assert.equal(j.items[2].responsable, 'No registrado')
  })
  test('M3 compra sin dato de responsable → «No registrado»', async () => {
    const j = await (await llamar({ accion: 'movimientos', sucursal_id: S2 })).json(); assert.equal(j.items[0].responsable, 'No registrado')
  })
  test('M4 admin de sucursal no lee movimientos de otra sucursal ni empresa → 403', async () => {
    assert.equal((await llamar({ accion: 'movimientos', sucursal_id: S2 }, TOKENS.adminSuc)).status, 403)
    assert.equal((await llamar({ accion: 'movimientos', sucursal_id: S3 })).status, 403)
  })
  test('M5 paginación: limite 2 → hay_mas', async () => {
    const j = await (await llamar({ accion: 'movimientos', sucursal_id: S1, limite: 2 })).json(); assert.equal(j.items.length, 2); assert.equal(j.hay_mas, true)
  })
})
test('acción desconocida → 400', async () => { assert.equal((await llamar({ accion: 'borrar_todo', sucursal_id: S1 })).status, 400) })
