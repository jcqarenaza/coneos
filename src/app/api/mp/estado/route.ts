import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Verifica si hay MP conectado para el alcance consultado.
// GET ?empresa_id=X            → cuenta de la marca (fila sucursal_id NULL)
// GET ?empresa_id=X&sucursal_id=Z → { conectado, propio, heredado }:
//   propio = la sucursal tiene cuenta vinculada; heredado = usa la de la marca.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  const sucursal_id = searchParams.get('sucursal_id')
  if (!empresa_id) return NextResponse.json({ conectado: false })

  const supabase = createAdminClient()
  const { data: marca } = await supabase
    .from('mp_credenciales')
    .select('id')
    .eq('empresa_id', empresa_id)
    .is('sucursal_id', null)
    .maybeSingle()

  if (!sucursal_id) return NextResponse.json({ conectado: !!marca })

  const { data: propia } = await supabase
    .from('mp_credenciales')
    .select('id')
    .eq('empresa_id', empresa_id)
    .eq('sucursal_id', sucursal_id)
    .maybeSingle()

  return NextResponse.json({ conectado: !!(propia || marca), propio: !!propia, heredado: !propia && !!marca })
}
