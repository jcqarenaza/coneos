// Ruta REAL POST /api/pedidos/comprobante (modo archivo) contra un shim PostgREST + Storage EN MEMORIA (con el supabase-js real).
// Cubre: pedido inexistente, método incorrecto, estado no habilitado, archivo inválido, archivo grande, comprobante ya existente,
// subida exitosa (ruta por empresa, upsert:false, sin URL en la respuesta), fallo de actualización, fallo de limpieza, y carreras.
// Ejecutar: npx tsx --test src/lib/__tests__/comprobante-subida.test.ts
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

type Row = Record<string, unknown>
const T: Record<string, Row[]> = {}
const OBJETOS = new Map<string, { bytes: number; upsert: string | undefined }>()   // 'capturas/<ruta>' → objeto
const llamadas: { metodo: string; ruta: string; extra?: unknown }[] = []             // todo lo que llegó a Storage
const patches: { filtro: Record<string, string>; body: Row }[] = []                  // updates a pedidos
let fallaUpdate = false, fallaRemove = false, lentoUpdate = false
let server: http.Server

const E1 = 'e0000000-0000-4000-8000-000000000001', E2 = 'e0000000-0000-4000-8000-000000000002'
const P_OK = '30000000-0000-4000-8000-000000000001'       // E1, transferencia, PENDING_PAYMENT, sin comprobante
const P_EFECTIVO = '30000000-0000-4000-8000-000000000002' // pago en efectivo
const P_PAGADO = '30000000-0000-4000-8000-000000000003'   // transferencia pero ya PREPARING
const P_CON = '30000000-0000-4000-8000-000000000004'      // ya tiene comprobante
const P_E2 = '30000000-0000-4000-8000-000000000005'       // empresa E2
const P_CANC = '30000000-0000-4000-8000-000000000006'     // CANCELLED
const P_RACE = '30000000-0000-4000-8000-000000000007'
const NO_EXISTE = '30000000-0000-4000-8000-0000000000ff'

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(100, 7)])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 7)])
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 7)])

