// Bloqueo de duplicados (opción C, CTO 13/11): piezas puras (alcance, parámetros enviados a la RPC, lectura de la llave) y componente.
// Ejecutar: npx tsx --test src/lib/__tests__/pedidos-bloqueo-unit.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { esAlcanceBloqueo, reclamarOperacion, leerLlaveBloqueo, MENSAJE_BLOQUEO_IDENTICO, MENSAJE_PEDIDO_ACTIVO } from '../pedidos/repetidos'
import AdvertenciaPedidoRepetido, { TEXTO_PEDIDO_REPETIDO } from '../../components/pedidos/AdvertenciaPedidoRepetido'

const base = { empresa_id: 'e', sucursal_id: 's', operacion_id: 'o', huella: 'h', telefono: '2302514650', visitante: null, dispositivo_id: null, confirmar: false }
const rpcCon = (respuesta: unknown, cap?: Record<string, unknown>[]) => ({ rpc: async (_f: string, a: Record<string, unknown>) => { cap?.push(a); return { data: respuesta, error: null } } })

describe('alcance del bloqueo (solo delivery y take away online)', () => {
  test('delivery y take away: sí (cualquier capitalización)', () => {
    assert.equal(esAlcanceBloqueo({ origen: 'DELIVERY' }), true); assert.equal(esAlcanceBloqueo({ origen: 'TAKEAWAY' }), true); assert.equal(esAlcanceBloqueo({ origen: 'delivery' }), true)
  })
  test('kiosco, mesa, caja y desconocidos: no', () => {
    assert.equal(esAlcanceBloqueo({ origen: 'KIOSK' }), false); assert.equal(esAlcanceBloqueo({ origen: 'MESA' }), false)
    assert.equal(esAlcanceBloqueo({ origen: undefined }), false); assert.equal(esAlcanceBloqueo({ origen: null }), false); assert.equal(esAlcanceBloqueo({ origen: 'CAJA' }), false)
  })
  test('venta de caja o mesa: no, aunque el origen sea de delivery', () => {
    assert.equal(esAlcanceBloqueo({ origen: 'DELIVERY', venta_caja: true }), false); assert.equal(esAlcanceBloqueo({ origen: 'DELIVERY', esMesa: true }), false)
  })
})

describe('reclamarOperacion · parámetros y estados del bloqueo', () => {
  test('sin `bloqueo`: la llamada es la HISTÓRICA de 8 parámetros (sin p_alcance_bloqueo ni p_confirmar_otro)', async () => {
    const cap: Record<string, unknown>[] = []; await reclamarOperacion(rpcCon({ estado: 'NUEVA' }, cap), base)
    assert.deepEqual(Object.keys(cap[0]).sort(), ['p_confirmar', 'p_dispositivo_id', 'p_empresa_id', 'p_huella', 'p_operacion_id', 'p_sucursal_id', 'p_telefono', 'p_visitante'])
  })
  test('con `bloqueo`: manda p_alcance_bloqueo=true y p_confirmar_otro según corresponda', async () => {
    const cap: Record<string, unknown>[] = []
    await reclamarOperacion(rpcCon({ estado: 'NUEVA' }, cap), { ...base, bloqueo: { confirmar_otro: false } }); await reclamarOperacion(rpcCon({ estado: 'NUEVA' }, cap), { ...base, bloqueo: { confirmar_otro: true } })
    assert.equal(cap[0].p_alcance_bloqueo, true); assert.equal(cap[0].p_confirmar_otro, false); assert.equal(cap[1].p_confirmar_otro, true)
  })
  test('BLOQUEADO_IDENTICO y PEDIDO_ACTIVO se mapean con el pedido existente SOLO si es del mismo visitante', async () => {
    const ex = { mismo_visitante: true, pedido_id: 'p1', numero_pedido: 43, estado: 'READY' }
    assert.deepEqual(await reclamarOperacion(rpcCon({ estado: 'BLOQUEADO_IDENTICO', ventana_minutos: 30, existente: ex }), base), { tipo: 'BLOQUEADO_IDENTICO', ventana_minutos: 30, existente: ex })
    assert.deepEqual(await reclamarOperacion(rpcCon({ estado: 'PEDIDO_ACTIVO', ventana_horas: 3, existente: ex }), base), { tipo: 'PEDIDO_ACTIVO', ventana_horas: 3, existente: ex })
  })
  test('PRIVACIDAD (CTO 14/11): sin mismo_visitante === true se descartan id, número y estado, AUNQUE la base los mande (defensa en profundidad)', async () => {
    const vacio = { mismo_visitante: false, pedido_id: null, numero_pedido: null, estado: null }
    for (const existente of [{ mismo_visitante: false }, { mismo_visitante: false, pedido_id: 'p1', numero_pedido: 43, estado: 'READY' }, { pedido_id: 'p1', numero_pedido: 43, estado: 'READY' }, { mismo_visitante: 'true', pedido_id: 'p1' }, undefined]) {
      for (const estado of ['BLOQUEADO_IDENTICO', 'PEDIDO_ACTIVO']) {
        const r = await reclamarOperacion(rpcCon({ estado, ventana_minutos: 30, ventana_horas: 3, existente }), base)
        assert.ok(r.tipo === 'BLOQUEADO_IDENTICO' || r.tipo === 'PEDIDO_ACTIVO'); assert.deepEqual(r.existente, vacio, JSON.stringify(existente))
      }
    }
  })
  test('estado desconocido sigue siendo FAIL-CLOSED (SIN_PROTECCION), no un permiso', async () => {
    const orig = console.error; console.error = () => {}
    try { assert.deepEqual(await reclamarOperacion(rpcCon({ estado: 'ALGO_NUEVO' }), base), { tipo: 'SIN_PROTECCION' }) } finally { console.error = orig }
  })
})

