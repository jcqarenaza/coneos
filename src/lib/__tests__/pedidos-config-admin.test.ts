// Configuración admin de posibles pedidos duplicados (sin red ni base). Ejecutar: npx tsx --test src/lib/__tests__/pedidos-config-admin.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validarHorasPedidoActivo, validarMinutosRepetidos } from '../pedidos/repetidos-config'

const page = readFileSync(join(__dirname, '../../app/[empresa]/admin/config/page.tsx'), 'utf8')

describe('validarHorasPedidoActivo (mismo rango que el CHECK de la base: 1–24)', () => {
  test('acepta enteros 1..24 (incluido el valor actual 3)', () => {
    for (const v of ['1', '3', '24', ' 12 ', 3]) assert.equal(validarHorasPedidoActivo(v).ok, true, String(v))
    assert.deepEqual(validarHorasPedidoActivo('3'), { ok: true, horas: 3 })
  })
  test('rechaza vacío, 0, 25, negativos, decimales, notación científica y texto', () => {
    for (const v of ['', ' ', '0', '25', '-1', '1.5', '1,5', '1e1', 'abc', null, undefined]) assert.equal(validarHorasPedidoActivo(v).ok, false, String(v))
  })
  test('no altera la validación existente de minutos', () => {
    assert.deepEqual(validarMinutosRepetidos('30'), { ok: true, minutos: 30 })
    assert.equal(validarMinutosRepetidos('1441').ok, false)
  })
})

describe('pantalla Admin → Configuración (misma ubicación, sin sección nueva)', () => {
  test('los dos controles viven en el mismo bloque «repetidos», dentro de la tarjeta Configuración de pedidos', () => {
    assert.equal((page.match(/<ConeCard title="Configuración de pedidos">/g) ?? []).length, 1)
    const tarjeta = page.slice(page.indexOf('<ConeCard title="Configuración de pedidos">'), page.indexOf('<ConeCard title="App instalable (PWA)">'))
    assert.ok(tarjeta.includes('Revisar nuevos pedidos si el teléfono ya tiene uno activo') && tarjeta.includes('pedido_activo_ventana_horas') && tarjeta.includes('pedidos_repetidos_minutos'))
    assert.equal((page.match(/bloquear_pedidos_duplicados: !config\.bloquear_pedidos_duplicados/g) ?? []).length, 1, 'un solo interruptor, sin duplicar controles')
  })
  test('lee y guarda las dos columnas reales, siempre acotado a la empresa autenticada (ctx.empresaId)', () => {
    assert.ok(/select\('[^']*bloquear_pedidos_duplicados, pedido_activo_ventana_horas'\)\.eq\('empresa_id', ctx\.empresaId\)/.test(page))
    assert.ok(page.includes('bloquear_pedidos_duplicados: config.bloquear_pedidos_duplicados === true'))
    assert.ok(page.includes('pedido_activo_ventana_horas: vHoras.horas'))
    assert.ok(/\}\)\.eq\('empresa_id', ctx\.empresaId\)/.test(page), 'el update sigue acotado por empresa')
    assert.ok(!page.includes('service_role') && !/\.rpc\(/.test(page))
  })
  test('defaults: apagado y 3 horas; el valor no se cambia si el admin no lo toca (se guarda lo leído)', () => {
    assert.ok(page.includes('dup.bloquear_pedidos_duplicados ?? false'))
    assert.ok(page.includes('String(dup.pedido_activo_ventana_horas ?? 3)'))
  })
  test('si el valor es inválido y el bloqueo está encendido no se guarda; apagado conserva el último válido', () => {
    assert.ok(/config\.prevenir_pedidos_repetidos && config\.bloquear_pedidos_duplicados && !vHoras\.ok/.test(page))
    assert.ok(page.includes('...(vHoras.ok ? { pedido_activo_ventana_horas: vHoras.horas } : {})'))
  })
  test('independencia: apagar/encender el aviso solo toca prevenir_pedidos_repetidos (no pierde ni cambia minutos, horas ni bloqueo)', () => {
    assert.ok(page.includes('tocar({ prevenir_pedidos_repetidos: !config.prevenir_pedidos_repetidos })'))
    const toggles = page.match(/tocar\(\{ prevenir_pedidos_repetidos: [^}]*\}\)/g) ?? []
    assert.equal(toggles.length, 1, 'un único lugar modifica el aviso, y solo ese campo')
    // los tres parámetros se guardan siempre desde su propio estado, aunque el aviso esté apagado (oculto ≠ borrado)
    assert.ok(page.includes('bloquear_pedidos_duplicados: config.bloquear_pedidos_duplicados === true'))
    assert.ok(page.includes('...(vMin.ok ? { pedidos_repetidos_minutos: vMin.minutos } : {})'))
    assert.ok(page.includes('...(vHoras.ok ? { pedido_activo_ventana_horas: vHoras.horas } : {})'))
  })
  test('el seguimiento general y el resto de la pantalla no cambian (los controles anteriores siguen)', () => {
    for (const s of ['Mostrar productos agotados en el catálogo', 'App de pedidos de la marca', 'Avisar al cliente si envía un pedido idéntico', 'Comparar pedidos de los últimos (minutos)', 'Numeración de pedidos']) assert.ok(page.includes(s), s)
  })
})

