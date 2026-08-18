import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

  const [{ data: dc }, { data: emp }] = await Promise.all([
    supabase.from('delivery_config')
      .select('costo_envio, horarios, mensaje_fuera_horario, activo')
      .eq('sucursal_id', sucursal_id)
      .single(),
    empresa_id ? supabase.from('empresas')
      .select('nombre, config:empresa_config(primary_color, secondary_color, logo_url)')
      .eq('id', empresa_id)
      .single() : Promise.resolve({ data: null })
  ])

  return NextResponse.json({ hora, delivery_config: dc, empresa_config: emp })
}
