// Cliente: identidad de la OPERACIÓN de compra (GO CTO 8/11). Un id por intento de compra, no por contenido:
// el mismo envío reintentado (doble clic, timeout, refresh de la llamada) viaja con el MISMO id y el servidor
// devuelve el mismo pedido; una compra nueva y deliberada usa un id nuevo. Si el carrito cambia, el id cambia.
export function nuevaOperacionId(): string {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID() } catch { /* sigue */ }
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${h(3)}-${h(12)}`
}

export interface OperacionActual { id: string; firma: string }
/** Devuelve la operación vigente si el contenido es el mismo; si cambió (o no hay), arranca una nueva. */
export function operacionPara(actual: OperacionActual | null, firma: string): OperacionActual {
  return actual && actual.firma === firma ? actual : { id: nuevaOperacionId(), firma }
}
