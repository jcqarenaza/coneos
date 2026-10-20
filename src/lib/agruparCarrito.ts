// Resumen de carrito: cada combo (promo) se muestra como UN bloque, con sus
// componentes idénticos agrupados ("3× Salteña"), igual que en la comanda.
// SOLO VISUAL: el carrito y lo que se envía al pedido no cambian (cada
// componente sigue siendo un ítem con su combo_ref). Los ítems sueltos y las
// promos de siempre (componentes distintos) se ven ordenados igual o mejor.
export interface ItemCarritoBase {
  nombre_producto: string
  nombre_presentacion: string
  opciones: { nombre: string }[]
  precio: number
  cantidad: number
  combo_ref?: string | null
}

export interface LineaCombo { grupo: string; nombre: string; opciones: string; n: number }
export type FilaCarrito<T extends ItemCarritoBase> =
  | { tipo: 'item'; item: T }
  | { tipo: 'combo'; ref: string; nombre: string; precio: number; lineas: LineaCombo[]; primero: T }

export function armarFilas<T extends ItemCarritoBase>(carrito: T[]): FilaCarrito<T>[] {
  const filas: FilaCarrito<T>[] = []
  const porRef = new Map<string, Extract<FilaCarrito<T>, { tipo: 'combo' }>>()
  for (const it of carrito) {
    if (!it.combo_ref) { filas.push({ tipo: 'item', item: it }); continue }
    let f = porRef.get(it.combo_ref)
    if (!f) {
      f = { tipo: 'combo', ref: it.combo_ref, nombre: String(it.nombre_producto).replace(/^🎁\s*/u, ''), precio: 0, lineas: [], primero: it }
      porRef.set(it.combo_ref, f)
      filas.push(f)
    }
    f.precio += it.precio * it.cantidad
    const pres = String(it.nombre_presentacion ?? '')
    const i = pres.indexOf(': ')
    const grupo = i > 0 ? pres.slice(0, i) : ''
    const nombre = (i > 0 ? pres.slice(i + 2) : pres).replace(/\s+Unidad$/i, '')
    const opciones = it.opciones.map(o => o.nombre).join(', ')
    const ya = f.lineas.find(l => l.grupo === grupo && l.nombre === nombre && l.opciones === opciones)
    if (ya) ya.n += it.cantidad
    else f.lineas.push({ grupo, nombre, opciones, n: it.cantidad })
  }
  return filas
}

// Agregar al carrito: si ya hay una línea IDÉNTICA (misma presentación, mismas opciones,
// mismo precio, sin promo) se suma la cantidad en vez de crear otra línea.
// Las promos (combo_ref) y los accesorios nunca se fusionan.
type ItemFusionable = {
  presentacion_id: string; precio: number; cantidad: number
  combo_ref?: string | null; promo_id?: string | null
  opciones: { opcion_id?: string; id?: string }[]
}
export function sumarAlCarrito<T extends ItemFusionable>(prev: T[], nuevo: T): T[] {
  if (nuevo.combo_ref || nuevo.promo_id || !nuevo.presentacion_id) return [...prev, nuevo]
  const clave = (x: ItemFusionable) => `${x.presentacion_id}|${x.precio}|${x.opciones.map(o => o.opcion_id ?? o.id ?? '').sort().join(',')}`
  const k = clave(nuevo)
  const i = prev.findIndex(x => !x.combo_ref && !x.promo_id && clave(x) === k)
  if (i < 0) return [...prev, nuevo]
  return prev.map((x, j) => j === i ? { ...x, cantidad: x.cantidad + nuevo.cantidad } : x)
}
