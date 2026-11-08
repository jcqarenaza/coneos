// Stock Etapa 1 — helpers puros del ajuste general (sin acceso a base).
// La regla vive en SQL (aplicar_ajuste_stock); acá solo: validación de forma, texto del estado y traducción de errores.

export const MOTIVOS_AJUSTE = ['conteo', 'merma', 'rotura', 'vencimiento', 'otro'] as const
export type MotivoAjuste = (typeof MOTIVOS_AJUSTE)[number]
export const MOTIVO_LABEL: Record<MotivoAjuste, string> = {
  conteo: 'Conteo', merma: 'Merma', rotura: 'Rotura', vencimiento: 'Vencimiento', otro: 'Otro',
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// El navegador manda SOLO producto_id y contado. La base la congela y guarda el SERVIDOR al iniciar el conteo.
export interface ItemAjuste { producto_id: string; contado: number }

/** Deja solo lo que el cliente puede decidir (producto y contado): cualquier otra clave (p. ej. una base inventada) se descarta. */
export function soloContados(items: unknown): ItemAjuste[] {
  return (items as Record<string, unknown>[]).map(i => ({ producto_id: i.producto_id as string, contado: i.contado as number }))
}

/** Forma del lote. Devuelve el mensaje de error humano o null si está bien. */
export function validarItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return 'Cargá al menos un producto contado.'
  if (items.length > 500) return 'Un ajuste admite hasta 500 productos.'
  const vistos = new Set<string>()
  for (const it of items as Record<string, unknown>[]) {
    if (!it || typeof it.producto_id !== 'string' || !UUID_RE.test(it.producto_id)) return 'Producto inválido en el ajuste.'
    if (vistos.has(it.producto_id)) return 'Hay un producto repetido en el ajuste.'
    vistos.add(it.producto_id)
    const v = it.contado
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000) return 'Las cantidades deben ser números enteros de 0 en adelante.'
  }
  return null
}

export function validarMotivo(motivo: unknown, descripcion: unknown): string | null {
  if (typeof motivo !== 'string' || !(MOTIVOS_AJUSTE as readonly string[]).includes(motivo)) return 'Elegí un motivo del ajuste.'
  if (motivo === 'otro' && (typeof descripcion !== 'string' || descripcion.trim().length < 3)) return 'Con el motivo «Otro» hay que escribir una descripción.'
  if (typeof descripcion === 'string' && descripcion.length > 300) return 'La descripción es demasiado larga (máximo 300 caracteres).'
  return null
}

export type EstadoStock = 'sin_alta' | 'sin_stock' | 'bajo' | 'ok'
export function estadoStock(cantidad: number | null, minimo: number | null): EstadoStock {
  if (cantidad === null) return 'sin_alta'
  if (cantidad <= 0) return 'sin_stock'
  if ((minimo ?? 0) > 0 && cantidad <= (minimo ?? 0)) return 'bajo'
  return 'ok'
}

/** Traduce el error de la función SQL a (status HTTP, mensaje). Lo desconocido NO se muestra crudo. */
export function traducirErrorAjuste(e: { message?: string; code?: string } | null | undefined): { status: number; codigo: string; error: string } {
  const m = e?.message ?? ''
  const tabla: [string, number, string][] = [
    ['CONFIRMACION_REQUERIDA', 409, 'Este ajuste necesita una segunda confirmación. Revisá el resumen y confirmá.'],
    ['CONFIRMACION_INVALIDA', 409, 'Los datos cambiaron desde que confirmaste. Revisá el resumen nuevo y confirmá de nuevo.'],
    ['PRODUCTO_INVALIDO', 400, 'Hay productos que no pertenecen a tu empresa o no controlan stock.'],
    ['AJUSTE_PRODUCTO_REPETIDO', 400, 'Hay un producto repetido en el ajuste.'],
    ['AJUSTE_ITEM_INVALIDO', 400, 'Las cantidades deben ser números enteros de 0 en adelante.'],
    ['AJUSTE_SIN_ITEMS', 400, 'Cargá al menos un producto contado.'],
    ['AJUSTE_DEMASIADOS_ITEMS', 400, 'Un ajuste admite hasta 500 productos.'],
    ['SUCURSAL_INVALIDA', 400, 'La sucursal no es válida.'],
    ['MOTIVO_OTRO_SIN_DESCRIPCION', 400, 'Con el motivo «Otro» hay que escribir una descripción.'],
    ['MOTIVO_INVALIDO', 400, 'Elegí un motivo del ajuste.'],
    ['LOTE_DE_OTRO_ALCANCE', 409, 'Este ajuste ya fue usado en otra sucursal. Iniciá un conteo nuevo.'],
    ['CONTEO_NO_ENCONTRADO', 409, 'El conteo no existe o venció. Iniciá un conteo nuevo.'],
    ['CONTEO_YA_APLICADO', 409, 'Este conteo ya se aplicó. Iniciá un conteo nuevo.'],
    ['CONTEO_DE_OTRO_USUARIO', 403, 'Este conteo lo inició otro administrador.'],
    ['PRODUCTO_FUERA_DEL_CONTEO', 400, 'Hay productos que no estaban en el conteo al iniciarlo. Iniciá un conteo nuevo.'],
    ['USUARIO_REQUERIDO', 401, 'No autorizado'],
  ]
  for (const [cod, status, msg] of tabla) if (m.includes(cod)) return { status, codigo: cod, error: msg }
  // Deadlock / timeout de bloqueo / serialización: no se aplicó nada y se puede reintentar (el lote es idempotente)
  if (['40P01', '55P03', '40001'].includes(e?.code ?? '')) return { status: 503, codigo: 'REINTENTAR', error: 'El sistema está ocupado. No se aplicó nada: reintentá en unos segundos.' }
  return { status: 500, codigo: 'ERROR', error: 'No se pudo aplicar el ajuste. No se modificó el stock. Reintentá.' }
}
