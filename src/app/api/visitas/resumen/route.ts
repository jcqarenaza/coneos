import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Resumen de tráfico de clientes por empresa (Admin→Tráfico).
// GET ?empresa_id= → últimos 14 días por canal: visitantes, aperturas,
// pedidos del canal y conversión. Cada empresa ve SOLO lo suyo.
//
// ══ TRÁFICO V1 (GO CTO 24/09) ══
// · Canales completos: DELIVERY · TAKEAWAY · MESA · APP.
// · APP no es tipo_pedido: es el techo del embudo — su conversión se mide
//   contra los pedidos ONLINE (delivery + takeaway) del día.
// · Adquisición: top de referrers y utm_source de los 14 días.
// · Destino delivery ("¿a dónde entregamos?"): agrupa datos_delivery por la
//   dimensión estable existente (dirección normalizada) — sin geo, sin mapas,
//   sin inventar barrios desde texto libre (regla 15).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const desde = new Date(Date.now() - 14 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const [{ data: visitas }, { data: pedidos }] = await Promise.all([
    supabase.from('visitas_canal')
      .select('fecha, canal, visitante_id, hits, referrer, utm')
      .eq('empresa_id', empresa_id).gte('fecha', desde),
    supabase.from('pedidos')
      .select('fecha_pedido, tipo_pedido, estado, datos_delivery')
      .eq('empresa_id', empresa_id).gte('fecha_pedido', desde)
      .in('tipo_pedido', ['delivery', 'mesa', 'takeaway']),
  ])

  type Dia = { visitantes: number; aperturas: number; pedidos: number }
  const CANALES = ['DELIVERY', 'MESA', 'TAKEAWAY', 'APP'] as const
  const out: Record<string, Record<string, Dia>> = { DELIVERY: {}, MESA: {}, TAKEAWAY: {}, APP: {} }
  const dia = (canal: string, fecha: string) => {
    const c = out[canal] ?? (out[canal] = {})
    return c[fecha] ?? (c[fecha] = { visitantes: 0, aperturas: 0, pedidos: 0 })
  }

  const refCount: Record<string, number> = {}
  const utmCount: Record<string, number> = {}
  for (const v of visitas ?? []) {
    const d = dia(v.canal, v.fecha)
    d.visitantes += 1
    d.aperturas += Number(v.hits ?? 1)
    if (v.referrer) {
      // host pelado del referrer: legible sin guardar nada nuevo
      let host = v.referrer
      try { host = new URL(v.referrer).hostname.replace(/^www\./, '') } catch {}
      refCount[host] = (refCount[host] ?? 0) + 1
    }
    const src = (v.utm as { source?: string } | null)?.source
    if (src) utmCount[src] = (utmCount[src] ?? 0) + 1
  }

  const destinoCount: Record<string, number> = {}
  let destinoTotal = 0
  for (const p of pedidos ?? []) {
    if (p.estado === 'PENDING_PAYMENT') continue
    const canal = p.tipo_pedido === 'delivery' ? 'DELIVERY' : p.tipo_pedido === 'takeaway' ? 'TAKEAWAY' : 'MESA'
    dia(canal, p.fecha_pedido).pedidos += 1
    // APP convierte contra lo ONLINE (delivery + TA)
    if (canal === 'DELIVERY' || canal === 'TAKEAWAY') dia('APP', p.fecha_pedido).pedidos += 1
    if (canal === 'DELIVERY') {
      const dd = p.datos_delivery as { direccion?: string } | null
      const dir = (dd?.direccion ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
      if (dir) { destinoCount[dir] = (destinoCount[dir] ?? 0) + 1; destinoTotal += 1 }
    }
  }

  const serie = (canal: (typeof CANALES)[number]) =>
    Object.entries(out[canal])
      .map(([fecha, d]) => ({ fecha, ...d, conversion: d.visitantes > 0 ? Math.round(1000 * d.pedidos / d.visitantes) / 10 : null }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))

  const top = (m: Record<string, number>, n = 8) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ nombre: k, visitas: v }))

  const destinos = Object.entries(destinoCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([destino, cant]) => ({
      destino: destino.replace(/\b\w/g, c => c.toUpperCase()),
      pedidos: cant,
      participacion: destinoTotal > 0 ? Math.round(1000 * cant / destinoTotal) / 10 : 0,
    }))

  return NextResponse.json({
    delivery: serie('DELIVERY'), mesa: serie('MESA'),
    takeaway: serie('TAKEAWAY'), app: serie('APP'),
    adquisicion: { referrers: top(refCount), utm_sources: top(utmCount) },
    destinos: { total: destinoTotal, items: destinos },
  })
}
