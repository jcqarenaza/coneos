import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { session_id } = await request.json()

  if (!session_id) {
    return NextResponse.json({ error: 'Session ID requerido' }, { status: 400 })
  }

  const supabase = createAdminClient()

  await supabase
    .from('operator_sessions')
    .update({ estado: 'CERRADA', fin: new Date().toISOString() })
    .eq('id', session_id)
    .eq('estado', 'ACTIVA')

  return NextResponse.json({ ok: true })
}
