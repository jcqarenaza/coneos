// Validación en el NAVEGADOR del comprobante de transferencia (delivery / takeaway), antes de mostrarlo y de subirlo.
// Decisión CTO 20/11: los comprobantes son IMÁGENES (JPG, PNG o WebP); el PDF no se acepta. Esto es solo la primera barrera (mensaje
// inmediato al cliente): la barrera real sigue siendo el servidor (POST /api/pedidos/comprobante → validarArchivoComprobante, que mira
// el contenido real del archivo). Usa la MISMA detección por contenido que el servidor, para que ambos lados decidan igual.
import { detectarTipoComprobante, MAX_BYTES_COMPROBANTE } from './storage'

/** Para el atributo `accept` del selector de archivos. Sin application/pdf ni image/* genérico. */
export const ACCEPT_COMPROBANTE = 'image/jpeg,image/png,image/webp'

export const MENSAJE_SOLO_IMAGEN = 'Subí una imagen del comprobante (JPG, PNG o WebP). Los PDF no se aceptan.'
export const MENSAJE_ARCHIVO_VACIO = 'El archivo está vacío.'
export const MENSAJE_ARCHIVO_GRANDE = 'El archivo supera los 10 MB.'

export type ResultadoCapturaCliente = { ok: true } | { ok: false; mensaje: string }

/** Cuántos bytes iniciales alcanzan para reconocer JPEG, PNG, WebP (RIFF....WEBP = 12) y PDF (%PDF-). */
const BYTES_CABECERA = 16

export async function validarCapturaCliente(f: Blob): Promise<ResultadoCapturaCliente> {
  if (f.size === 0) return { ok: false, mensaje: MENSAJE_ARCHIVO_VACIO }
  if (f.size > MAX_BYTES_COMPROBANTE) return { ok: false, mensaje: MENSAJE_ARCHIVO_GRANDE }
  let cabecera: Uint8Array
  try { cabecera = new Uint8Array(await f.slice(0, BYTES_CABECERA).arrayBuffer()) } catch { return { ok: false, mensaje: MENSAJE_SOLO_IMAGEN } }
  return detectarTipoComprobante(cabecera) ? { ok: true } : { ok: false, mensaje: MENSAJE_SOLO_IMAGEN }
}
