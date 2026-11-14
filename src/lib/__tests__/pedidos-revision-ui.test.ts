// POSIBLE DUPLICADO · pieza pura (compararPedidos) y UI de Vista Caja renderizada (renderToStaticMarkup). Ejecutar: npx tsx --test src/lib/__tests__/pedidos-revision-ui.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compararPedidos, type RevisionVista, type ItemComparable } from '../pedidos/revision'
import RevisionDuplicado, { BadgeRevision, TEXTO_ESPERANDO, textoPosibleDuplicado } from '../../components/operacion/RevisionDuplicado'

const it = (nombre: string, cantidad: number, opciones: string[] = [], presentacion = 'Unidad'): ItemComparable => ({ nombre, presentacion, cantidad, opciones })

describe('compararPedidos (datos reales: producto, presentación, sabores, cantidad)', () => {
  test('idénticos aunque cambie el orden o el agrupamiento de las líneas', () => {
    const r = compararPedidos([it('Helado', 1, ['Chocolate']), it('Helado', 1, ['Chocolate']), it('Alfajor', 2)], [it('Alfajor', 2), it('Helado', 2, ['Chocolate'])])
    assert.equal(r.identicos, true); assert.deepEqual(r.lineas.map(l => l.estado), ['igual', 'igual'])
  })
  test('cantidad distinta, sabor distinto, producto solo de un lado', () => {
    const r = compararPedidos([it('Alfajor', 3), it('Helado', 1, ['Dulce de leche']), it('Gaseosa', 1)], [it('Alfajor', 2), it('Helado', 1, ['Chocolate']), it('Torta', 1)])
    const e = Object.fromEntries(r.lineas.map(l => [`${l.nombre}|${l.opciones.join(',')}`, [l.nuevo, l.candidato, l.estado]]))
    assert.deepEqual(e['Alfajor|'], [3, 2, 'distinto']); assert.deepEqual(e['Helado|Dulce de leche'], [1, 0, 'solo_nuevo']); assert.deepEqual(e['Helado|Chocolate'], [0, 1, 'solo_candidato'])
    assert.deepEqual(e['Gaseosa|'], [1, 0, 'solo_nuevo']); assert.deepEqual(e['Torta|'], [0, 1, 'solo_candidato']); assert.equal(r.identicos, false)
  })
  test('el orden de las opciones no cambia la identidad de la línea', () => { assert.equal(compararPedidos([it('Helado', 1, ['A', 'B'])], [it('Helado', 1, ['B', 'A'])]).identicos, true) })
})

const rev = (extra: Partial<RevisionVista> = {}): RevisionVista => ({
  estado: 'PENDIENTE', coincidencia: 'DISTINTA', creado_at: '2026-11-14T15:00:00Z', resuelto_at: null, reembolso_pendiente: false, reembolso_gestionado_at: null, stock_devuelto: false,
  candidatos: [
    { numero_pedido: 43, created_at: '2026-11-14T14:40:00Z', estado: 'PENDING_PAYMENT', cliente: 'Sandra', items: [it('Alfajor', 2)], comparacion: compararPedidos([it('Alfajor', 3)], [it('Alfajor', 2)]) },
    { numero_pedido: 41, created_at: '2026-11-14T14:10:00Z', estado: 'PREPARING', cliente: null, items: [it('Torta', 1)], comparacion: compararPedidos([it('Alfajor', 3)], [it('Torta', 1)]) },
  ], ...extra })
const html = (r: RevisionVista) => renderToStaticMarkup(createElement(RevisionDuplicado, { revision: r, pedidoId: 'p', numeroPedido: 49, dispositivoId: 'd', operadorId: 'o', onResuelto: () => {} }))

describe('Vista Caja · RevisionDuplicado', () => {
  test('PENDIENTE: textos pedidos por el CTO, todos los candidatos con número/hora/estado/cliente, comparación marcada y las dos acciones de Luci', () => {
    const h = html(rev())
    assert.ok(h.includes('ESPERANDO VER SI ES UN PEDIDO DUPLICADO') && h.includes(TEXTO_ESPERANDO))
    assert.ok(h.includes('POSIBLE DUPLICADO DEL PEDIDO #43, #41') && textoPosibleDuplicado(rev()) === 'POSIBLE DUPLICADO DEL PEDIDO #43, #41')
    assert.ok(h.includes('#43') && h.includes('Sandra') && h.includes('Pendiente') && h.includes('#41') && h.includes('Preparando'))
    assert.ok(h.includes('≠ cantidad distinta') && h.includes('Es legítimo') && h.includes('Es duplicado') && h.includes('no se puede cobrar ni preparar'))
  })
  test('IDENTICA se dice; el contenido igual se marca', () => {
    const h = html(rev({ coincidencia: 'IDENTICA', candidatos: [{ numero_pedido: 43, created_at: '2026-11-14T14:40:00Z', estado: 'PREPARING', cliente: 'Sandra', items: [], comparacion: compararPedidos([it('Alfajor', 2)], [it('Alfajor', 2)]) }] }))
    assert.ok(h.includes('idéntico') && h.includes('= igual') && h.includes('exactamente el mismo contenido'))
  })
  test('DUPLICADO ya pagado por MP: indicación de reembolso MANUAL pendiente, sin simular que se devolvió, con la acción de constancia', () => {
    const h = html(rev({ estado: 'DUPLICADO', resuelto_at: '2026-11-14T15:05:00Z', reembolso_pendiente: true, stock_devuelto: true }))
    assert.ok(h.includes('PEDIDO DUPLICADO') && h.includes('NO SE PREPARA') && h.includes('PAGADO por Mercado Pago') && h.includes('A MANO') && h.includes('reembolso pendiente de gestión') && h.includes('Ya lo reembolsé'))
    assert.ok(!h.includes('Es legítimo') && !h.includes('Es duplicado') && h.includes('El stock ya fue devuelto'))
  })
  test('reembolso ya gestionado: queda la constancia y no el botón; devolución de stock incompleta: se ofrece completarla', () => {
    const h = html(rev({ estado: 'DUPLICADO', resuelto_at: '2026-11-14T15:05:00Z', reembolso_pendiente: true, reembolso_gestionado_at: '2026-11-14T16:00:00Z' }))
    assert.ok(h.includes('Reembolso gestionado a mano') && !h.includes('Ya lo reembolsé') && h.includes('Completar devolución de stock'))
  })
  test('DUPLICADO sin pago MP: no hay cartel de reembolso', () => { assert.ok(!html(rev({ estado: 'DUPLICADO', resuelto_at: '2026-11-14T15:05:00Z', stock_devuelto: true })).includes('Mercado Pago')) })
  test('etiquetas de la lista', () => {
    assert.ok(renderToStaticMarkup(createElement(BadgeRevision, { r: rev() })).includes('¿DUPLICADO?'))
    assert.ok(renderToStaticMarkup(createElement(BadgeRevision, { r: rev({ estado: 'DUPLICADO' }) })).includes('DUPLICADO'))
    assert.equal(renderToStaticMarkup(createElement(BadgeRevision, { r: null })), '')
  })
})
