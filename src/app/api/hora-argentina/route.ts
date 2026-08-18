import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sucursal_id = searchParams.get('sucursal_id')

  const hora = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit', hour12: false
  })

  if (!sucursal_id) return NextResponse.json({ hora })

  // Traer delivery_config con service_role para evitar RLS
  const supabase = createAdminClient()
  const { data: dc } = await supabase
    .from('delivery_config')
    .select('costo_envio, horarios, mensaje_fuera_horario, activo')
    .eq('sucursal_id', sucursal_id)
    .single()

  return NextResponse.json({ hora, delivery_config: dc })
}
