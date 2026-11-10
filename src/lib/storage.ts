// STORAGE POR EMPRESA — helper único. A1 (comprobantes): lo usa /api/operacion/consulta para firmar y resumir capturas; el resto de las
// funciones (rutaSubida, subirImagen) todavía no se usan en pantallas.
// Regla: TODA ruta de Storage empieza con <empresa_id>/. Nadie arma rutas a mano.
//   productos/<empresa_id>/<carpeta>/<uuid>.<ext>        (galería: <empresa_id>/galeria/<producto_id>/<uuid>.<ext>)
//   logos/<empresa_id>/logos/<uuid>.<ext>                (logo y favicon de la empresa: bucket `logos`, NO `productos`)
//   logos/<empresa_id>/pwa-icons/<uuid>.<ext>
//   capturas/<empresa_id>/pedidos/<pedido_id>.<ext>      (solo servidor; bucket privado, URLs firmadas)
// La empresa de las policies sale de la base (auth.uid() -> usuarios_admin); este helper solo arma rutas válidas.
// ⚠ `empresaId` llega como PARÁMETRO: este módulo NO valida que el usuario pertenezca a esa empresa. La autoridad es la sesión
//   (quién llama) y las policies de Storage/RLS. Un empresaId ajeno produce una ruta bien formada que la policy rechaza.
//   Para comprobantes, la firma con service_role (sin policies) depende de la validación estricta de pedido + empresa de
//   `rutaCapturaDelPedido`; el llamador debe pasar la empresa de la SESIÓN, nunca un valor que venga del cliente.

export type BucketPublico = 'productos' | 'logos'

/** Qué carpetas admite cada bucket (si no coincide, se rechaza antes de subir). */
export const CARPETAS_POR_BUCKET = {
  productos: ['productos', 'presentaciones', 'sabores', 'categorias', 'promos', 'accesorios', 'galeria'],
  logos: ['logos', 'pwa-icons'],
} as const
export const CARPETAS = [...CARPETAS_POR_BUCKET.productos, ...CARPETAS_POR_BUCKET.logos] as const
export type Carpeta = (typeof CARPETAS)[number]

export const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
/** .ico solo para el logo/favicon de la empresa (bucket logos, carpeta logos); nunca en el catálogo. */
export const TIPOS_ICONO = ['image/x-icon', 'image/vnd.microsoft.icon'] as const
export const MAX_BYTES_IMAGEN = 10 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EXT_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'ico'])
const EXT_POR_TIPO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'application/pdf': 'pdf',
}

export class StorageRutaError extends Error {
  constructor(public codigo: string, mensaje: string) { super(mensaje); this.name = 'StorageRutaError' }
}

export function esUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v) }

/** Extensión segura: sale del TIPO del archivo si se conoce, si no del nombre; solo extensiones permitidas. */
export function extensionSegura(nombre: string, tipo?: string, permitirPdf = false): string {
  const porTipo = tipo ? EXT_POR_TIPO[tipo] : undefined
  const bruta = porTipo ?? (nombre.includes('.') ? nombre.split('.').pop()! : '')
  const ext = bruta.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!EXT_OK.has(ext) && !(permitirPdf && ext === 'pdf')) throw new StorageRutaError('EXTENSION', `Extensión no permitida: "${bruta}"`)
  return ext === 'jpeg' ? 'jpg' : ext
}

function segmento(v: string, que: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(v) || v.includes('..')) throw new StorageRutaError('SEGMENTO', `${que} inválido`)
  return v
}

