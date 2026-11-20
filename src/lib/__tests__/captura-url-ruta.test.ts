// Ruta REAL /api/operacion/consulta (acciones pedidos_hoy, historial, captura_url) contra un shim PostgREST + Storage EN MEMORIA.
// Prueba: la lista de caja NO entrega la URL/ruta guardada (solo tiene_captura), captura_url firma solo comprobantes del pedido
// y de la empresa del dispositivo, y no permite enumerar pedidos (misma respuesta para "no existe" y "no es tuyo").
// Ejecutar: npx tsx --test src/lib/__tests__/captura-url-ruta.test.ts
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

type Row = Record<string, unknown>
const T: Record<string, Row[]> = {}
const OBJETOS = new Set<string>()           // 'capturas/<ruta>' que existen en Storage
const firmasPedidas: { ruta: string; expiresIn: number }[] = []
let server: http.Server

const E1 = 'e0000000-0000-4000-8000-000000000001', E2 = 'e0000000-0000-4000-8000-000000000002'
const S1 = '50000000-0000-4000-8000-000000000001', S2 = '50000000-0000-4000-8000-000000000002'
const D1 = 'd0000000-0000-4000-8000-000000000001'                 // dispositivo de la sucursal S1
const D2 = 'd0000000-0000-4000-8000-000000000002'                 // dispositivo de la sucursal S2 (misma empresa E1)
const P_VIEJO = '30000000-0000-4000-8000-000000000001'    // E1, ruta vieja pedidos/<id>.jpg (URL pública)
const P_NUEVO = '30000000-0000-4000-8000-000000000002'    // E1, ruta nueva <E1>/pedidos/<id>.png (solo ruta)
const P_SIN = '30000000-0000-4000-8000-000000000003'      // E1, sin comprobante
const P_AJENO = '30000000-0000-4000-8000-000000000004'    // E2 (otra empresa)
const P_TRAMPA = '30000000-0000-4000-8000-000000000005'   // E1, pero su valor apunta al comprobante de OTRO pedido
const P_URL_AJENA = '30000000-0000-4000-8000-000000000006' // E1, URL de otro sitio
const P_SIN_OBJ = '30000000-0000-4000-8000-000000000007'  // E1, ruta válida pero el archivo no existe
const P_SUC_B = '30000000-0000-4000-8000-000000000008'   // E1, sucursal S2, con comprobante válido
const P_PDF_VIEJO = '30000000-0000-4000-8000-000000000009'  // E1, ruta vieja pedidos/<id>.pdf (URL pública) — el caso real: 1 pedido
const P_PDF_NUEVO = '30000000-0000-4000-8000-00000000000a'  // E1, ruta nueva <E1>/pedidos/<id>.pdf
const P_PDF_MAYUS = '30000000-0000-4000-8000-00000000000b'  // E1, extensión .PDF en mayúsculas
const P_PDF_AJENO = '30000000-0000-4000-8000-00000000000c'  // E2, PDF de otra empresa
const P_FIRMA_FALLA = '30000000-0000-4000-8000-00000000000d' // E1, PDF válido pero Storage falla al firmar (error 500)
const FIRMA_FALLA = new Set<string>()                        // rutas para las que el Storage simulado responde 500 al firmar
const BASE = 'https://x.supabase.co/storage/v1/object/public/capturas'

function match(row: Row, url: URL) {
  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(k)) continue
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false
    if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(row[k]))) return false
  }
  return true
}
function arrancar(): Promise<number> {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const url = new URL(req.url!, 'http://x'); const body = raw ? JSON.parse(raw) : undefined
      const out = (st: number, d: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)) }
      const s = url.pathname.match(/^\/storage\/v1\/object\/sign\/capturas\/(.+)$/)
      if (s && req.method === 'POST') {
        const ruta = decodeURIComponent(s[1]); firmasPedidas.push({ ruta, expiresIn: body?.expiresIn })
        if (FIRMA_FALLA.has(ruta)) return out(500, { error: 'Internal', message: 'falla simulada de firma' })
        return OBJETOS.has(`capturas/${ruta}`) ? out(200, { signedURL: `/object/sign/capturas/${ruta}?token=FIRMA` }) : out(400, { error: 'Object not found', message: 'Object not found' })
      }
      const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]; if (!t) return out(404, {})
      const m = (T[t] ??= []).filter(x => match(x, url))
      const obj = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
      if (obj) return m[0] ? out(200, m[0]) : out(406, { code: 'PGRST116', message: 'no rows' })
      out(200, m)
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
}

