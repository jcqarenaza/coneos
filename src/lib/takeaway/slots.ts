// TAKE AWAY V1.5 — generación de slots de retiro (FUENTE ÚNICA).
// La consumen el contexto (para ofrecer) y /api/pedidos (para validar):
// jamás dos copias de esta lógica (lección del fix1 de Fase 5).
// Slots de 15' fijos, margen de preparación 15' (decisión CTO V1.5),
// solo del día vigente; franjas que cruzan medianoche generan sus
// slots post-00:00 con fecha del día siguiente. Argentina = UTC-3 fijo.

export interface Franja { desde: string; hasta: string }
export interface SlotRetiro { iso: string; label: string }

const AR_OFFSET_HORAS = 3 // Argentina no tiene horario de verano

function partesAhoraAR() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0)
  return { y: g('year'), mo: g('month'), d: g('day'), min: g('hour') * 60 + g('minute') }
}

function isoDe(y: number, mo: number, d: number, minutosDia: number, diaSiguiente: boolean): string {
  return new Date(Date.UTC(
    y, mo - 1, d + (diaSiguiente ? 1 : 0),
    Math.floor(minutosDia / 60) + AR_OFFSET_HORAS, minutosDia % 60,
  )).toISOString()
}

export function generarSlots(
  horarios: Franja[] | null | undefined,
  margenMin = 15,
  pasoMin = 15,
  maxSlots = 48,
): SlotRetiro[] {
  if (!horarios || horarios.length === 0) return []
  const { y, mo, d, min: ahora } = partesAhoraAR()
  const primero = Math.ceil((ahora + margenMin) / pasoMin) * pasoMin
  const slots: SlotRetiro[] = []
  for (const { desde, hasta } of horarios) {
    const [dh, dm] = desde.split(':').map(Number)
    const [hh, hm] = hasta.split(':').map(Number)
    const mDesde = dh * 60 + dm
    const mHastaCrudo = hh * 60 + hm
    // Cruce por HASTA CRUDO (regla del fix8); fin en minutos absolutos desde
    // las 00:00 de hoy (la parte post-medianoche suma 1440 = mañana temprano)
    const finAbs = mHastaCrudo < mDesde ? mHastaCrudo + 1440 : mHastaCrudo
    let m = Math.ceil(Math.max(mDesde, primero) / pasoMin) * pasoMin
    for (; m <= finAbs && slots.length < maxSlots; m += pasoMin) {
      const minutosDia = m % 1440
      const label = `${String(Math.floor(minutosDia / 60)).padStart(2, '0')}:${String(minutosDia % 60).padStart(2, '0')}`
      slots.push({ iso: isoDe(y, mo, d, minutosDia, m >= 1440), label })
    }
  }
  const vistos = new Set<string>()
  return slots
    .filter(s => (vistos.has(s.iso) ? false : (vistos.add(s.iso), true)))
    .sort((a, b) => a.iso.localeCompare(b.iso))
}

// Validación server (para /api/pedidos): el ISO elegido debe ser un slot
// vigente AHORA — margen 0 al validar (el cliente eligió hace un rato; si el
// slot ya arrancó igual vale, si ya PASÓ no).
export function esSlotValido(horarios: Franja[] | null | undefined, iso: string): boolean {
  if (!iso) return false
  const ahora = Date.now()
  const t = Date.parse(iso)
  if (Number.isNaN(t) || t < ahora - 60_000) return false
  return generarSlots(horarios, 0).some(s => s.iso === iso)
}
