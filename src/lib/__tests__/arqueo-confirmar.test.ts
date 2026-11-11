// confirmarArqueoStock contra un shim PostgREST EN MEMORIA que solo devuelve lo que la RPC real devolvería.
// Valida el CONTRATO de la lib con la RPC (parámetros enviados, mapeo de resultados/errores, que no haya otras
// llamadas). NO prueba la atomicidad ni la concurrencia: eso es de Postgres y se verifica en staging
// (movimientos persistidos en stock_movimientos, un solo juego de ajustes).
// Ejecutar: npx tsx --test src/lib/__tests__/arqueo-confirmar.test.ts
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { confirmarArqueoStock } from '../arqueo-confirmar'

let server: http.Server
let llamadas: { path: string; method: string; body: Record<string, unknown> | undefined }[] = []
let respuesta: { status: number; body: unknown } | 'cortar' = { status: 200, body: { ok: true, ya_confirmado: false, ajustados: 0 } }
const EMP = 'e0000000-0000-4000-8000-000000000001', ARQ = 'a0000000-0000-4000-8000-000000000001'
let sb: ReturnType<typeof createClient>

before(async () => {
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      llamadas.push({ path: req.url!, method: req.method!, body: raw ? JSON.parse(raw) : undefined })
      if (respuesta === 'cortar') return req.socket.destroy()
      res.writeHead(respuesta.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(respuesta.body))
    })
  })
  const port = await new Promise<number>(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)))
  sb = createClient(`http://127.0.0.1:${port}`, 'anon-de-prueba', { auth: { persistSession: false, autoRefreshToken: false } })
})
after(() => server?.close())
beforeEach(() => { llamadas = []; respuesta = { status: 200, body: { ok: true, ya_confirmado: false, ajustados: 3 } } })

const confirmar = (por = 'Luci') => confirmarArqueoStock(sb, { empresaId: EMP, arqueoId: ARQ, confirmadoPor: por, nombreProducto: id => id, formatFecha: f => f })
const errRpc = (message: string, code = 'P0001') => ({ status: 400, body: { code, message, details: null, hint: null } })

