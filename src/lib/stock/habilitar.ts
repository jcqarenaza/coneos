// Stock Etapa 1.1 — helpers puros (sin acceso a base) para habilitar/quitar control y editar el mínimo desde Stock.

/** Mínimo de aviso: entero de 0 en adelante. Devuelve el mensaje de error o null. */
export function validarMinimo(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000) return 'El mínimo debe ser un número entero de 0 en adelante.'
  return null
}

/** Unidades vendibles de una presentación según el stock del producto base (factor_stock = cuánto descuenta cada venta). */
export function unidadesVendibles(cantidad: number | null, factor: unknown): number | null {
  if (cantidad === null) return null
  const f = Math.max(1, Math.floor(Number(factor) || 1))
  return Math.floor(cantidad / f)
}
