import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { estaAbierto, diaHabilita, diaSemanaAR, horaMinutosAR, type Franja, type HorarioPorDia } from '@/lib/horarios'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sucursal_id = searchParams.get('sucursal_id')
  const empresa_id = searchParams.get('empresa_id')

  const hora = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit', hour12: false
  })

  if (!sucursal_id) return NextResponse.json({ hora })

  const supabase = createAdminClient()

  const [{ data: dc }, { data: emp }, { data: suc }] = await Promise.all([
    supabase.from('delivery_config')
      .select('costo_envio, horarios, mensaje_fuera_horario, activo, pausado, mensaje_pausa, tolerancia_cierre, permitir_programado')
      .eq('sucursal_id', sucursal_id)
      .single(),
    empresa_id ? supabase.from('empresas')
      .select('nombre, config:empresa_config(primary_color, secondary_color, logo_url)')
      .eq('id', empresa_id)
      .single() : Promise.resolve({ data: null }),
    supabase.from('sucursales')
      .select('activo, horario_general, mensaje_cerrado, tolerancia_cierre, dias_apertura, horario_por_dia')
      .eq('id', sucursal_id)
      .maybeSingle()
  ])

  // 📅 EL TECHO CON DÍAS, resuelto acá (server): la vidriera de delivery
  // deja de mostrarse abierta un día cerrado — cura de raíz el agujero
  // "vidriera no compone techo" (contrato de jornada del CTO 23/09).
  const techoF = (suc?.horario_general as Franja[] | null) ?? []
  const diasAp = (suc?.dias_apertura as number[] | null) ?? null
  const porDia = (suc?.horario_por_dia as HorarioPorDia | null) ?? null
  const tolNeg = Number(suc?.tolerancia_cierre ?? 0)
  const sucursalInactiva = (suc as { activo?: boolean } | null)?.activo === false
  const techo_abierto = !sucursalInactiva && (porDia
    ? estaAbierto(techoF, tolNeg, horaMinutosAR(), diasAp, diaSemanaAR(), porDia)
    : (techoF.length === 0
      ? diaHabilita(diasAp, diaSemanaAR())
      : estaAbierto(techoF, tolNeg, horaMinutosAR(), diasAp)))

  return NextResponse.json({ hora, delivery_config: dc, empresa_config: emp, techo_abierto, mensaje_negocio: sucursalInactiva ? '🟠 Esta sucursal no se encuentra disponible.' : (suc?.mensaje_cerrado ?? null) })
}
