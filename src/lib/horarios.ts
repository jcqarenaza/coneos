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
// ============================================================

export interface Franja { desde: string; hasta: string }

export function horaMinutosAR(): number {
  const hora = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [hh, mm] = hora.split(':').map(Number)
  return hh * 60 + mm
}

export function estaAbierto(
  horarios: Franja[] | null | undefined,
  toleranciaMin = 0,
  minActual: number = horaMinutosAR(),
): boolean {
  if (!horarios || horarios.length === 0) return true // null = sin restricción
  const tol = Number.isFinite(toleranciaMin) ? Number(toleranciaMin) : 0
  return horarios.some(({ desde, hasta }) => {
    const [dh, dm] = desde.split(':').map(Number)
    const [hah, ham] = hasta.split(':').map(Number)
    const minDesde = dh * 60 + dm
    const finCrudo = hah * 60 + ham
    const cruza = finCrudo < minDesde // 18:00→02:00 (y 00:00 cuenta como cruce)
    const minHasta = cruza ? (finCrudo + tol) % 1440 : Math.min(finCrudo + tol, 1439)
    return cruza ? (minActual >= minDesde || minActual <= minHasta)
                 : (minActual >= minDesde && minActual <= minHasta)
  })
}
