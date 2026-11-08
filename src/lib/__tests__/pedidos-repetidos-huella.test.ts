// Huella del contenido comercial + orquestación del reclamo (sin red ni base). Ejecutar: npx tsx --test src/lib/__tests__/pedidos-repetidos-huella.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { errorProbadoSinPedido, calcularHuella, reclamarOperacion, soloDigitos, esUuid, ERRORES_CREAR_CON_ROLLBACK_DEMOSTRADO, type ItemHuella } from '../pedidos/repetidos'
import { firmaDelivery, operacionPara } from '../pedidos/operacion-cliente'
import { validarMinutosRepetidos } from '../pedidos/repetidos-config'

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

describe('errorProbadoSinPedido: LISTA EXPLÍCITA de rollback demostrado (revisión CTO 8/11)', () => {
  test('cada rechazo de la lista (P0001 + mensaje de la RPC, con o sin sufijo ":detalle") prueba que no hay pedido', () => {
    for (const n of ERRORES_CREAR_CON_ROLLBACK_DEMOSTRADO) {
      assert.equal(errorProbadoSinPedido({ code: 'P0001', message: n }), true, n)
      assert.equal(errorProbadoSinPedido({ code: 'P0001', message: `${n}:Alfajor` }), true, n + ':detalle')
    }
  })
  test('deadlock_detected (40P01) está en la lista: PostgreSQL aborta la transacción antes de responder', () => {
    assert.equal(errorProbadoSinPedido({ code: '40P01', message: 'deadlock detected' }), true)
  })
  test('NO se libera ante un P0001 con mensaje desconocido, ni ante CUALQUIER otro SQLSTATE aunque tenga 5 caracteres', () => {
    assert.equal(errorProbadoSinPedido({ code: 'P0001', message: 'ALGO_NUEVO' }), false)
    assert.equal(errorProbadoSinPedido({ code: 'P0001', message: 'PEDIDO_NO_CORRESPONDE_A_LA_OPERACION' }), false)
    assert.equal(errorProbadoSinPedido({ code: 'P0001' }), false)
    for (const code of ['22P02', '23514', '23503', '40001', '57014', '42883', '42501', '25006', 'XX000', '53200', '55P03'])
      assert.equal(errorProbadoSinPedido({ code, message: 'SIN_STOCK:x' }), false, code)
  })
  test('transporte, timeout, gateway, respuesta sin código o ausente: AMBIGUO → no se libera', () => {
    for (const e of [null, undefined, {}, { code: '' }, { code: null }, { code: 'PGRST000' }, { code: 'PGRST301' }, { code: 'ECONNRESET' }, { code: '502' }, { message: 'SIN_STOCK:x' }]) assert.equal(errorProbadoSinPedido(e as never), false, JSON.stringify(e))
  })
  test('conexión (08xxx), apagado/cancelación del servidor (57Pxx), estado desconocido (40003) y unicidad (23505: el pedido PUEDE existir): no se libera', () => {
    for (const code of ['08006', '08003', '57P01', '57P03', '40003', '23505']) assert.equal(errorProbadoSinPedido({ code, message: 'SIN_STOCK' }), false, code)
  })
  test('SINCRONÍA con la base: la lista del código coincide EXACTAMENTE con los RAISE EXCEPTION de crear-pedido-stock-v1.7-operacion.sql (salvo PRECHECK)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/crear-pedido-stock-v1.7-operacion.sql'), 'utf8')
    const enSql = new Set([...sql.matchAll(/raise exception '([A-Z_]+)/g)].map(m => m[1]).filter(x => x !== 'PRECHECK'))
    assert.deepEqual([...enSql].sort(), [...ERRORES_CREAR_CON_ROLLBACK_DEMOSTRADO].sort())
  })
})

