import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Registro de visita de cliente final (delivery/mesa). Best-effort y anónimo.
// POST { visitante_id, empresa_id, sucursal_id?, canal }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { visitante_id, empresa_id, sucursal_id, canal } = body ?? {}
  if (!visitante_id || !empresa_id || !canal) return NextResponse.json({ ok: false })

  const supabase = createAdminClient()
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const vid = String(visitante_id).slice(0, 80)
  const can = String(canal).toUpperCase().slice(0, 20)

  const { data: existente } = await supabase.from('visitas_canal')
    .select('hits').eq('visitante_id', vid).eq('fecha', hoy).eq('canal', can).maybeSingle()

  if (existente) {
    await supabase.from('visitas_canal')
      .update({ hits: existente.hits + 1, last_seen: new Date().toISOString() })
      .eq('visitante_id', vid).eq('fecha', hoy).eq('canal', can)
  } else {
    await supabase.from('visitas_canal').insert({
      visitante_id: vid, fecha: hoy, canal: can,
      empresa_id, sucursal_id: sucursal_id ?? null,
    })
  }
  return NextResponse.json({ ok: true })
}
