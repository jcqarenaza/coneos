import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Hashea el PIN de un operador EN POSTGRES (pgcrypto, bcrypt $2a$) — el mismo
// motor que usa verificar_pin_operador en el login. Antes se hasheaba con bcrypt
// de JS (variante $2b$) que pgcrypto no valida → todo operador nuevo nacía con
// PIN inválido (bug detectado 04/09 con el operador "prueba" de Casa Central).
export async function POST(request: Request) {
  const { pin } = await request.json()
  if (!pin || String(pin).length < 4) {
    return NextResponse.json({ error: 'PIN inválido' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { data: hash, error } = await supabase.rpc('hashear_pin', { p_pin: String(pin) })
  if (error || !hash) {
    return NextResponse.json({ error: error?.message ?? 'No se pudo generar el hash' }, { status: 500 })
  }
  return NextResponse.json({ hash })
}