describe('huella: combos (combo_ref) — revisión CTO 8/11', () => {
  const it = (pres: string, slot: string, ref: string, extra = {}) => ({ presentacion_id: pres, cantidad: 1, promo_id: 'PROMO', promo_slot_id: slot, combo_ref: ref, opciones: [], ...extra })
  const hf = (items: ItemHuella[]) => calcularHuella({ sucursal_id: 'S', tipo_pedido: 'kiosk', origen: 'KIOSK', items })
  test('el MISMO carrito con combo_ref NUEVO (reintento, otra sesión) conserva la huella: el uuid aleatorio no entra crudo', () => {
    assert.equal(hf([it('pizzaA', 's1', 'ref-1'), it('beb-X', 's2', 'ref-1')]), hf([it('pizzaA', 's1', 'ref-9'), it('beb-X', 's2', 'ref-9')]))
  })
  test('elecciones CRUZADAS entre dos instancias del mismo combo → huellas DISTINTAS (A+X y B+Y ≠ A+Y y B+X)', () => {
    const ax_by = hf([it('pizzaA', 's1', 'r1'), it('beb-X', 's2', 'r1'), it('pizzaB', 's1', 'r2'), it('beb-Y', 's2', 'r2')])
    const ay_bx = hf([it('pizzaA', 's1', 'r1'), it('beb-Y', 's2', 'r1'), it('pizzaB', 's1', 'r2'), it('beb-X', 's2', 'r2')])
    assert.notEqual(ax_by, ay_bx)
  })
  test('dos instancias idénticas ≠ una sola; el orden de los componentes y de las instancias no cambia la huella', () => {
    const una = hf([it('pizzaA', 's1', 'r1'), it('beb-X', 's2', 'r1')])
    const dos = hf([it('pizzaA', 's1', 'r1'), it('beb-X', 's2', 'r1'), it('pizzaA', 's1', 'r2'), it('beb-X', 's2', 'r2')])
    const dosOtroOrden = hf([it('beb-X', 's2', 'r2'), it('pizzaA', 's1', 'r2'), it('beb-X', 's2', 'r1'), it('pizzaA', 's1', 'r1')])
    assert.notEqual(una, dos); assert.equal(dos, dosOtroOrden)
  })
  test('las opciones de un componente y la promoción distinguen la instancia; un combo no se confunde con las mismas presentaciones sueltas', () => {
    const base = hf([it('pizzaA', 's1', 'r1'), it('beb-X', 's2', 'r1')])
    assert.notEqual(base, hf([it('pizzaA', 's1', 'r1', { opciones: [{ opcion_id: 'extra-queso' }] }), it('beb-X', 's2', 'r1')]))
    assert.notEqual(base, hf([it('pizzaA', 's1', 'r1', { promo_id: 'OTRA' }), it('beb-X', 's2', 'r1', { promo_id: 'OTRA' })]))
    assert.notEqual(base, hf([{ presentacion_id: 'pizzaA', cantidad: 1, opciones: [] }, { presentacion_id: 'beb-X', cantidad: 1, opciones: [] }]))
  })
  test('sin combos la huella es la de siempre (compatibilidad)', () => {
    assert.equal(hf([{ presentacion_id: 'p', cantidad: 1, opciones: [] }, { presentacion_id: 'p', cantidad: 1, opciones: [] }]), hf([{ presentacion_id: 'p', cantidad: 2, opciones: [] }]))
  })
})

describe('cliente: firma de Delivery y validación de minutos (revisión CTO 8/11)', () => {
  const base = { items: [{ p: 1, q: 1 }], canal: 'delivery', metodo: 'efectivo', horaRetiro: null as string | null, costoEnvio: 500, datos: { nombre: 'Ana', telefono: '1122334455', direccion: 'Calle 1', entre_calles: null }, esTakeaway: false, dispositivo: 'disp-1' }
  test('la misma compra tiene la misma firma (el reintento reutiliza la operación)', () => { assert.equal(firmaDelivery(base), firmaDelivery({ ...base })) })
  test('cambiar método de pago, horario, costo de envío, dirección, nombre, teléfono, canal o ítems → OTRA operación', () => {
    const f0 = firmaDelivery(base)
    for (const c of [{ metodo: 'mp' }, { metodo: 'transferencia' }, { horaRetiro: '2026-11-08T21:00:00Z' }, { costoEnvio: 800 }, { canal: 'takeaway', esTakeaway: true },
      { datos: { ...base.datos, direccion: 'Calle 2' } }, { datos: { ...base.datos, nombre: 'Beto' } }, { datos: { ...base.datos, telefono: '1199999999' } }, { datos: { ...base.datos, entre_calles: 'A y B' } }, { items: [{ p: 1, q: 2 }] }])
      assert.notEqual(firmaDelivery({ ...base, ...c }), f0, JSON.stringify(c))
  })
  test('operacionPara: misma firma conserva el id; firma distinta genera un id nuevo', () => {
    const a = operacionPara(null, firmaDelivery(base)); assert.equal(operacionPara(a, firmaDelivery(base)).id, a.id)
    assert.notEqual(operacionPara(a, firmaDelivery({ ...base, metodo: 'mp' })).id, a.id)
  })
  test('validarMinutosRepetidos: solo enteros 1..1440; el texto "1.5", "1,5", "1e2", vacío, negativo o 1441 NO valen (y nunca se truncan en silencio)', () => {
    for (const ok of ['1', '30', '1440', ' 45 ', '007']) assert.deepEqual(validarMinutosRepetidos(ok), { ok: true, minutos: Number(ok.trim()) }, ok)
    for (const mal of ['', ' ', '0', '1441', '-3', '1.5', '1,5', '1e2', '30 min', 'abc', null, undefined, 30.5]) assert.deepEqual(validarMinutosRepetidos(mal), { ok: false }, String(mal))
  })
})
