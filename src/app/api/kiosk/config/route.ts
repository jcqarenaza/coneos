import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')

  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('empresa_config')
    .select('primary_color, secondary_color, logo_url, texto_bienvenida')
    .eq('empresa_id', empresa_id)
    .single()

  return NextResponse.json(data ?? {
    primary_color: '#D42B2B',
    secondary_color: '#F5E6A3',
    logo_url: null,
    texto_bienvenida: '¡Bienvenido!',
  })
}
