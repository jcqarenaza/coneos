import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Registro de visita de cliente final (todas las puertas públicas).
// Best-effort y anónimo. POST { visitante_id, empresa_id, sucursal_id?, canal, referrer?, utm? }
//
// ══ TRÁFICO V1 (GO CTO 24/09) ══
// · Identidad multi-tenant: empresa + visitante + fecha + canal (BUG curado:
//   el match viejo omitía empresa — dos heladerías el mismo día colisionaban
//   y la segunda nunca registraba).
// · Adquisición first-known: referrer/utm se guardan al nacer la fila, y en
//   updates SOLO rellenan si aún son null — el primer origen conocido del día
//   jamás se pisa (10:00 Instagram + 12:00 directo → queda Instagram).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { visitante_id, empresa_id, sucursal_id, canal, referrer, utm } = body ?? {}
  if (!visitante_id || !empresa_id || !canal) return NextResponse.json({ ok: false })

  const supabase = createAdminClient()
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const vid = String(visitante_id).slice(0, 80)
  const can = String(canal).toUpperCase().slice(0, 20)
  const ref = typeof referrer === 'string' && referrer ? referrer.slice(0, 300) : null
  const utmVal = utm && typeof utm === 'object' && Object.keys(utm).length ? utm : null

  const { data: existente } = await supabase.from('visitas_canal')
    .select('hits, referrer, utm')
    .eq('empresa_id', empresa_id).eq('visitante_id', vid).eq('fecha', hoy).eq('canal', can)
    .maybeSingle()

  if (existente) {
    const patch: Record<string, unknown> = { hits: existente.hits + 1, last_seen: new Date().toISOString() }
    if (!existente.referrer && ref) patch.referrer = ref
    if (!existente.utm && utmVal) patch.utm = utmVal
    await supabase.from('visitas_canal')
      .update(patch)
      .eq('empresa_id', empresa_id).eq('visitante_id', vid).eq('fecha', hoy).eq('canal', can)
  } else {
    await supabase.from('visitas_canal').insert({
      visitante_id: vid, fecha: hoy, canal: can,
      empresa_id, sucursal_id: sucursal_id ?? null,
      referrer: ref, utm: utmVal,
    })
  }
  return NextResponse.json({ ok: true })
}
