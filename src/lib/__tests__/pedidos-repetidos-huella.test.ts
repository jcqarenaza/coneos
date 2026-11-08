// Huella del contenido comercial + orquestación del reclamo (sin red ni base). Ejecutar: npx tsx --test src/lib/__tests__/pedidos-repetidos-huella.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcularHuella, reclamarOperacion, soloDigitos, esUuid } from '../pedidos/repetidos'

const S1 = 's1', S2 = 's2'
const base = { sucursal_id: S1, tipo_pedido: 'delivery', origen: 'DELIVERY', items: [{ presentacion_id: 'p1', cantidad: 2, opciones: [{ opcion_id: 'o1' }, { opcion_id: 'o2' }] }, { presentacion_id: 'p2', cantidad: 1 }] }
const h = (cambios: Record<string, unknown> = {}) => calcularHuella({ ...base, ...cambios } as Parameters<typeof calcularHuella>[0])

describe('calcularHuella', () => {
  test('mismo contenido → misma huella (orden de líneas y de opciones no importa; líneas repetidas se suman)', () => {
    assert.equal(h(), h({ items: [{ presentacion_id: 'p2', cantidad: 1 }, { presentacion_id: 'p1', cantidad: 2, opciones: [{ opcion_id: 'o2' }, { opcion_id: 'o1' }] }] }))
    assert.equal(h({ items: [{ presentacion_id: 'p1', cantidad: 1 }, { presentacion_id: 'p1', cantidad: 1 }] }), h({ items: [{ presentacion_id: 'p1', cantidad: 2 }] }))
  })
  test('7) cantidades diferentes → distinta', () => { assert.notEqual(h(), h({ items: [{ ...base.items[0], cantidad: 3 }, base.items[1]] })) })
  test('8) opciones o variantes (presentación) diferentes → distinta', () => {
    assert.notEqual(h(), h({ items: [{ ...base.items[0], opciones: [{ opcion_id: 'o1' }] }, base.items[1]] }))
    assert.notEqual(h(), h({ items: [{ ...base.items[0], opciones: [{ opcion_id: 'o1' }, { opcion_id: 'o3' }] }, base.items[1]] }))
    assert.notEqual(h(), h({ items: [{ ...base.items[0], presentacion_id: 'p9' }, base.items[1]] }))
  })
  test('promo/slot distinto → distinta (mismo producto suelto no es lo mismo que dentro de un combo)', () => {
    assert.notEqual(h({ items: [{ presentacion_id: 'p1', cantidad: 1 }] }), h({ items: [{ presentacion_id: 'p1', cantidad: 1, promo_id: 'pr1', promo_slot_id: 'sl1' }] }))
  })
  test('modalidad (tipo, origen, mesa) y sucursal cuentan', () => {
    assert.notEqual(h(), h({ tipo_pedido: 'takeaway' })); assert.notEqual(h(), h({ origen: 'KIOSK' })); assert.notEqual(h(), h({ sucursal_id: S2 }))
    assert.notEqual(h({ tipo_pedido: 'mesa', origen: 'MESA', numero_mesa: 5 }), h({ tipo_pedido: 'mesa', origen: 'MESA', numero_mesa: 6 }))
  })
  test('el importe/precio NO entra (deriva de los ítems): no hay forma de esquivarlo variando el precio enviado', () => {
    assert.equal(h({ items: [{ ...base.items[0], precio_snap: 1 }, base.items[1]] } as never), h())
  })
})
describe('identidad y entradas', () => {
  test('soloDigitos: exige 6+ dígitos', () => { assert.equal(soloDigitos('(11) 2233-4455'), '1122334455'); assert.equal(soloDigitos('123'), null); assert.equal(soloDigitos(undefined), null) })
  test('esUuid', () => { assert.ok(esUuid('7b1f6c4e-3a2d-4b8e-9c5a-1f2e3d4c5b6a')); for (const x of ['', 'abc', 5, null, undefined, {}]) assert.equal(esUuid(x), false) })
})
describe('reclamarOperacion (orquestación)', () => {
  const args = { empresa_id: 'e', sucursal_id: 's', operacion_id: 'o', huella: 'h', telefono: null, visitante: null, dispositivo_id: null, confirmar: false }
  const rpcDe = (...rs: Array<{ data?: unknown; error?: { message: string } | null } | Error>) => { let i = 0; return { rpc: async () => { const r = rs[Math.min(i++, rs.length - 1)]; if (r instanceof Error) throw r; return { data: r.data ?? null, error: r.error ?? null } } } }
  const sinEspera = { dormir: async () => {}, intentos: 3 }
  test('estados directos', async () => {
    assert.deepEqual(await reclamarOperacion(rpcDe({ data: { estado: 'NUEVA' } }), args), { tipo: 'NUEVA' })
    assert.deepEqual(await reclamarOperacion(rpcDe({ data: { estado: 'EXISTENTE', pedido_id: 'p' } }), args), { tipo: 'EXISTENTE', pedido_id: 'p' })
    assert.deepEqual(await reclamarOperacion(rpcDe({ data: { estado: 'OPERACION_INVALIDA' } }), args), { tipo: 'OPERACION_INVALIDA' })
    const d = await reclamarOperacion(rpcDe({ data: { estado: 'DUPLICADO', ventana_minutos: 30, existente: { pedido_id: 'p', numero_pedido: 7, estado: 'PAID' } } }), args)
    assert.deepEqual(d, { tipo: 'DUPLICADO', ventana_minutos: 30, existente: { pedido_id: 'p', numero_pedido: 7, estado: 'PAID' } })
  })
  test('EN_CURSO espera y resuelve al completarse; si no se completa nunca, EN_PROCESO (no crea nada)', async () => {
    assert.deepEqual(await reclamarOperacion(rpcDe({ data: { estado: 'EN_CURSO' } }, { data: { estado: 'EN_CURSO' } }, { data: { estado: 'EXISTENTE', pedido_id: 'p' } }), args, sinEspera), { tipo: 'EXISTENTE', pedido_id: 'p' })
    assert.deepEqual(await reclamarOperacion(rpcDe({ data: { estado: 'EN_CURSO' } }), args, sinEspera), { tipo: 'EN_PROCESO' })
  })
  test('error de la base, excepción o estado desconocido: SIN_PROTECCION (jamás se frena una venta)', async () => {
    for (const r of [{ error: { message: 'no existe la función' } }, new Error('boom'), { data: { estado: 'RARO' } }, { data: null }])
      assert.deepEqual(await reclamarOperacion(rpcDe(r as never), args), { tipo: 'SIN_PROTECCION' })
  })
})