describe('leerLlaveBloqueo · el código convive con la base vieja', () => {
  const cli = (res: { data: unknown; error: { message: string } | null } | 'throw') => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { if (res === 'throw') throw new Error('red'); return res } }) }) }) })
  test('true solo si la columna vale exactamente true', async () => { assert.equal(await leerLlaveBloqueo(cli({ data: { bloquear_pedidos_duplicados: true }, error: null }), 'e'), true) })
  test('false: apagada, fila ausente, columna inexistente (SQL sin aplicar), error de red, valores raros', async () => {
    const w = console.warn; console.warn = () => {}
    try {
      assert.equal(await leerLlaveBloqueo(cli({ data: { bloquear_pedidos_duplicados: false }, error: null }), 'e'), false)
      assert.equal(await leerLlaveBloqueo(cli({ data: null, error: null }), 'e'), false)
      assert.equal(await leerLlaveBloqueo(cli({ data: null, error: { message: 'column does not exist' } }), 'e'), false)
      assert.equal(await leerLlaveBloqueo(cli('throw'), 'e'), false)
      assert.equal(await leerLlaveBloqueo(cli({ data: { bloquear_pedidos_duplicados: 'true' }, error: null }), 'e'), false)
    } finally { console.warn = w }
  })
})

describe('componente · los tres modos', () => {
  const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(AdvertenciaPedidoRepetido, { onVolver: () => {}, ...props } as never))
  test('modo por defecto (advertencia): IDÉNTICO a lo aprobado el 8/11 — texto del CTO, Ver pedido, Volver y "Sí, continuar"', () => {
    const h = html({ numeroPedido: 7, verPedidoHref: '/e/pedido/x', onContinuar: () => {} })
    assert.ok(h.includes('Pedido repetido') && h.includes(TEXTO_PEDIDO_REPETIDO) && h.includes('Ver mi pedido #7') && h.includes('Volver') && h.includes('Sí, continuar'))
  })
  test('bloqueo_identico: SIN "Sí, continuar" ni "Es otro pedido" (aunque se le pase onContinuar); con Ver mi pedido #N y Volver', () => {
    const h = html({ modo: 'bloqueo_identico', numeroPedido: 43, verPedidoHref: '/e/pedido/x', onContinuar: () => {} })
    assert.ok(h.includes('Ver mi pedido #43') && h.includes('Volver') && h.includes(MENSAJE_BLOQUEO_IDENTICO))
    assert.ok(!h.includes('Sí, continuar') && !h.includes('Es otro pedido'))
  })
  test('pedido_activo: acción principal Ver mi pedido, secundaria Volver, y la excepción explícita "Es otro pedido, continuar"', () => {
    const h = html({ modo: 'pedido_activo', numeroPedido: 43, verPedidoHref: '/e/pedido/x', onContinuar: () => {} })
    assert.ok(h.includes('Ver mi pedido #43') && h.includes('Volver') && h.includes('Es otro pedido, continuar') && h.includes(MENSAJE_PEDIDO_ACTIVO))
    assert.ok(!h.includes('Sí, continuar'), 'no es el botón del duplicado idéntico')
    assert.ok(h.indexOf('Ver mi pedido') < h.indexOf('Volver') && h.indexOf('Volver') < h.indexOf('Es otro pedido'), 'jerarquía: ver pedido > volver > excepción')
  })
  test('pedido_activo SIN link (pedido de otro visitante): no hay «Ver mi pedido» ni href; quedan «Volver» y «Es otro pedido, continuar»', () => {
    const h = html({ modo: 'pedido_activo', numeroPedido: null, verPedidoHref: null, onContinuar: () => {} })
    assert.ok(!h.includes('Ver mi pedido') && !h.includes('href=') && !h.includes('/pedido/'))
    assert.ok(h.includes('Volver') && h.includes('Es otro pedido, continuar') && h.includes(MENSAJE_PEDIDO_ACTIVO) && h.indexOf('Volver') < h.indexOf('Es otro pedido'))
  })
  test('pedido_activo sin onContinuar: no hay excepción disponible', () => { assert.ok(!html({ modo: 'pedido_activo', numeroPedido: 1, verPedidoHref: '/x' }).includes('Es otro pedido')) })
  test('sin número de pedido (no se pudo resolver): igual hay Volver', () => { assert.ok(html({ modo: 'bloqueo_identico' }).includes('Volver')) })
})
