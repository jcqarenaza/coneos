// Alertas de stock: misma regla que el catálogo. Ejecutar: npx tsx --test src/lib/__tests__/alertas-stock.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertasStock } from '../stock/alertas'

type Row = Record<string, unknown>
// Cliente PostgREST mínimo en memoria: eq / in / is filtran; await devuelve { data, error }.
function fake(tablas: Record<string, Row[]>, fallar: string[] = []) {
  const from = (t: string) => {
    let rows = tablas[t] ?? []
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { rows = rows.filter(r => r[c] === v); return q },
      in: (c: string, v: unknown[]) => { rows = rows.filter(r => v.includes(r[c])); return q },
      is: (c: string, v: unknown) => { rows = rows.filter(r => (r[c] ?? null) === v); return q },
      then: (res: (x: unknown) => void) => res(fallar.includes(t) ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }),
    }
    return q
  }
  return { from } as never
}

const E = 'e1', S = 's1', S2 = 's2'
const base = (): Record<string, Row[]> => ({
  producto_stock: [
    { empresa_id: E, sucursal_id: S, cantidad: 0, stock_minimo: 0, controla: true, productos: { nombre: 'Balde 2 litros' } },
    { empresa_id: E, sucursal_id: S, cantidad: 0, stock_minimo: 0, controla: false, productos: { nombre: 'Agua sin control' } },
    { empresa_id: E, sucursal_id: S, cantidad: 3, stock_minimo: 5, controla: true, productos: [{ nombre: 'Bajo' }] },
    { empresa_id: E, sucursal_id: S, cantidad: 9, stock_minimo: 5, controla: true, productos: { nombre: 'Sano' } },
  ],
  productos: [{ id: 'p1', nombre: 'Bomboncitos', empresa_id: E, activo: true, deleted_at: null, controla_stock: true, modelo_stock: 'rama' }],
  presentaciones: [{ id: 'a', producto_id: 'p1', empresa_id: E, activo: true, nombre: 'Pistacho' }, { id: 'b', producto_id: 'p1', empresa_id: E, activo: true, nombre: 'Chocolate' }],
  stock_rama: [{ empresa_id: E, sucursal_id: S, presentacion_id: 'a', cantidad: '0.000' }, { empresa_id: E, sucursal_id: S, presentacion_id: 'b', cantidad: '0.000' }],
  stock_rama_habilitacion: [{ empresa_id: E, sucursal_id: S, producto_id: 'p1', estado: 'activa' }],
})

test('cuenta Balde (controlado, 0), el bajo y la rama sin saldo; ignora filas sin control y sanas', async () => {
  const r = await alertasStock(fake(base()), E, [S])
  assert.deepEqual(r.map(x => x.producto).sort(), ['Bajo', 'Balde 2 litros', 'Bomboncitos · Chocolate', 'Bomboncitos · Pistacho'])
  assert.equal(r.filter(x => x.cantidad === 0).length, 3)
  assert.equal(r.filter(x => x.cantidad > 0).length, 1)
})
test('rama: solo se listan las presentaciones sin saldo (las con saldo >= 1 no)', async () => {
  const t = base(); t.stock_rama[0].cantidad = '2.000'
  const r = (await alertasStock(fake(t), E, [S])).map(x => x.producto)
  assert.ok(!r.includes('Bomboncitos · Pistacho'))
  assert.ok(r.includes('Bomboncitos · Chocolate'))
})
test('rama: presentación sin hoja de stock cuenta como sin saldo', async () => {
  const t = base(); t.stock_rama = [t.stock_rama[0]]
  const r = (await alertasStock(fake(t), E, [S])).map(x => x.producto)
  assert.ok(r.includes('Bomboncitos · Chocolate'))
})
test('rama sin habilitación activa en la sucursal no alerta', async () => {
  const t = base(); t.stock_rama_habilitacion = [{ empresa_id: E, sucursal_id: S2, producto_id: 'p1', estado: 'activa' }]
  const r = await alertasStock(fake(t), E, [S])
  assert.ok(!r.some(x => x.producto.startsWith('Bomboncitos')))
})
test('varias sucursales: cada alerta trae su sucursal_id', async () => {
  const t = base(); t.stock_rama_habilitacion.push({ empresa_id: E, sucursal_id: S2, producto_id: 'p1', estado: 'activa' })
  const r = await alertasStock(fake(t), E, [S, S2])
  assert.deepEqual(r.filter(x => x.producto === 'Bomboncitos · Pistacho').map(x => x.sucursal_id).sort(), [S, S2])
})
test('otra empresa no se mezcla', async () => {
  const r = await alertasStock(fake(base()), 'otra', [S])
  assert.equal(r.length, 0)
})
test('falla al leer la rama: devuelve solo lo contable (falla abierta)', async () => {
  const r = await alertasStock(fake(base(), ['stock_rama']), E, [S])
  assert.deepEqual(r.map(x => x.producto).sort(), ['Bajo', 'Balde 2 litros'])
})
test('sin sucursales: vacío', async () => { assert.deepEqual(await alertasStock(fake(base()), E, []), []) })
