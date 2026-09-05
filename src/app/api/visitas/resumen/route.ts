import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Resumen de tráfico de clientes por empresa (Admin→Tráfico).
// GET ?empresa_id= → últimos 14 días por canal: visitantes, aperturas,
// pedidos del canal y conversión. Cada empresa ve SOLO lo suyo.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const desde = new Date(Date.now() - 14 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const [{ data: visitas }, { data: pedidos }] = await Promise.all([
    supabase.from('visitas_canal')
      .select('fecha, canal, visitante_id, hits')
      .eq('empresa_id', empresa_id).gte('fecha', desde),
    supabase.from('pedidos')
      .select('fecha_pedido, tipo_pedido, estado')
      .eq('empresa_id', empresa_id).gte('fecha_pedido', desde)
      .in('tipo_pedido', ['delivery', 'mesa']),
  ])

  type Dia = { visitantes: number; aperturas: number; pedidos: number }
  const out: Record<string, Record<string, Dia>> = { DELIVERY: {}, MESA: {} }

  for (const v of visitas ?? []) {
    const c = out[v.canal] ?? (out[v.canal] = {})
    const d = c[v.fecha] ?? (c[v.fecha] = { visitantes: 0, aperturas: 0, pedidos: 0 })
    d.visitantes += 1
    d.aperturas += Number(v.hits ?? 1)
  }
  for (const p of pedidos ?? []) {
    if (p.estado === 'PENDING_PAYMENT') continue
    const canal = p.tipo_pedido === 'delivery' ? 'DELIVERY' : 'MESA'
    const c = out[canal]
    const d = c[p.fecha_pedido] ?? (c[p.fecha_pedido] = { visitantes: 0, aperturas: 0, pedidos: 0 })
    d.pedidos += 1
  }

  const serie = (canal: 'DELIVERY' | 'MESA') =>
    Object.entries(out[canal])
      .map(([fecha, d]) => ({ fecha, ...d, conversion: d.visitantes > 0 ? Math.round(1000 * d.pedidos / d.visitantes) / 10 : null }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))

  return NextResponse.json({ delivery: serie('DELIVERY'), mesa: serie('MESA') })
}
