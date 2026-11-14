// Validación del tiempo de comparación de pedidos repetidos (configuración por empresa). Mismo rango que el CHECK de la base: entero entre 1 y 1440.
export const MINUTOS_REPETIDOS_MIN = 1
export const MINUTOS_REPETIDOS_MAX = 1440
/** El texto se conserva TAL CUAL mientras se escribe (no se trunca ni se corrige); se valida recién al guardar. Solo dígitos: "1.5", "1,5", "1e2", "-3" o vacío NO son válidos. */
export function validarMinutosRepetidos(texto: unknown): { ok: true; minutos: number } | { ok: false } {
  const s = String(texto ?? '').trim()
  if (!/^\d+$/.test(s)) return { ok: false }
  const n = Number(s)
  return n >= MINUTOS_REPETIDOS_MIN && n <= MINUTOS_REPETIDOS_MAX ? { ok: true, minutos: n } : { ok: false }
}

// Ventana de "pedido activo" de la detección de posibles duplicados por teléfono (pedido_activo_ventana_horas). Mismo rango que el CHECK de la base: entero entre 1 y 24.
export const HORAS_PEDIDO_ACTIVO_MIN = 1
export const HORAS_PEDIDO_ACTIVO_MAX = 24
/** Igual que los minutos: el texto se conserva TAL CUAL mientras se escribe y se valida recién al guardar. Solo dígitos. */
export function validarHorasPedidoActivo(texto: unknown): { ok: true; horas: number } | { ok: false } {
  const s = String(texto ?? '').trim()
  if (!/^\d+$/.test(s)) return { ok: false }
  const n = Number(s)
  return n >= HORAS_PEDIDO_ACTIVO_MIN && n <= HORAS_PEDIDO_ACTIVO_MAX ? { ok: true, horas: n } : { ok: false }
}
