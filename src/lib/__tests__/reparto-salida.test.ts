import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirSalida, distanciaMetros, minutosEntrega, UMBRAL_SALIDA_M } from '../reparto/salida'
const L = { lat: -35.66, lng: -63.75 }
test('distancia: ~111 m por cada 0.001° de latitud', () => { const d = distanciaMetros(L, { lat: -35.661, lng: -63.75 }); assert.ok(d > 105 && d < 117, String(d)) })
test('sin pedidos pendientes: nada (o limpia el punto si había)', () => { assert.equal(decidirSalida(null, L, 0), 'nada'); assert.equal(decidirSalida(L, L, 0), 'limpiar_base') })
test('con pendientes y sin punto: fija el punto', () => assert.equal(decidirSalida(null, L, 1), 'fijar_base'))
test('dentro del umbral: nada; en el umbral o más: salió', () => {
  assert.equal(decidirSalida(L, { lat: -35.66018, lng: -63.75 }, 2), 'nada')
  assert.ok(UMBRAL_SALIDA_M >= 50)
  assert.equal(decidirSalida(L, { lat: -35.6609, lng: -63.75 }, 1), 'salio')
})
test('minutosEntrega: mismas reglas que la función SQL', () => {
  const t0 = '2026-11-08T20:00:00.000Z'
  assert.equal(minutosEntrega(t0, '2026-11-08T20:25:00.000Z'), 25)
  assert.equal(minutosEntrega(null, '2026-11-08T20:25:00.000Z'), null)      // sin salida registrada
  assert.equal(minutosEntrega(t0, null), null)
  assert.equal(minutosEntrega('2026-11-08T20:30:00.000Z', t0), null)        // entrega antes de la salida
  assert.equal(minutosEntrega(t0, '2026-11-09T00:00:00.000Z'), 240)         // 240 min exactos entran
  assert.equal(minutosEntrega(t0, '2026-11-09T00:01:00.000Z'), null)        // más de 240 se descartan
  assert.equal(minutosEntrega(t0, '2026-11-08T23:59:00.000Z'), 239)
})