type Handler = (r: Request) => Promise<Response>
let POST: Handler
const llamar = async (body: unknown) => {
  const r = await POST(new Request('http://x/api/operacion/consulta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: r.status, json: await r.json() as Record<string, any> }  // eslint-disable-line @typescript-eslint/no-explicit-any
}
const ped = (id: string, empresa: string, captura: string | null): Row => ({
  id, empresa_id: empresa, sucursal_id: S1, numero_pedido: 1, estado: 'PAID', fecha_pedido: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
  created_at: new Date().toISOString(), captura_transferencia_url: captura,
})

before(async () => {
  const port = await arrancar()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  T.dispositivos = [{ id: D1, empresa_id: E1, sucursal_id: S1, activo: true }, { id: D2, empresa_id: E1, sucursal_id: S2, activo: true }]
  T.pedidos = [
    ped(P_VIEJO, E1, `${BASE}/pedidos/${P_VIEJO}.jpg`),
    ped(P_NUEVO, E1, `${E1}/pedidos/${P_NUEVO}.png`),
    ped(P_SIN, E1, null),
    ped(P_AJENO, E2, `${BASE}/${E2}/pedidos/${P_AJENO}.jpg`),
    ped(P_TRAMPA, E1, `${BASE}/pedidos/${P_AJENO}.jpg`),
    ped(P_URL_AJENA, E1, 'https://otro-sitio.com/pedidos/foto.jpg'),
    ped(P_SIN_OBJ, E1, `${E1}/pedidos/${P_SIN_OBJ}.jpg`),
    { ...ped(P_SUC_B, E1, `${E1}/pedidos/${P_SUC_B}.jpg`), sucursal_id: S2 },
    ped(P_PDF_VIEJO, E1, `${BASE}/pedidos/${P_PDF_VIEJO}.pdf`),
    ped(P_PDF_NUEVO, E1, `${E1}/pedidos/${P_PDF_NUEVO}.pdf`),
    ped(P_PDF_MAYUS, E1, `${E1}/pedidos/${P_PDF_MAYUS}.PDF`),
    ped(P_PDF_AJENO, E2, `${E2}/pedidos/${P_PDF_AJENO}.pdf`),
    ped(P_FIRMA_FALLA, E1, `${E1}/pedidos/${P_FIRMA_FALLA}.pdf`),
  ]
  T.colaboradores = []; T.producto_stock = []; T.sucursales = [{ id: S1, empresa_id: E1, comanda_auto: false, ticket_auto: false }]; T.empresa_config = [{ empresa_id: E1, modulos: {} }]
  for (const r of [`pedidos/${P_VIEJO}.jpg`, `${E1}/pedidos/${P_NUEVO}.png`, `${E2}/pedidos/${P_AJENO}.jpg`, `pedidos/${P_AJENO}.jpg`, `${E1}/pedidos/${P_SUC_B}.jpg`,
    `pedidos/${P_PDF_VIEJO}.pdf`, `${E1}/pedidos/${P_PDF_NUEVO}.pdf`, `${E1}/pedidos/${P_PDF_MAYUS}.PDF`, `${E2}/pedidos/${P_PDF_AJENO}.pdf`, `${E1}/pedidos/${P_FIRMA_FALLA}.pdf`]) OBJETOS.add(`capturas/${r}`)
  FIRMA_FALLA.add(`${E1}/pedidos/${P_FIRMA_FALLA}.pdf`)
  POST = (await import('../../app/api/operacion/consulta/route')).POST as Handler
})
after(() => server?.close())

test('captura_url: comprobante con URL pública vieja → URL firmada de 10 minutos', async () => {
  firmasPedidas.length = 0
  const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_VIEJO })
  assert.equal(r.status, 200)
  assert.match(r.json.url, /\/sign\/capturas\/pedidos\/30000000-0000-4000-8000-000000000001\.jpg\?token=FIRMA$/)
  assert.deepEqual(firmasPedidas, [{ ruta: `pedidos/${P_VIEJO}.jpg`, expiresIn: 600 }])
  assert.equal(r.json.expira_en_seg, 600)
})
test('captura_url: comprobante guardado como RUTA nueva por empresa → firmada', async () => {
  const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_NUEVO })
  assert.equal(r.status, 200); assert.match(r.json.url, new RegExp(`/sign/capturas/${E1}/pedidos/${P_NUEVO}\\.png`))
})
test('captura_url: pedido de OTRA empresa → 404 (y NO se firma nada)', async () => {
  firmasPedidas.length = 0
  const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_AJENO })
  assert.equal(r.status, 404); assert.equal(firmasPedidas.length, 0)
})
test('captura_url: no distingue "no existe" de "no es tuyo" (no permite enumerar pedidos)', async () => {
  const ajeno = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_AJENO })
  const inexistente = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: '30000000-0000-4000-8000-0000000000ff' })
  assert.deepEqual(ajeno, inexistente)
})
test('captura_url: sin comprobante, ruta de OTRO pedido, URL ajena, archivo inexistente → 404 sin firmar lo que no corresponde', async () => {
  firmasPedidas.length = 0
  for (const id of [P_SIN, P_TRAMPA, P_URL_AJENA, P_SIN_OBJ]) {
    const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: id })
    assert.equal(r.status, 404, id); assert.equal(r.json.url, undefined)
  }
  assert.deepEqual(firmasPedidas.map(f => f.ruta), [`${E1}/pedidos/${P_SIN_OBJ}.jpg`])   // solo intentó la única ruta válida (no existe en Storage)
})
test('captura_url: pedido_id inválido o ausente → 404; dispositivo inválido → 403', async () => {
  for (const pedido_id of [undefined, '', 'x', '../../etc/passwd', 123, { a: 1 }]) {
    const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id }); assert.equal(r.status, 404, String(pedido_id))
  }
  assert.equal((await llamar({ dispositivo_id: 'd0000000-0000-4000-8000-0000000000ee', accion: 'captura_url', pedido_id: P_NUEVO })).status, 403)
})
test('pedidos_hoy: NO entrega la URL/ruta guardada; solo tiene_captura (true solo si es firmable)', async () => {
  const r = await llamar({ dispositivo_id: D1, accion: 'pedidos_hoy', verTodas: true })
  assert.equal(r.status, 200)
  const por = new Map((r.json.pedidos as Row[]).map(p => [p.id as string, p]))
  assert.equal(por.has(P_AJENO), false)                                    // otra empresa: ni aparece
  for (const p of por.values()) assert.equal('captura_transferencia_url' in p, false)
  assert.equal(JSON.stringify(r.json).includes('supabase.co'), false)
  assert.equal(JSON.stringify(r.json).includes('otro-sitio'), false)
  assert.equal(por.get(P_VIEJO)!.tiene_captura, true)
  assert.equal(por.get(P_NUEVO)!.tiene_captura, true)
  assert.equal(por.get(P_SIN)!.tiene_captura, false)
  assert.equal(por.get(P_TRAMPA)!.tiene_captura, false)                    // apunta al comprobante de otro pedido
  assert.equal(por.get(P_URL_AJENA)!.tiene_captura, false)
})
test('historial: igual que pedidos_hoy (sin valor crudo, con tiene_captura)', async () => {
  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const r = await llamar({ dispositivo_id: D1, accion: 'historial', fecha, verTodas: true })
  assert.equal(r.status, 200)
  const ps = r.json.pedidos as Row[]
  assert.ok(ps.length >= 5)
  for (const p of ps) assert.equal('captura_transferencia_url' in p, false)
  assert.equal(ps.find(p => p.id === P_NUEVO)!.tiene_captura, true)
  assert.equal(ps.find(p => p.id === P_SIN)!.tiene_captura, false)
})