/** Arma <empresa_id>/<carpeta>[/<sub>]/<uuid>.<ext>. El nombre es un UUID nuevo: no pisa nada (upsert:false). */
export function rutaSubida(p: {
  bucket: BucketPublico; empresaId: string; carpeta: Carpeta; archivoNombre: string; archivoTipo?: string; subcarpeta?: string; uuid?: string
}): string {
  if (!esUuid(p.empresaId)) throw new StorageRutaError('EMPRESA', 'empresa_id inválido')
  if (!(CARPETAS_POR_BUCKET[p.bucket] as readonly string[] | undefined)?.includes(p.carpeta))
    throw new StorageRutaError('CARPETA', `Carpeta "${p.carpeta}" no permitida en el bucket "${p.bucket}"`)
  const ext = extensionSegura(p.archivoNombre, p.archivoTipo)
  if (ext === 'ico' && !(p.bucket === 'logos' && p.carpeta === 'logos'))
    throw new StorageRutaError('EXTENSION', '.ico solo se admite para el logo/favicon de la empresa')
  const id = p.uuid ?? crypto.randomUUID()
  if (!esUuid(id)) throw new StorageRutaError('UUID', 'uuid inválido')
  const sub = p.subcarpeta ? `${segmento(p.subcarpeta, 'subcarpeta')}/` : ''
  return `${p.empresaId}/${p.carpeta}/${sub}${id}.${ext}`
}

/** Comprobante de transferencia (lo arma el SERVIDOR): capturas/<empresa_id>/pedidos/<pedido_id>.<ext> */
export function rutaCaptura(empresaId: string, pedidoId: string, archivoNombre: string, archivoTipo?: string): string {
  if (!esUuid(empresaId)) throw new StorageRutaError('EMPRESA', 'empresa_id inválido')
  if (!esUuid(pedidoId)) throw new StorageRutaError('PEDIDO', 'pedido_id inválido')
  return `${empresaId}/pedidos/${pedidoId}.${extensionSegura(archivoNombre, archivoTipo, true)}`
}

/** Validación previa en el cliente (la autoridad final son las policies y los límites del bucket). */
export function validarArchivoImagen(f: { type: string; size: number; name: string }, opts: { permitirIco?: boolean } = {}): string | null {
  const esIco = (TIPOS_ICONO as readonly string[]).includes(f.type) || (!f.type && /\.ico$/i.test(f.name))
  const tipoOk = (TIPOS_IMAGEN as readonly string[]).includes(f.type) || (opts.permitirIco === true && esIco)
  if (!tipoOk) return opts.permitirIco ? `"${f.name}": solo JPG, PNG, WEBP, GIF o ICO.` : `"${f.name}": solo JPG, PNG, WEBP o GIF.`
  if (f.size > MAX_BYTES_IMAGEN) return `"${f.name}": supera los 10 MB.`
  return null
}

// ── Cliente mínimo (compatible con supabase-js) ──
interface ClienteStorage {
  storage: {
    from(bucket: string): {
      upload(path: string, file: File | Blob, opts?: { upsert?: boolean; contentType?: string }): Promise<{ error: { message: string } | null }>
      getPublicUrl(path: string): { data: { publicUrl: string } }
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
      createSignedUrls(paths: string[], expiresIn: number): Promise<{ data: { path: string | null; signedUrl: string; error: string | null }[] | null; error: { message: string } | null }>
    }
  }
}

/** Sube una imagen del admin al prefijo de SU empresa. Siempre upsert:false (nunca pisa). Devuelve ruta y URL pública. */
export async function subirImagen(
  supabase: ClienteStorage,
  p: { bucket: BucketPublico; empresaId: string; carpeta: Carpeta; archivo: File; subcarpeta?: string },
): Promise<{ path: string; url: string }> {
  const aviso = validarArchivoImagen(p.archivo, { permitirIco: p.bucket === 'logos' && p.carpeta === 'logos' })
  if (aviso) throw new StorageRutaError('ARCHIVO', aviso)
  const path = rutaSubida({ bucket: p.bucket, empresaId: p.empresaId, carpeta: p.carpeta, archivoNombre: p.archivo.name, archivoTipo: p.archivo.type || (/\.ico$/i.test(p.archivo.name) ? 'image/x-icon' : undefined), subcarpeta: p.subcarpeta })
  const { error } = await supabase.storage.from(p.bucket).upload(path, p.archivo, { upsert: false, contentType: p.archivo.type })
  if (error) throw new StorageRutaError('SUBIDA', error.message)
  return { path, url: supabase.storage.from(p.bucket).getPublicUrl(path).data.publicUrl }
}

