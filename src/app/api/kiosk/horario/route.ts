import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { estaAbierto, diaHabilita, diaSemanaAR, horaMinutosAR, type Franja, type HorarioPorDia } from '@/lib/horarios'

// ═══════════════════════════════════════════════════════════════════
// CICLO 3 — GATE DEL KIOSK POR HORARIO DEL NEGOCIO
// "El kiosk va de la mano del horario de la sucursal" (spec JC).
// Compone lo que YA existe: sucursales.horario_general + mensaje_cerrado
// + tolerancia_cierre, evaluado server-side con la fuente única
// estaAbierto y la hora ARG. Sin franjas cargadas = abierto siempre
// (semántica vigente). El tótem consulta al arrancar y cada minuto.
// ═══════════════════════════════════════════════════════════════════

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sucursalId = searchParams.get('sucursal_id')
  if (!sucursalId) return NextResponse.json({ error: 'Falta sucursal_id' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: suc } = await supabase.from('sucursales')
    .select('horario_general, mensaje_cerrado, tolerancia_cierre, dias_apertura, horario_por_dia')
    .eq('id', sucursalId).maybeSingle()
  if (!suc) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 })

  const horarios = (suc.horario_general as Franja[] | null) ?? []
  const dias = (suc.dias_apertura as number[] | null) ?? null
  // 📅 Sin franjas: el día decide solo. Con franjas: el motor aplica el
  // contrato de jornada (el día pertenece a su apertura).
  const porDia = (suc.horario_por_dia as HorarioPorDia | null) ?? null
  const abierto = porDia
    ? estaAbierto(horarios, Number(suc.tolerancia_cierre ?? 5), horaMinutosAR(), dias, diaSemanaAR(), porDia)
    : (horarios.length === 0
      ? diaHabilita(dias, diaSemanaAR())
      : estaAbierto(horarios, Number(suc.tolerancia_cierre ?? 5), horaMinutosAR(), dias))

  return NextResponse.json({
    abierto,
    horarios,
    mensaje: suc.mensaje_cerrado ?? '¡Volvemos pronto!',
  })
}
