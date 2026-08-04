import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')
  const empresa_id = searchParams.get('empresa_id')

  if (!slug && !empresa_id) return NextResponse.json({ error: 'Parámetro requerido' }, { status: 400 })

  const supabase = createAdminClient()

  let query = supabase.from('empresas').select('id, nombre, slug, plan')
  if (slug) query = query.eq('slug', slug)
  else query = query.eq('id', empresa_id!)

  const { data: empresa } = await query.single()
  if (!empresa) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

  const { data: cfg } = await supabase.from('empresa_config')
    .select('primary_color, secondary_color, logo_url, texto_bienvenida, moneda')
    .eq('empresa_id', empresa.id).single()

  return NextResponse.json({ ...empresa, ...cfg })
}
