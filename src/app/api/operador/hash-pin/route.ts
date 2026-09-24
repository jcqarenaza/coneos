import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Hashea el PIN de un operador EN POSTGRES (pgcrypto, bcrypt $2a$) — el mismo
// motor que usa verificar_pin_operador en el login. Antes se hasheaba con bcrypt
// de JS (variante $2b$) que pgcrypto no valida → todo operador nuevo nacía con
// PIN inválido (bug detectado 04/09 con el operador "prueba" de Casa Central).
//
// ══ EQUIPO V1 (GO CTO 24/09): reglas de PIN server-side ══
// · 4 a 6 dígitos numéricos, validado acá (el form no es autoridad).
// · ÚNICO entre operadores ACTIVOS de la empresa: bcrypt salda distinto cada
//   hash, así que la única vía es verificar el PIN candidato contra cada hash
//   con la MISMA RPC del login (cero lógica de auth nueva). O(activos) — para
//   un equipo de local gastronómico es nada.
// · Al editar, el propio operador se excluye (conservar su PIN no es duplicado).
// · Un DESACTIVADO no bloquea su PIN: desactivar libera el número.
// POST { pin, empresa_id, operador_id? }
export async function POST(request: Request) {
  const { pin, empresa_id, operador_id } = await request.json()
  if (!/^\d{4,6}$/.test(String(pin ?? ''))) {
    return NextResponse.json({ error: 'El PIN debe tener de 4 a 6 dígitos numéricos' }, { status: 400 })
  }
  const supabase = createAdminClient()

  if (empresa_id) {
    let q = supabase.from('operadores')
      .select('id, pin_hash')
      .eq('empresa_id', empresa_id)
      .eq('activo', true)
      .not('pin_hash', 'is', null)
    if (operador_id) q = q.neq('id', operador_id)
    const { data: activos } = await q
    for (const op of activos ?? []) {
      const { data: coincide } = await supabase.rpc('verificar_pin_operador', {
        p_pin: String(pin), p_hash: op.pin_hash,
      })
      if (coincide) {
        return NextResponse.json({ error: 'Ese PIN ya lo usa otro operador activo. Elegí otro.' }, { status: 409 })
      }
    }
  }

  const { data: hash, error } = await supabase.rpc('hashear_pin', { p_pin: String(pin) })
  if (error || !hash) {
    return NextResponse.json({ error: error?.message ?? 'No se pudo generar el hash' }, { status: 500 })
  }
  return NextResponse.json({ hash })
}