test('captura_url: dispositivo de OTRA sucursal (misma empresa) NO puede firmar el comprobante; verTodas del cliente no amplía el acceso', async () => {
  firmasPedidas.length = 0
  const normal = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_SUC_B })
  const conVerTodas = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_SUC_B, verTodas: true })
  const verTodasTruthy = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_SUC_B, verTodas: 'true' })
  for (const r of [normal, conVerTodas, verTodasTruthy]) { assert.equal(r.status, 404); assert.equal(r.json.url, undefined) }
  assert.equal(firmasPedidas.length, 0)                                    // ni siquiera se pidió firma a Storage
  const inexistente = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: '30000000-0000-4000-8000-0000000000ff' })
  assert.deepEqual(normal, inexistente)                                    // misma respuesta que un pedido inexistente (no enumera)
})
test('captura_url: cada sucursal firma SOLO los comprobantes de la suya (S2 sí el suyo, y no el de S1)', async () => {
  firmasPedidas.length = 0
  const propio = await llamar({ dispositivo_id: D2, accion: 'captura_url', pedido_id: P_SUC_B })
  assert.equal(propio.status, 200); assert.match(propio.json.url, new RegExp(`/sign/capturas/${E1}/pedidos/${P_SUC_B}\\.jpg`))
  const ajeno = await llamar({ dispositivo_id: D2, accion: 'captura_url', pedido_id: P_NUEVO })      // pedido de S1
  assert.equal(ajeno.status, 404)
  assert.deepEqual(firmasPedidas.map(f => f.ruta), [`${E1}/pedidos/${P_SUC_B}.jpg`])
})