// ── Comprobantes: valor guardado en pedidos.captura_transferencia_url ──
// Hoy: URL pública completa. Después de la migración (SQL 04): la ruta. Este resolvedor acepta AMBAS formas,
// así el código se puede desplegar ANTES de migrar los datos y la caja nunca se queda sin ver el comprobante.
const PUBLICA = /\/storage\/v1\/object\/(?:public|sign)\/capturas\/([^?]+)/

export function rutaDesdeValorCaptura(valor: string | null | undefined): string | null {
  if (!valor) return null
  const m = PUBLICA.exec(valor)
  if (m) {
    try { return decodeURIComponent(m[1]) } catch { return null }   // %ZZ u otra secuencia malformada: null, no error de servidor
  }
  if (/^https?:\/\//i.test(valor)) return null           // URL ajena al Storage propio: no se firma
  return valor.replace(/^\/+/, '')
}

export const TTL_URL_FIRMADA_SEG = 600   // 10 minutos: alcanza para abrir el comprobante en caja

export interface PedidoConCaptura { id: string; empresa_id: string; captura_transferencia_url?: string | null }

/**
 * La ruta del comprobante SOLO se firma si pertenece a ESTE pedido y a SU empresa:
 *   nuevo:  <empresa_id>/pedidos/<pedido_id>.<ext>      (empresa e id del pedido, ambos exactos)
 *   viejo:  pedidos/<pedido_id>.<ext>                   (solo el id del pedido; la empresa es la de la fila del pedido)
 * Cualquier otra cosa (ruta de otro pedido, de otra empresa, con '..', URL ajena) devuelve null y NO se firma.
 * Se usa service_role (ignora las policies), así que esta validación es la barrera.
 */
export function rutaCapturaDelPedido(pedido: PedidoConCaptura, empresaEsperada: string): string | null {
  if (!esUuid(pedido.id) || !esUuid(pedido.empresa_id) || !esUuid(empresaEsperada)) return null
  if (pedido.empresa_id !== empresaEsperada) return null            // el pedido no es de la empresa que consulta
  const ruta = rutaDesdeValorCaptura(pedido.captura_transferencia_url)
  if (!ruta || ruta.includes('..')) return null
  const ext = '\\.[A-Za-z0-9]{1,5}'
  const nueva = new RegExp(`^${pedido.empresa_id}/pedidos/${pedido.id}${ext}$`)
  const vieja = new RegExp(`^pedidos/${pedido.id}${ext}$`)
  return nueva.test(ruta) || vieja.test(ruta) ? ruta : null
}

/** SERVIDOR (service_role): URL firmada de UN comprobante, solo si la ruta es del pedido y de la empresa que consulta. */
export async function firmarCaptura(supabase: ClienteStorage, pedido: PedidoConCaptura, empresaEsperada: string, ttl = TTL_URL_FIRMADA_SEG): Promise<string | null> {
  const ruta = rutaCapturaDelPedido(pedido, empresaEsperada)
  if (!ruta) return null
  const { data, error } = await supabase.storage.from('capturas').createSignedUrl(ruta, ttl)
  return error || !data ? null : data.signedUrl
}

/** SERVIDOR: firma en lote (1 llamada). Devuelve Map<pedido.id, url|null>; los que no pasan la validación quedan en null. */
export async function firmarCapturasDePedidos(
  supabase: ClienteStorage,
  empresaEsperada: string,
  pedidos: PedidoConCaptura[],
  ttl = TTL_URL_FIRMADA_SEG,
): Promise<Map<string, string | null>> {
  const salida = new Map<string, string | null>()
  const porRuta = new Map<string, string[]>()
  for (const p of pedidos) {
    const ruta = rutaCapturaDelPedido(p, empresaEsperada)
    if (!ruta) { salida.set(p.id, null); continue }
    porRuta.set(ruta, [...(porRuta.get(ruta) ?? []), p.id])
  }
  if (porRuta.size === 0) return salida
  const { data } = await supabase.storage.from('capturas').createSignedUrls([...porRuta.keys()], ttl)
  const firmadas = new Map((data ?? []).filter(d => d.path && !d.error).map(d => [d.path as string, d.signedUrl]))
  for (const [ruta, ids] of porRuta) for (const id of ids) salida.set(id, firmadas.get(ruta) ?? null)
  return salida
}

/**
 * Lista de caja: el valor guardado (URL/ruta) NO viaja al navegador. Solo un booleano: "este pedido tiene un comprobante
 * firmable y que es de este pedido y de esta empresa". El navegador pide la URL firmada aparte, cuando abre el pedido.
 */
export function resumirCaptura<T extends { id: string; captura_transferencia_url?: string | null }>(
  p: T, empresaId: string,
): Omit<T, 'captura_transferencia_url'> & { tiene_captura: boolean } {
  const { captura_transferencia_url, ...resto } = p
  const ok = rutaCapturaDelPedido({ id: p.id, empresa_id: empresaId, captura_transferencia_url }, empresaId) !== null
  return { ...resto, tiene_captura: ok }
}

// ── Comprobantes: escritor (A2) ──
export const MAX_BYTES_COMPROBANTE = 10 * 1024 * 1024
/** Únicos formatos admitidos y la extensión que se guarda para cada uno. PDF queda fuera hasta que la caja tenga visor (decisión CTO 09/11). */
export const TIPOS_COMPROBANTE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const
export type TipoComprobante = keyof typeof TIPOS_COMPROBANTE

/** Tipo REAL del archivo según sus primeros bytes (no confía en el nombre ni en el tipo que declara el navegador). null = no admitido. */
export function detectarTipoComprobante(b: Uint8Array): TipoComprobante | null {
  const es = (off: number, ...bytes: number[]) => b.length >= off + bytes.length && bytes.every((v, i) => b[off + i] === v)
  if (es(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (es(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (es(0, 0x52, 0x49, 0x46, 0x46) && es(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'   // RIFF....WEBP
  return null
}

/**
 * ¿Se acepta el archivo? Devuelve el tipo real o el motivo del rechazo. El tipo declarado, si viene, debe coincidir con el real
 * (los celulares a veces lo mandan vacío: se acepta); la extensión del nombre es OBLIGATORIA y debe ser conocida (iOS conserva
 * ".HEIC" aunque convierte a JPEG). La extensión que se GUARDA sale siempre del contenido, nunca del nombre.
 */
export function validarArchivoComprobante(f: { name: string; type: string; size: number }, bytes: Uint8Array):
  { ok: true; tipo: TipoComprobante } | { ok: false; codigo: 'VACIO' | 'GRANDE' | 'FORMATO' | 'TIPO_NO_COINCIDE' | 'EXTENSION'; mensaje: string } {
  if (f.size === 0 || bytes.length === 0) return { ok: false, codigo: 'VACIO', mensaje: 'El archivo está vacío' }
  if (f.size > MAX_BYTES_COMPROBANTE || bytes.length > MAX_BYTES_COMPROBANTE) return { ok: false, codigo: 'GRANDE', mensaje: 'Archivo demasiado grande (máx 10 MB)' }
  const tipo = detectarTipoComprobante(bytes)
  if (!tipo) return { ok: false, codigo: 'FORMATO', mensaje: 'Formato no permitido (solo JPG, PNG o WebP)' }
  const declarado = f.type.trim().toLowerCase()
  const alias = declarado === 'image/jpg' || declarado === 'image/pjpeg' ? 'image/jpeg' : declarado
  if (alias && alias !== 'application/octet-stream' && alias !== tipo && !((alias === 'image/heic' || alias === 'image/heif') && tipo === 'image/jpeg'))
    return { ok: false, codigo: 'TIPO_NO_COINCIDE', mensaje: 'El tipo del archivo no coincide con su contenido' }
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : ''
  if (!ext || !['jpg', 'jpeg', 'jfif', 'png', 'webp', 'heic', 'heif'].includes(ext))   // la extensión es obligatoria y reconocida
    return { ok: false, codigo: 'EXTENSION', mensaje: 'El archivo debe tener una extensión válida (jpg, png o webp)' }
  return { ok: true, tipo }
}
