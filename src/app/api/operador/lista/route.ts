import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Lista de operadores para la pantalla de caja/preparación.
// Server-side a propósito: la pantalla de operación NO tiene sesión de auth
// propia — la consulta directa desde el navegador dependía de una sesión de
// admin "prestada" en esa máquina, y al vencerse la lista venía vacía
// ("sin operadores" intermitente). Validamos por dispositivo, como el login.
// POST { dispositivo_id }
export async function POST(request: Request) {
  const { dispositivo_id } = await request.json()
  if (!dispositivo_id) return NextResponse.json({ error: 'dispositivo_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: disp } = await supabase.from('dispositivos')
    .select('id, empresa_id, sucursal_id, activo')
    .eq('id', dispositivo_id).maybeSingle()
  if (!disp?.activo) return NextResponse.json({ error: 'Dispositivo no válido' }, { status: 403 })

  // Operadores de la sucursal del dispositivo + los "de toda la empresa" (sin sucursal)
  const { data: operadores } = await supabase.from('operadores')
    .select('id, nombre, sucursal_id')
    .eq('empresa_id', disp.empresa_id)
    .eq('activo', true)
    .order('nombre')

  const lista = (operadores ?? [])
    .filter(o => !o.sucursal_id || o.sucursal_id === disp.sucursal_id)
    .map(o => ({ id: o.id, nombre: o.nombre }))

  return NextResponse.json({ operadores: lista })
}
