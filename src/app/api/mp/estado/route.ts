import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Verifica si una empresa tiene MP conectado
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  if (!empresa_id) return NextResponse.json({ conectado: false })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('mp_credenciales')
    .select('id')
    .eq('empresa_id', empresa_id)
    .maybeSingle()

  return NextResponse.json({ conectado: !!data })
}
