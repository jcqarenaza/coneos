// MULTI-FOTOS — constantes y helpers compartidos (admin, API y kiosk).
// El límite también lo valida el servidor (trigger fn_producto_imagenes_validar).
export const MAX_IMAGENES = 10

export interface ImagenRow {
  producto_id: string
  presentacion_id: string | null
  url: string
  orden: number
  es_principal: boolean
  created_at: string
}

/** Orden de una galería: la principal primero, luego por `orden` y antigüedad. */
export function ordenarImagenes<T extends Pick<ImagenRow, 'orden' | 'es_principal' | 'created_at'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    Number(b.es_principal) - Number(a.es_principal) ||
    a.orden - b.orden ||
    (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
}

/**
 * Lista final de fotos de una entidad (compatibilidad total con `imagen_url`):
 * - si hay galería → sus urls (principal primero)
 * - si no (tabla aún sin migrar, o dato viejo escrito directo) → [imagen_url]
 */
export function listaImagenes(imagenUrl: string | null | undefined, galeria: string[] | undefined): string[] {
  if (galeria && galeria.length > 0) return galeria
  return imagenUrl ? [imagenUrl] : []
}
