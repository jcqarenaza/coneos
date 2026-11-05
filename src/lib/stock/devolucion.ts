// Stock V2 — unidades de stock a devolver por producto al eliminar un pedido.
//
// Regla del CTO (GO Stock V2 Factor): la devolución usa EXCLUSIVAMENTE el
// factor que el pedido guardó al venderse (pedido_items.factor_stock_snap),
// jamás el factor vigente de la presentación. Un snapshot NULL (pedido
// anterior a V2) equivale a factor 1: todo lo vendido antes se descontó 1 a 1.
//
// Función pura (sin base de datos) para poder probarla de forma aislada.

export interface ItemParaDevolucion {
  cantidad: number
  factor_stock_snap: number | string | null
  presentaciones: {
    producto_id: string
    productos: { id: string; controla_stock: boolean } | null
  } | null
}

export function unidadesADevolverPorProducto(items: ItemParaDevolucion[]): Map<string, number> {
  const porProducto = new Map<string, number>()
  for (const it of items) {
    const pres = it.presentaciones
    if (!pres?.productos?.controla_stock) continue
    // numeric puede llegar como número o como texto según el cliente: se normaliza.
    const factor = it.factor_stock_snap == null ? 1 : Number(it.factor_stock_snap)
    porProducto.set(pres.producto_id, (porProducto.get(pres.producto_id) ?? 0) + Number(it.cantidad) * factor)
  }
  return porProducto
}
