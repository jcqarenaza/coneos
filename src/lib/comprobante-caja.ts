// Tipo de comprobante tal como lo informa el SERVIDOR a Vista Caja (pieza pura: sin imports, se usa en servidor y navegador).
// Decisión CTO 20/11: los comprobantes son IMÁGENES. Existe un único PDF histórico en `capturas` (pedido #39 de federal, 04/10/2026): se
// conserva intacto, pero NO se renderiza, NO se enlaza y NO se descarga. El tipo sale de la RUTA ya validada por el servidor
// (`rutaCapturaDelPedido`), nunca del cliente ni del contenido del archivo, y no amplía ningún permiso.
export type TipoCapturaCaja = 'imagen' | 'pdf_archivado'

export const TEXTO_PDF_ARCHIVADO = 'Comprobante PDF archivado; no disponible para visualización'

/** 'pdf_archivado' si la ruta termina en .pdf (sin distinguir mayúsculas); cualquier otra extensión es 'imagen' (comportamiento de siempre). */
export function tipoCapturaDeRuta(ruta: string | null | undefined): TipoCapturaCaja {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(typeof ruta === 'string' ? ruta : '')
  return m && m[1].toLowerCase() === 'pdf' ? 'pdf_archivado' : 'imagen'
}

/** Lo que llega del servidor: solo 'pdf_archivado' cambia la vista. Ausente, nulo o desconocido = imagen (compatible con respuestas anteriores). */
export function normalizarTipoCaptura(valor: unknown): TipoCapturaCaja {
  return valor === 'pdf_archivado' ? 'pdf_archivado' : 'imagen'
}