// ── Tipo de comprobante (imagen | pdf) — preparación Fase D ──
// El tipo lo deduce el SERVIDOR de la ruta ya validada. Nada cambia para JPEG/PNG/WebP, y no se amplía ningún permiso.
test('captura_url: imágenes (jpg, png) siguen igual y ahora informan tipo "imagen"; misma firma de 600 s', async () => {
  firmasPedidas.length = 0
  const jpg = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_VIEJO })
  const png = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_NUEVO })
  for (const r of [jpg, png]) { assert.equal(r.status, 200); assert.equal(r.json.tipo, 'imagen'); assert.equal(r.json.expira_en_seg, 600) }
  assert.deepEqual(Object.keys(jpg.json).sort(), ['expira_en_seg', 'tipo', 'url'])           // solo estas tres claves
  assert.deepEqual(firmasPedidas.map(f => f.expiresIn), [600, 600])
})
test('captura_url: PDF con ruta vieja (URL pública guardada) → firmada de 600 s, tipo "pdf"', async () => {
  firmasPedidas.length = 0
  const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_PDF_VIEJO })
  assert.equal(r.status, 200); assert.equal(r.json.tipo, 'pdf'); assert.equal(r.json.expira_en_seg, 600)
  assert.match(r.json.url, new RegExp(`/sign/capturas/pedidos/${P_PDF_VIEJO}\\.pdf\\?token=FIRMA$`))
  assert.deepEqual(firmasPedidas, [{ ruta: `pedidos/${P_PDF_VIEJO}.pdf`, expiresIn: 600 }])
  assert.equal(JSON.stringify(r.json).includes('/object/public/'), false)                    // no devuelve la URL pública original
})
test('captura_url: PDF con ruta nueva y con extensión en mayúsculas → tipo "pdf"', async () => {
  for (const id of [P_PDF_NUEVO, P_PDF_MAYUS]) {
    const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: id })
    assert.equal(r.status, 200, id); assert.equal(r.json.tipo, 'pdf', id)
  }
})
test('captura_url: el tipo NO lo decide el cliente (un "tipo: pdf" en el pedido pedido de una imagen no cambia nada)', async () => {
  const r = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_NUEVO, tipo: 'pdf', ext: 'pdf', contentType: 'application/pdf' })
  assert.equal(r.status, 200); assert.equal(r.json.tipo, 'imagen')
})
test('captura_url PDF: no amplía permisos — otra empresa, otra sucursal y pedido inexistente siguen en 404 sin firmar', async () => {
  firmasPedidas.length = 0
  const ajeno = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_PDF_AJENO })      // PDF de la empresa E2
  const inexistente = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: '30000000-0000-4000-8000-0000000000ff' })
  assert.equal(ajeno.status, 404); assert.deepEqual(ajeno, inexistente); assert.equal(ajeno.json.tipo, undefined)
  const otraSucursal = await llamar({ dispositivo_id: D2, accion: 'captura_url', pedido_id: P_PDF_NUEVO })  // PDF de la sucursal S1, pide S2
  assert.equal(otraSucursal.status, 404)
  assert.equal(firmasPedidas.length, 0)
})
test('captura_url PDF: error de firma en Storage (500) o archivo inexistente → 404 sin url ni tipo (el visor ofrece Reintentar)', async () => {
  firmasPedidas.length = 0
  const falla = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_FIRMA_FALLA })
  assert.equal(falla.status, 404); assert.equal(falla.json.url, undefined); assert.equal(falla.json.tipo, undefined)
  assert.deepEqual(firmasPedidas.map(f => f.ruta), [`${E1}/pedidos/${P_FIRMA_FALLA}.pdf`])             // sí lo intentó, y falló
  FIRMA_FALLA.delete(`${E1}/pedidos/${P_FIRMA_FALLA}.pdf`)                                             // se recupera: la renovación funciona
  const reintento = await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_FIRMA_FALLA })
  assert.equal(reintento.status, 200); assert.equal(reintento.json.tipo, 'pdf')
  FIRMA_FALLA.add(`${E1}/pedidos/${P_FIRMA_FALLA}.pdf`)
})
test('captura_url: renovar = pedir otra firma: cada llamada firma de nuevo con 600 s (no hay URL reutilizada en el servidor)', async () => {
  firmasPedidas.length = 0
  await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_PDF_NUEVO })
  await llamar({ dispositivo_id: D1, accion: 'captura_url', pedido_id: P_PDF_NUEVO })
  assert.deepEqual(firmasPedidas.map(f => f.expiresIn), [600, 600])
})
test('pedidos_hoy: un PDF también aparece solo como tiene_captura (sin URL ni ruta)', async () => {
  const r = await llamar({ dispositivo_id: D1, accion: 'pedidos_hoy', verTodas: true })
  const por = new Map((r.json.pedidos as Row[]).map(p => [p.id as string, p]))
  assert.equal(por.get(P_PDF_VIEJO)!.tiene_captura, true); assert.equal(por.get(P_PDF_NUEVO)!.tiene_captura, true)
  assert.equal(por.has(P_PDF_AJENO), false)
  for (const p of por.values()) assert.equal('captura_transferencia_url' in p, false)
  assert.equal(JSON.stringify(r.json).includes('.pdf'), false)
})
