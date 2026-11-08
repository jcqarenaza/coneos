// Salida automática del cadete (tiempo de entrega, cierre CTO 08/11): sin botón.
// Con pedidos LISTOS sin salida, el primer ping fija el punto de partida; cuando la moto
// se aleja UMBRAL_SALIDA_M de ahí, el pedido "salió". Sin pedidos pendientes se limpia el punto.
export const UMBRAL_SALIDA_M = 5    // TEMPORAL SOLO PARA PRUEBA EN PREVIEW — VOLVER A 75 ANTES DE PRODUCCIÓN

export function distanciaMetros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = (x: number) => x * Math.PI / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type DecisionSalida = 'nada' | 'fijar_base' | 'limpiar_base' | 'salio'
export function decidirSalida(base: { lat: number; lng: number } | null, pos: { lat: number; lng: number }, pendientes: number): DecisionSalida {
  if (pendientes === 0) return base ? 'limpiar_base' : 'nada'
  if (!base) return 'fijar_base'
  return distanciaMetros(base, pos) >= UMBRAL_SALIDA_M ? 'salio' : 'nada'
}

// Minutos entre la salida y la entrega, con las MISMAS reglas que tiempo_promedio_entrega() en SQL:
// exige ambas marcas, entrega >= salida y duración <= tope (240 min). Si no cumple: null (no entra al promedio).
export const TOPE_ENTREGA_MIN = 240
export function minutosEntrega(salioAt: string | null | undefined, entregadoAt: string | null | undefined, tope = TOPE_ENTREGA_MIN): number | null {
  if (!salioAt || !entregadoAt) return null
  const ms = new Date(entregadoAt).getTime() - new Date(salioAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = ms / 60000
  return min <= tope ? min : null
}
