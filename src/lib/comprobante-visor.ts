// Piezas PURAS del visor de comprobantes de Caja (sin imports: se usa en servidor y en el navegador).
// Regla de seguridad: el tipo NUNCA lo manda el cliente ni sale del contenido del archivo: lo deduce el SERVIDOR de la ruta de Storage
// que ya validó `rutaCapturaDelPedido` (<empresa_id>/pedidos/<pedido_id>.<ext> o pedidos/<pedido_id>.<ext>). No amplía ningún permiso:
// solo le dice al visor cómo mostrar una URL que de todos modos se firma igual (10 minutos).

export type TipoVisorCaptura = 'imagen' | 'pdf'

export const EXPIRA_FIRMA_POR_DEFECTO_SEG = 600
/** Margen antes del vencimiento a partir del cual el enlace se renueva en lugar de abrirse (evita abrir una firma por vencer). */
export const MARGEN_RENOVACION_SEG = 30

/** 'pdf' si la ruta termina en .pdf (sin distinguir mayúsculas); cualquier otra extensión conserva el visor de imágenes de siempre. */
export function tipoVisorDeRuta(ruta: string | null | undefined): TipoVisorCaptura {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(typeof ruta === 'string' ? ruta : '')
  return m && m[1].toLowerCase() === 'pdf' ? 'pdf' : 'imagen'
}

/** Lo que llega del servidor: solo 'pdf' cambia el visor. Ausente, nulo o desconocido = imagen (compatible con respuestas anteriores). */
export function normalizarTipoVisor(valor: unknown): TipoVisorCaptura {
  return valor === 'pdf' ? 'pdf' : 'imagen'
}

/** ¿Hay que pedir una firma nueva antes de abrir el enlace? Vence `expiraSeg` después de firmada, menos el margen. */
export function enlaceVencido(
  firmadaEnMs: number, ahoraMs: number, expiraSeg: unknown, margenSeg: number = MARGEN_RENOVACION_SEG,
): boolean {
  const exp = typeof expiraSeg === 'number' && Number.isFinite(expiraSeg) && expiraSeg > 0 ? expiraSeg : EXPIRA_FIRMA_POR_DEFECTO_SEG
  if (!Number.isFinite(firmadaEnMs) || !Number.isFinite(ahoraMs)) return true
  return ahoraMs - firmadaEnMs >= (exp - margenSeg) * 1000
}