function match(row: Row, url: URL) {
  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false
    if (v === 'is.null' && row[k] != null) return false
  }
  return true
}
function arrancar(): Promise<number> {
  server = http.createServer((req, res) => {
    const partes: Buffer[] = []; req.on('data', c => partes.push(c)); req.on('end', async () => {
      const raw = Buffer.concat(partes); const url = new URL(req.url!, 'http://x')
      const out = (st: number, d: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)) }
      // ── Storage ──
      const up = url.pathname.match(/^\/storage\/v1\/object\/capturas\/(.+)$/)
      if (up && req.method === 'POST') {
        const ruta = decodeURIComponent(up[1]); llamadas.push({ metodo: 'upload', ruta, extra: { upsert: req.headers['x-upsert'] } })
        if (OBJETOS.has(`capturas/${ruta}`) && req.headers['x-upsert'] !== 'true') return out(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
        OBJETOS.set(`capturas/${ruta}`, { bytes: raw.length, upsert: String(req.headers['x-upsert']) }); return out(200, { Key: `capturas/${ruta}`, Id: 'x' })
      }
      if (url.pathname === '/storage/v1/object/capturas' && req.method === 'DELETE') {
        const prefixes: string[] = JSON.parse(raw.toString()).prefixes; llamadas.push({ metodo: 'remove', ruta: prefixes.join(',') })
        if (fallaRemove) return out(500, { message: 'storage caído' })
        for (const p of prefixes) OBJETOS.delete(`capturas/${p}`); return out(200, prefixes.map(name => ({ name })))
      }
      // ── PostgREST ──
      const t = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]; if (!t) return out(404, {})
      const m = (T[t] ??= []).filter(x => match(x, url))
      if (req.method === 'GET') {
        if (String(req.headers.accept ?? '').includes('vnd.pgrst.object')) return m[0] ? out(200, m[0]) : out(406, { code: 'PGRST116', message: 'no rows' })
        return out(200, m)
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse(raw.toString()); patches.push({ filtro: Object.fromEntries(url.searchParams.entries()), body })
        if (lentoUpdate) await new Promise(r => setTimeout(r, 60))
        if (fallaUpdate) return out(500, { code: 'XX000', message: 'db caída' })
        const hechas = (T[t] ??= []).filter(x => match(x, url))      // el filtro se evalúa al aplicar (atómico, como un UPDATE condicional)
        for (const x of hechas) Object.assign(x, body)
        return out(200, hechas.map(x => ({ id: x.id })))
      }
      out(200, [])
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
}

type Handler = (r: Request) => Promise<Response>
let POST: Handler
const ped = (id: string, empresa: string, extra: Row = {}): Row => ({ id, empresa_id: empresa, metodo_pago: 'transferencia', estado: 'PENDING_PAYMENT', captura_transferencia_url: null, notas: null, ...extra })
const subir = async (pedidoId: unknown, archivo: Buffer | null, nombre = 'comprobante.jpg', tipo = 'image/jpeg', extraCampos: Record<string, string> = {}) => {
  const f = new FormData()
  if (pedidoId !== undefined) f.append('pedido_id', String(pedidoId))
  if (archivo) f.append('archivo', new File([new Uint8Array(archivo)], nombre, { type: tipo }))
  for (const [k, v] of Object.entries(extraCampos)) f.append(k, v)
  const r = await POST(new Request('http://x/api/pedidos/comprobante', { method: 'POST', body: f }))
  return { status: r.status, json: await r.json() as Record<string, any> }   // eslint-disable-line @typescript-eslint/no-explicit-any
}
const fila = (id: string) => T.pedidos.find(p => p.id === id)!

before(async () => {
  const port = await arrancar()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba-no-real'
  POST = (await import('../../app/api/pedidos/comprobante/route')).POST as Handler
})
after(() => server?.close())
beforeEach(() => {
  OBJETOS.clear(); llamadas.length = 0; patches.length = 0; fallaUpdate = false; fallaRemove = false; lentoUpdate = false
  T.pedidos = [
    ped(P_OK, E1), ped(P_EFECTIVO, E1, { metodo_pago: 'efectivo' }), ped(P_PAGADO, E1, { estado: 'PREPARING' }),
    ped(P_CON, E1, { captura_transferencia_url: `${E1}/pedidos/${P_CON}.jpg` }), ped(P_E2, E2), ped(P_CANC, E1, { estado: 'CANCELLED' }), ped(P_RACE, E1),
  ]
})
const UNIFORME = { status: 409, json: { ok: false, error: 'No se puede adjuntar el comprobante a este pedido' } }

test('subida exitosa: ruta <empresa>/pedidos/<pedido>.<ext>, upsert:false, guarda la RUTA (no URL) y responde solo {ok:true}', async () => {
  const r = await subir(P_OK, JPG)
  assert.deepEqual(r, { status: 200, json: { ok: true } })
  const ruta = `${E1}/pedidos/${P_OK}.jpg`
  assert.deepEqual(llamadas, [{ metodo: 'upload', ruta, extra: { upsert: 'false' } }])
  assert.ok(OBJETOS.has(`capturas/${ruta}`))
  assert.equal(fila(P_OK).captura_transferencia_url, ruta)
  assert.equal(String(fila(P_OK).captura_transferencia_url).includes('http'), false)
  assert.deepEqual(patches[0].filtro.estado, 'eq.PENDING_PAYMENT'); assert.equal(patches[0].filtro.captura_transferencia_url, 'is.null')   // update condicional
})
test('subida exitosa: la extensión sale del CONTENIDO (png/webp), no del nombre', async () => {
  for (const [id, buf, nombre, tipo, ext] of [[P_OK, PNG, 'captura.PNG', 'image/png', 'png'], [P_RACE, WEBP, 'foto.jpg', 'image/webp', 'webp']] as const) {
    const r = await subir(id, buf, nombre, tipo); assert.equal(r.status, 200); assert.equal(fila(id).captura_transferencia_url, `${E1}/pedidos/${id}.${ext}`)
  }
})
test('PDF NO se acepta (la caja no puede mostrarlo): 415, sin tocar Storage ni la base', async () => {
  const antes = JSON.stringify(T.pedidos)
  for (const [nombre, tipo] of [['comp.pdf', 'application/pdf'], ['comp.jpg', 'image/jpeg'], ['comp', '']] as const) {
    const r = await subir(P_OK, PDF, nombre, tipo); assert.equal(r.status, 415, nombre)
  }
  assert.equal(OBJETOS.size, 0); assert.equal(JSON.stringify(T.pedidos), antes)
})
test('subida exitosa: tipo declarado vacío (algunos celulares) y nombre .HEIC con contenido JPEG (iOS) se aceptan', async () => {
  assert.equal((await subir(P_OK, JPG, 'IMG_1234.HEIC', '')).status, 200)
  assert.equal(fila(P_OK).captura_transferencia_url, `${E1}/pedidos/${P_OK}.jpg`)
})
test('nombre sin extensión o con extensión no reconocida: 415, sin tocar Storage ni la base', async () => {
  const antes = JSON.stringify(T.pedidos)
  for (const nombre of ['image', 'foto.', 'comprobante.gif', 'a.php']) assert.equal((await subir(P_OK, JPG, nombre, 'image/jpeg')).status, 415, nombre)
  assert.equal(OBJETOS.size, 0); assert.equal(JSON.stringify(T.pedidos), antes)
})
test('la empresa sale del PEDIDO: un campo empresa_id del cliente se ignora', async () => {
  const r = await subir(P_E2, JPG, 'c.jpg', 'image/jpeg', { empresa_id: E1 })
  assert.equal(r.status, 200); assert.equal(fila(P_E2).captura_transferencia_url, `${E2}/pedidos/${P_E2}.jpg`)
  assert.equal(llamadas[0].ruta.startsWith(`${E2}/`), true)
})
test('pedido inexistente, método incorrecto, estado no habilitado, ya con comprobante, cancelado: MISMA respuesta (409) y NADA toca Storage', async () => {
  for (const id of [NO_EXISTE, P_EFECTIVO, P_PAGADO, P_CON, P_CANC]) assert.deepEqual(await subir(id, JPG), UNIFORME, id)
  assert.equal(llamadas.length, 0); assert.equal(patches.length, 0)
  assert.equal(fila(P_CON).captura_transferencia_url, `${E1}/pedidos/${P_CON}.jpg`)       // el existente quedó intacto
})
test('comprobante ya existente en Storage (objeto en la ruta) con base sin comprobante: no lo pisa, 409 y el objeto ajeno queda', async () => {
  OBJETOS.set(`capturas/${E1}/pedidos/${P_OK}.jpg`, { bytes: 999, upsert: undefined })
  assert.deepEqual(await subir(P_OK, JPG), UNIFORME)
  assert.equal(OBJETOS.get(`capturas/${E1}/pedidos/${P_OK}.jpg`)!.bytes, 999)
  assert.equal(llamadas.some(l => l.metodo === 'remove'), false)                           // no borra lo que no subió
  assert.equal(fila(P_OK).captura_transferencia_url, null); assert.equal(patches.length, 0)
})
test('archivo inválido: contenido no admitido, tipo que no coincide, extensión rara, vacío, sin archivo, pedido_id inválido', async () => {
  assert.equal((await subir(P_OK, EXE, 'virus.jpg', 'image/jpeg')).status, 415)           // dice ser jpg, es un ejecutable
  assert.equal((await subir(P_OK, Buffer.from('<script>alert(1)</script>'), 'a.png', 'image/png')).status, 415)
  assert.equal((await subir(P_OK, PNG, 'a.png', 'image/jpeg')).status, 415)                // declara jpeg, es png
  assert.equal((await subir(P_OK, JPG, 'a.exe', 'image/jpeg')).status, 415)                // extensión no admitida
  assert.equal((await subir(P_OK, Buffer.alloc(0), 'a.jpg')).status, 400)
  assert.equal((await subir(P_OK, null)).status, 400)
  assert.equal((await subir('no-es-uuid', JPG)).status, 400)
  assert.equal((await subir(undefined, JPG)).status, 400)
  assert.equal(llamadas.length, 0); assert.equal(fila(P_OK).captura_transferencia_url, null)
})
test('el error de archivo no depende de si el pedido existe (no sirve para enumerar)', async () => {
  const a = await subir(P_OK, EXE, 'v.jpg'); const b = await subir(NO_EXISTE, EXE, 'v.jpg')
  assert.deepEqual(a, b)
})
test('archivo demasiado grande (> 10 MB) → 413, nada se sube; justo 10 MB sí pasa', async () => {
  const grande = Buffer.concat([JPG, Buffer.alloc(10 * 1024 * 1024)])                        // > 10 MB
  assert.equal((await subir(P_OK, grande)).status, 413)
  assert.equal(llamadas.length, 0)
  const justo = Buffer.concat([JPG, Buffer.alloc(10 * 1024 * 1024 - JPG.length)])            // exactamente 10 MB
  assert.equal(justo.length, 10 * 1024 * 1024); assert.equal((await subir(P_OK, justo)).status, 200)
})
test('fallo de actualización: se borra el objeto recién subido, 500 sin detalles internos, el pedido queda sin comprobante', async () => {
  fallaUpdate = true
  const r = await subir(P_OK, JPG)
  assert.equal(r.status, 500); assert.deepEqual(r.json, { ok: false, error: 'No se pudo guardar el comprobante' })
  assert.deepEqual(llamadas.map(l => l.metodo), ['upload', 'remove'])
  assert.equal(OBJETOS.has(`capturas/${E1}/pedidos/${P_OK}.jpg`), false)
  assert.equal(fila(P_OK).captura_transferencia_url, null)
})
test('fallo de actualización Y de limpieza: queda el objeto, 500, y se registra [capturas][LIMPIEZA_FALLIDA] con lo necesario para recuperarlo', async () => {
  fallaUpdate = true; fallaRemove = true
  const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  let r
  try { r = await subir(P_OK, JPG) } finally { console.error = orig }
  assert.equal(r.status, 500)
  assert.equal(OBJETOS.has(`capturas/${E1}/pedidos/${P_OK}.jpg`), true)                     // huérfano, pero registrado
  const l = logs.find(x => x.includes('[capturas][LIMPIEZA_FALLIDA]')); assert.ok(l, 'debe registrar la limpieza fallida')
  const dato = JSON.parse(l!.slice(l!.indexOf('{')))
  assert.equal(dato.ruta, `${E1}/pedidos/${P_OK}.jpg`); assert.equal(dato.pedido_id, P_OK); assert.equal(dato.empresa_id, E1); assert.equal(dato.bucket, 'capturas')
  assert.equal(fila(P_OK).captura_transferencia_url, null)
})
test('el pedido cambia de estado mientras se sube (el update condicional no encuentra fila): se borra lo subido y responde 409', async () => {
  const antes = (T.pedidos.find(p => p.id === P_OK)!)
  const orig = globalThis.fetch
  // simula la carrera: justo antes del update, el pedido pasa a PREPARING
  globalThis.fetch = (async (u: RequestInfo | URL, o?: RequestInit) => { if (String(o?.method) === 'PATCH') antes.estado = 'PREPARING'; return orig(u, o) }) as typeof fetch
  let r
  try { r = await subir(P_OK, JPG) } finally { globalThis.fetch = orig }
  assert.deepEqual(r, UNIFORME)
  assert.deepEqual(llamadas.map(l => l.metodo), ['upload', 'remove'])
  assert.equal(OBJETOS.size, 0); assert.equal(antes.captura_transferencia_url, null)
})
test('dos subidas simultáneas al mismo pedido: una gana, la otra recibe 409 y el comprobante ganador no se toca', async () => {
  lentoUpdate = true
  const [a, b] = await Promise.all([subir(P_RACE, JPG), subir(P_RACE, JPG)])
  const estados = [a.status, b.status].sort(); assert.deepEqual(estados, [200, 409])
  assert.equal(fila(P_RACE).captura_transferencia_url, `${E1}/pedidos/${P_RACE}.jpg`)
  assert.ok(OBJETOS.has(`capturas/${E1}/pedidos/${P_RACE}.jpg`))
  assert.equal(llamadas.filter(l => l.metodo === 'remove').length, 0)                       // el perdedor chocó con 409 en Storage: no borró nada
})
test('dos subidas simultáneas con distinta extensión: la perdedora borra SOLO su objeto', async () => {
  lentoUpdate = true
  const [a, b] = await Promise.all([subir(P_RACE, JPG, 'a.jpg', 'image/jpeg'), subir(P_RACE, PNG, 'a.png', 'image/png')])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  const ganadora = String(fila(P_RACE).captura_transferencia_url)
  assert.deepEqual([...OBJETOS.keys()], [`capturas/${ganadora}`])                           // queda un solo objeto: el que está en la base
})
test('modo dígitos (JSON, kiosk) sigue funcionando igual', async () => {
  T.pedidos.push(ped('30000000-0000-4000-8000-00000000000a', E1))
  const r = await POST(new Request('http://x/api/pedidos/comprobante', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pedido_id: '30000000-0000-4000-8000-00000000000a', comprobante: '1234-5678' }) }))
  assert.equal(r.status, 200); assert.equal(T.pedidos.at(-1)!.notas, 'Comprobante: ...12345678')
})
