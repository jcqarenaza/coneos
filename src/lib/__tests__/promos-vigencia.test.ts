// Vigencia de promos con hora. Ejecutar: npx tsx --test src/lib/__tests__/promos-vigencia.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { promoVigente, textoVigencia, ahoraArgentina } from '../promos/vigencia'

const ar = (fechaHora: string) => ({ fecha: fechaHora.slice(0, 10), fechaHora })
const NOCHE = { vigencia_desde: '2026-11-18', vigencia_hasta: '2026-11-19', hora_desde: '18:00:00', hora_hasta: '02:00:00' }

describe('promo del 18/11 18:00 al 19/11 02:00', () => {
  test('antes de empezar: no rige', () => {
    assert.equal(promoVigente(NOCHE, ar('2026-11-18 17:59')), false)
    assert.equal(promoVigente(NOCHE, ar('2026-11-18 09:00')), false)
  })
  test('rige desde las 18:00 y durante la madrugada', () => {
    assert.equal(promoVigente(NOCHE, ar('2026-11-18 18:00')), true)
    assert.equal(promoVigente(NOCHE, ar('2026-11-18 23:59')), true)
    assert.equal(promoVigente(NOCHE, ar('2026-11-19 00:30')), true)
    assert.equal(promoVigente(NOCHE, ar('2026-11-19 01:59')), true)
  })
  test('a las 02:00 del 19 deja de regir', () => {
    assert.equal(promoVigente(NOCHE, ar('2026-11-19 02:00')), false)
    assert.equal(promoVigente(NOCHE, ar('2026-11-19 18:00')), false)
  })
})

describe('compatibilidad: sin horas se comporta como antes (solo fechas)', () => {
  const SOLO_FECHAS = { vigencia_desde: '2026-11-18', vigencia_hasta: '2026-11-19' }
  test('rige todo el día de inicio y todo el día de cierre', () => {
    assert.equal(promoVigente(SOLO_FECHAS, ar('2026-11-17 23:59')), false)
    assert.equal(promoVigente(SOLO_FECHAS, ar('2026-11-18 00:00')), true)
    assert.equal(promoVigente(SOLO_FECHAS, ar('2026-11-19 23:59')), true)
    assert.equal(promoVigente(SOLO_FECHAS, ar('2026-11-20 00:00')), false)
  })
  test('sin vigencia: siempre rige', () => { assert.equal(promoVigente({}, ar('2030-01-01 12:00')), true) })
  test('solo hora de cierre o solo hora de inicio', () => {
    assert.equal(promoVigente({ vigencia_desde: '2026-11-18', hora_desde: '18:00' }, ar('2026-11-18 17:00')), false)
    assert.equal(promoVigente({ vigencia_desde: '2026-11-18', hora_desde: '18:00' }, ar('2026-11-25 10:00')), true)
    assert.equal(promoVigente({ vigencia_hasta: '2026-11-19', hora_hasta: '02:00' }, ar('2026-11-19 01:00')), true)
    assert.equal(promoVigente({ vigencia_hasta: '2026-11-19', hora_hasta: '02:00' }, ar('2026-11-19 03:00')), false)
  })
  test('hora sin fecha se ignora (la pantalla no lo permite guardar)', () => {
    assert.equal(promoVigente({ hora_desde: '18:00', hora_hasta: '02:00' }, ar('2026-11-18 10:00')), true)
  })
})

describe('utilidades', () => {
  test('textoVigencia', () => {
    assert.equal(textoVigencia('2026-11-18', '18:00:00'), '18/11/2026 18:00')
    assert.equal(textoVigencia('2026-11-19', null), '19/11/2026')
    assert.equal(textoVigencia(null, '18:00'), '')
  })
  test('ahoraArgentina usa la hora de Buenos Aires (UTC-3)', () => {
    const a = ahoraArgentina(new Date('2026-11-19T05:30:00Z'))
    assert.deepEqual(a, { fecha: '2026-11-19', fechaHora: '2026-11-19 02:30' })
    assert.equal(ahoraArgentina(new Date('2026-11-19T02:59:00Z')).fechaHora, '2026-11-18 23:59')
  })
})