describe('confirmarArqueoStock → RPC confirmar_arqueo_stock', () => {
  test('éxito: una sola llamada a la RPC con los 3 parámetros, y ajustados del resultado', async () => {
    const r = await confirmar()
    assert.deepEqual(r, { ok: true, ajustados: 3 })
    assert.equal(llamadas.length, 1)
    assert.equal(llamadas[0].path, '/rest/v1/rpc/confirmar_arqueo_stock'); assert.equal(llamadas[0].method, 'POST')
    assert.deepEqual(llamadas[0].body, { p_empresa_id: EMP, p_arqueo_id: ARQ, p_confirmado_por: 'Luci' })
  })
  test('no toca ajustar_stock ni lee/escribe tablas directamente', async () => {
    await confirmar(); assert.ok(llamadas.every(l => l.path === '/rest/v1/rpc/confirmar_arqueo_stock'))
  })
  test('éxito con 0 ajustes (arqueo sin diferencias) sigue siendo ok', async () => {
    respuesta = { status: 200, body: { ok: true, ya_confirmado: false, ajustados: 0 } }
    assert.deepEqual(await confirmar(), { ok: true, ajustados: 0 })
  })
  test('ya_confirmado: ok=false + yaConfirmado=true, sin ajustados (se distingue del éxito)', async () => {
    respuesta = { status: 200, body: { ok: true, ya_confirmado: true, ajustados: 0 } }
    const r = await confirmar(); assert.equal(r.ok, false); assert.equal(r.yaConfirmado, true); assert.equal(r.ajustados, undefined)
  })
  test('ARQUEO_NO_PENDIENTE (puede ser descartado o confirmado) → NO afirma "ya confirmado"', async () => {
    respuesta = errRpc('ARQUEO_NO_PENDIENTE'); const r = await confirmar()
    assert.equal(r.ok, false); assert.ok(!r.yaConfirmado); assert.match(r.error!, /ya no está pendiente/); assert.doesNotMatch(r.error!, /confirmado\./i)
  })
  test('ARQUEO_NO_ENCONTRADO → error propio, sin yaConfirmado', async () => {
    respuesta = errRpc('ARQUEO_NO_ENCONTRADO'); const r = await confirmar()
    assert.equal(r.ok, false); assert.ok(!r.yaConfirmado); assert.match(r.error!, /No se encontró/)
  })
  test('DIFERENCIA_NO_ENTERA → error propio, sin yaConfirmado', async () => {
    respuesta = errRpc('DIFERENCIA_NO_ENTERA'); const r = await confirmar()
    assert.equal(r.ok, false); assert.ok(!r.yaConfirmado); assert.match(r.error!, /entero/)
  })
  test('FORBIDDEN (42501) → sin permiso, sin yaConfirmado', async () => {
    respuesta = errRpc('FORBIDDEN', '42501'); const r = await confirmar()
    assert.equal(r.ok, false); assert.ok(!r.yaConfirmado); assert.match(r.error!, /permiso/)
  })
  test('42501 con otro mensaje (RLS/permiso) → también "sin permiso"', async () => {
    respuesta = errRpc('permission denied for function confirmar_arqueo_stock', '42501')
    assert.match((await confirmar()).error!, /permiso/)
  })
  test('error desconocido de la RPC → genérico, ok=false, sin yaConfirmado, no promete "nada aplicado"', async () => {
    respuesta = errRpc('boom', 'XX000'); const r = await confirmar()
    assert.equal(r.ok, false); assert.ok(!r.yaConfirmado); assert.match(r.error!, /Reintentá/); assert.doesNotMatch(r.error!, /no se aplicó/i)
  })
  test('5xx → genérico con aviso de reintento seguro', async () => {
    respuesta = { status: 503, body: { message: 'upstream' } }; const r = await confirmar()
    assert.equal(r.ok, false); assert.match(r.error!, /no se repite ningún ajuste/)
  })
  test('conexión cortada (resultado ambiguo) → error de reintento, NO éxito y NO yaConfirmado', async () => {
    respuesta = 'cortar'; const r = await confirmar()
    assert.equal(r.ok, false); assert.ok(!r.yaConfirmado); assert.match(r.error!, /Reintentá/)
  })
  test('firma compatible: sin nombreProducto/formatFecha también funciona', async () => {
    assert.equal((await confirmarArqueoStock(sb, { empresaId: EMP, arqueoId: ARQ, confirmadoPor: 'x' })).ok, true)
  })
  describe('respuesta inesperada SIN error → nunca éxito', () => {
    const malas: [string, unknown][] = [
      ['null', null], ['objeto vacío', {}], ['array', []], ['string', 'ok'], ['sin ok', { ya_confirmado: false, ajustados: 3 }],
      ['ok=false', { ok: false, ya_confirmado: false, ajustados: 3 }], ['ok como string', { ok: 'true', ya_confirmado: false, ajustados: 3 }],
      ['sin ya_confirmado', { ok: true, ajustados: 3 }], ['ya_confirmado no booleano', { ok: true, ya_confirmado: 'no', ajustados: 3 }],
      ['sin ajustados', { ok: true, ya_confirmado: false }], ['ajustados string', { ok: true, ya_confirmado: false, ajustados: '3' }],
      ['ajustados decimal', { ok: true, ya_confirmado: false, ajustados: 1.5 }], ['ajustados negativo', { ok: true, ya_confirmado: false, ajustados: -1 }],
    ]
    for (const [n, body] of malas) test(n, async () => {
      respuesta = { status: 200, body }; const r = await confirmar()
      assert.equal(r.ok, false); assert.ok(!r.yaConfirmado); assert.equal(r.ajustados, undefined); assert.match(r.error!, /Respuesta inesperada/); assert.match(r.error!, /reintentar es seguro/)
    })
  })
  test('el mismo arqueo confirmado dos veces: la 2ª respuesta ya_confirmado no se confunde con éxito', async () => {
    const a = await confirmar()
    respuesta = { status: 200, body: { ok: true, ya_confirmado: true, ajustados: 0 } }
    const b = await confirmar()
    assert.equal(a.ok, true); assert.equal(b.ok, false); assert.equal(b.yaConfirmado, true)
  })
})
