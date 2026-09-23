// ============================================================
// CICLO A — FUENTE ÚNICA DE VERDAD TEMPORAL
// Contrato (orden CTO):
//  · horarios null o vacío = SIN restricción → ABIERTO (jamás "cerrado").
//  · Una franja que cruza medianoche pertenece al DÍA DE INICIO
//    (misma semántica que esSlotValido y que la validación de delivery).
//  · La tolerancia extiende el cierre N minutos (default 0 = cierre exacto).
// Consumida por: guard del techo en /api/pedidos, validación de canal
// delivery (refactor de su inline), y los contextos de front (cartel).
// El cartel del front JAMÁS reemplaza al 409 del server.
//
// 📅 CICLO HORARIO POR DÍAS (contrato CTO 23/09, literal):
//  "Una franja se atribuye al día de su apertura. El día siguiente no
//   interrumpe una jornada ya iniciada; únicamente determina si puede
//   comenzar una nueva jornada."
//  · dias = días (0=domingo…6=sábado) en los que puede COMENZAR una
//    jornada. null / vacío / los 7 = sin restricción (inercia total).
//  · Solo la fila NEGOCIO tiene días; los canales los heredan al pasar
//    el mismo parámetro. Jamás evaluar `diaActual === dia` a secas:
//    a las 00:30 del lunes la jornada del domingo sigue vigente.
//  · Caso canónico: domingo 20:00→04:00 + lunes apagado ⇒ lunes 00:30
//    y 03:59 ABIERTO (jornada del domingo) · 04:00 cierra · 10:00 sigue
//    cerrado (la jornada del lunes no nace).
// ============================================================

export interface Franja { desde: string; hasta: string }
/** 🗓️ Horarios POR DÍA (V2, demanda real Cecchetto: L-V un horario, S-D otro).
 *  Mapa día→franjas ("0"=domingo…"6"=sábado). null = modo simple (todos los
 *  días las mismas franjas de horario_general). Un día presente con [] =
 *  ese día sin restricción horaria (abierto todo el día si su chip habilita). */
export type HorarioPorDia = Partial<Record<string, Franja[]>>

/** Las franjas que rigen un día concreto: la de su día si hay modo por-día,
 *  si no las generales. */
export function franjasDeDia(
  general: Franja[] | null | undefined,
  porDia: HorarioPorDia | null | undefined,
  dia: number,
): Franja[] {
  if (porDia && porDia[String(dia)] !== undefined) return porDia[String(dia)] ?? []
  return general ?? []
}

export function horaMinutosAR(): number {
  const hora = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [hh, mm] = hora.split(':').map(Number)
  return hh * 60 + mm
}

/** Día de la semana en Argentina: 0=domingo … 6=sábado */
export function diaSemanaAR(): number {
  const nombre = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short',
  })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nombre)
}

export const DIAS_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const

/** ¿Este día puede comenzar jornada? (null/vacío/7 = todos) */
export function diaHabilita(dias: number[] | null | undefined, dia: number): boolean {
  if (!dias || dias.length === 0 || dias.length >= 7) return true
  return dias.includes(dia)
}

export function estaAbierto(
  horarios: Franja[] | null | undefined,
  toleranciaMin = 0,
  minActual: number = horaMinutosAR(),
  dias: number[] | null | undefined = null,
  diaActual: number = diaSemanaAR(),
  porDia: HorarioPorDia | null | undefined = null,
): boolean {
  const tol = Number.isFinite(toleranciaMin) ? Number(toleranciaMin) : 0
  const diaAnterior = (diaActual + 6) % 7
  const fHoy = franjasDeDia(horarios, porDia, diaActual)
  const fAyer = franjasDeDia(horarios, porDia, diaAnterior)

  // HOY: jornadas que COMIENZAN hoy (si hoy habilita)
  if (diaHabilita(dias, diaActual)) {
    if (fHoy.length === 0) return true // sin restricción horaria ese día
    const abiertoHoy = fHoy.some(({ desde, hasta }) => {
      const [dh, dm] = desde.split(':').map(Number)
      const [hah, ham] = hasta.split(':').map(Number)
      const minDesde = dh * 60 + dm
      const finCrudo = hah * 60 + ham
      const cruza = finCrudo < minDesde // 18:00→02:00 (y 00:00 cuenta como cruce)
      const minHasta = cruza ? (finCrudo + tol) % 1440 : Math.min(finCrudo + tol, 1439)
      return cruza ? minActual >= minDesde : (minActual >= minDesde && minActual <= minHasta)
    })
    if (abiertoHoy) return true
  }
  // MADRUGADA: jornada que comenzó AYER y cruza (si ayer habilitaba) —
  // el contrato: el día siguiente no interrumpe una jornada ya iniciada
  if (diaHabilita(dias, diaAnterior) && fAyer.length > 0) {
    return fAyer.some(({ desde, hasta }) => {
      const [dh, dm] = desde.split(':').map(Number)
      const [hah, ham] = hasta.split(':').map(Number)
      const minDesde = dh * 60 + dm
      const finCrudo = hah * 60 + ham
      const cruza = finCrudo < minDesde
      if (!cruza) return false
      const minHasta = (finCrudo + tol) % 1440
      return minActual <= minHasta
    })
  }
  return false
}

/**
 * ¿El día es operativo? Verdadero si HOY puede comenzar jornada, o si una
 * jornada iniciada un día hábil sigue vigente (madrugada). Es el gate de
 * DÍA para canales exentos del techo horario (Take Away): un día apagado
 * los cierra por completo, sin tocar su exención de horas.
 */
export function diaOperativo(
  horarios: Franja[] | null | undefined,
  dias: number[] | null | undefined,
  toleranciaMin = 0,
  minActual: number = horaMinutosAR(),
  diaActual: number = diaSemanaAR(),
  porDia: HorarioPorDia | null | undefined = null,
): boolean {
  if (diaHabilita(dias, diaActual)) return true
  return estaAbierto(horarios, toleranciaMin, minActual, dias, diaActual, porDia)
}

/** Próximo día que habilita jornada, contando desde mañana. Para el cartel
 *  "abrimos el [día]". Devuelve el día (0-6); si todos apagados, hoy. */
export function proximoDiaHabil(dias: number[] | null | undefined, desde: number = diaSemanaAR()): number {
  for (let k = 1; k <= 7; k++) {
    const d = (desde + k) % 7
    if (diaHabilita(dias, d)) return d
  }
  return desde
}
