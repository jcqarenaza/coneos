// Vigencia de promociones con fecha y hora (hora de Argentina).
// Reglas:
//  - Sin hora de inicio: rige desde que empieza el día de "vigencia_desde" (compara solo la fecha, como siempre).
//  - Sin hora de cierre: rige hasta que termina el día de "vigencia_hasta" (compara solo la fecha, como siempre).
//  - Con hora de inicio: rige desde esa hora exacta. Con hora de cierre: deja de regir al llegar a esa hora.
//  - Ejemplo: desde 18/11 18:00 hasta 19/11 02:00 → rige del 18 a las 18:00 hasta las 02:00 del 19.

export type VigenciaPromo = {
  vigencia_desde?: string | null   // 'YYYY-MM-DD'
  vigencia_hasta?: string | null   // 'YYYY-MM-DD'
  hora_desde?: string | null       // 'HH:MM' o 'HH:MM:SS'
  hora_hasta?: string | null
}

export type AhoraAR = { fecha: string; fechaHora: string }  // 'YYYY-MM-DD' y 'YYYY-MM-DD HH:MM'

export function ahoraArgentina(d: Date = new Date()): AhoraAR {
  const s = d.toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
  return { fecha: s.slice(0, 10), fechaHora: s.slice(0, 16) }
}

const hhmm = (h: string) => h.slice(0, 5)

export function promoVigente(p: VigenciaPromo, ahora: AhoraAR): boolean {
  if (p.vigencia_desde) {
    const ok = p.hora_desde ? ahora.fechaHora >= `${p.vigencia_desde} ${hhmm(p.hora_desde)}` : ahora.fecha >= p.vigencia_desde
    if (!ok) return false
  }
  if (p.vigencia_hasta) {
    const ok = p.hora_hasta ? ahora.fechaHora < `${p.vigencia_hasta} ${hhmm(p.hora_hasta)}` : ahora.fecha <= p.vigencia_hasta
    if (!ok) return false
  }
  return true
}

/** '2026-11-18' + '18:00:00' → '18/11/2026 18:00' (para mostrar en el admin). */
export function textoVigencia(fecha: string | null | undefined, hora: string | null | undefined): string {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}${hora ? ' ' + hhmm(hora) : ''}`
}