describe('textos y presentación (CTO 14/11): dos mecanismos claramente diferenciados', () => {
  const tarjeta = page.slice(page.indexOf('<ConeCard title="Configuración de pedidos">'), page.indexOf('<ConeCard title="App instalable (PWA)">'))
  test('mecanismo 1: aviso al cliente por pedido idéntico (textos definitivos)', () => {
    assert.ok(tarjeta.includes('titulo="Avisar al cliente si envía un pedido idéntico"'))
    assert.ok(tarjeta.includes('Si el cliente vuelve a enviar el mismo pedido dentro del tiempo configurado, le preguntamos si realmente quiere generar otro. Puede continuar si se trata de una nueva compra. No requiere intervención de Caja.'))
    assert.ok(tarjeta.includes('<Label>Comparar pedidos de los últimos (minutos)</Label>'))
  })
  test('mecanismo 2: revisión por teléfono (textos definitivos), sin la palabra «Bloqueo» como título', () => {
    assert.ok(tarjeta.includes('titulo="Revisar nuevos pedidos si el teléfono ya tiene uno activo"'))
    assert.ok(tarjeta.includes('Si un teléfono ya tiene un pedido en curso dentro del tiempo configurado, el nuevo pedido queda en revisión en Caja. El personal puede comparar ambos pedidos y decidir si es una compra legítima o un duplicado. No se cancela ni se rechaza automáticamente.'))
    assert.ok(tarjeta.includes('<Label>Considerar activo un pedido del mismo teléfono durante (horas)</Label>'))
    assert.ok(!/titulo="[^"]*[Bb]loqueo/.test(tarjeta) && !/aria-label="[^"]*[Bb]loqueo/.test(tarjeta))
  })
  test('el teléfono se presenta como señal de coincidencia, no como identidad autenticada', () => {
    assert.ok(tarjeta.includes('El teléfono es solo una señal para detectar posibles coincidencias: no confirma que sea la misma persona.'))
    assert.ok(!tarjeta.includes('señal de identidad'))
  })
  test('interruptores y parámetros siguen independientes, con las mismas claves y validaciones', () => {
    assert.ok(tarjeta.includes('tocar({ prevenir_pedidos_repetidos: !config.prevenir_pedidos_repetidos })'))
    assert.ok(tarjeta.includes('tocar({ bloquear_pedidos_duplicados: !config.bloquear_pedidos_duplicados })'))
    assert.ok(tarjeta.includes('tocar({ pedidos_repetidos_minutos: e.target.value })') && tarjeta.includes('tocar({ pedido_activo_ventana_horas: e.target.value })'))
    assert.ok(tarjeta.includes('validarMinutosRepetidos(config.pedidos_repetidos_minutos)') && tarjeta.includes('validarHorasPedidoActivo(config.pedido_activo_ventana_horas)'))
  })
  test('las explicaciones se muestran solo con doble clic (o con el botón «i»), no están siempre visibles', () => {
    assert.ok(page.includes('onDoubleClick={() => setAbierta(a => !a)}') && page.includes('{abierta && <p'))
    assert.equal((tarjeta.match(/<p className="text-xs text-neutral-400 mt-1">/g) ?? []).length, 0, 'ninguna descripción fija en la tarjeta')
  })
})

