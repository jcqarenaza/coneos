// Agrupa componentes IDÉNTICOS de un combo para mostrarlos como "6× Salteña"
// en vez de repetir la línea 6 veces (PROMOS V2-A, 20/10). SOLO VISUAL: los
// datos del pedido (pedido_items) no se tocan. Dos componentes son idénticos
// si tienen el mismo nombre de presentación y las mismas opciones elegidas.
// Con componentes todos distintos (promos de siempre) devuelve n = 1 en cada
// uno, o sea que el render queda exactamente igual que antes.
type ItemAgrupable = { nombre_presentacion_snap: string; nombre_producto_snap?: string | null; precio_snap?: number | string | null; pedido_item_opciones?: { nombre_snap?: string | null }[] | null }

export function agruparComponentes<T extends ItemAgrupable>(grupo: T[]): { it: T; n: number }[] {
  const out: { it: T; n: number; key: string }[] = []
  for (const it of grupo) {
    const key = `${it.nombre_presentacion_snap}|${(it.pedido_item_opciones ?? []).map(o => o.nombre_snap ?? '').join(',')}`
    const ya = out.find(x => x.key === key)
    if (ya) ya.n++
    else out.push({ it, n: 1, key })
  }
  return out.map(({ it, n }) => ({ it, n }))
}

// Resumen de líneas para la lista de pedidos: ítems sueltos tal cual (n = cantidad),
// componentes de combo idénticos del MISMO combo agrupados.
export function lineasResumen<T extends ItemAgrupable & { cantidad: number; combo_ref?: string | null }>(items: T[]): { it: T; n: number }[] {
  const out: { it: T; n: number; key: string }[] = []
  for (const it of items) {
    // ítems sueltos IDÉNTICOS (mismo producto, presentación, opciones y precio) se suman: "2× Agua"
    const key = it.combo_ref
      ? `${it.combo_ref}|${it.nombre_presentacion_snap}|${(it.pedido_item_opciones ?? []).map(o => o.nombre_snap ?? '').join(',')}`
      : `solo|${it.nombre_producto_snap ?? ''}|${it.nombre_presentacion_snap}|${String(it.precio_snap ?? '')}|${(it.pedido_item_opciones ?? []).map(o => o.nombre_snap ?? '').join(',')}`
    const ya = out.find(x => x.key === key)
    if (ya) ya.n += it.cantidad
    else out.push({ it, n: it.cantidad, key })
  }
  return out.map(({ it, n }) => ({ it, n }))
}

// Une los ítems SUELTOS idénticos de un pedido en uno solo con la cantidad sumada
// (mismo producto, presentación, opciones y precio). Los de combo no se tocan.
// SOLO VISUAL: los datos del pedido no cambian. Si no hay repetidos devuelve lo mismo.
export function unificarSueltos<T extends ItemAgrupable & { cantidad: number }>(items: T[]): T[] {
  const out: { it: T; key: string }[] = []
  for (const it of items) {
    const key = `${it.nombre_producto_snap ?? ''}|${it.nombre_presentacion_snap}|${String(it.precio_snap ?? '')}|${(it.pedido_item_opciones ?? []).map(o => o.nombre_snap ?? '').join(',')}`
    const ya = out.find(x => x.key === key)
    if (ya) ya.it = { ...ya.it, cantidad: ya.it.cantidad + it.cantidad }
    else out.push({ it, key })
  }
  return out.map(x => x.it)
}
