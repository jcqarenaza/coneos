import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET ?empresa_id= → { pedido_ids: string[] } — pedidos con algún comprobante fiscal
// (cualquier estado: emitida, anulada, pendiente). La caja lo usa para ocultar "Eliminar".
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })
  const supabase = createAdminClient()
  const { data } = await supabase.from('facturas')
    .select('pedido_id').eq('empresa_id', empresa_id).neq('estado', 'error')
  const ids = [...new Set((data ?? []).map(f => f.pedido_id).filter(Boolean))]
  return NextResponse.json({ pedido_ids: ids })
}

// POST { empresa_id, pedido_id } → emite Nota de Crédito C (tipo 13) via Edge Function
// Nota: NO exige facturacion_config.activo — se puede anular aunque el módulo esté apagado.
export async function POST(request: Request) {
  const { empresa_id, pedido_id } = await request.json()
  if (!empresa_id || !pedido_id) return NextResponse.json({ error: 'empresa_id y pedido_id requeridos' }, { status: 400 })

  const supabase = createAdminClient()
  // Validación rápida antes de ir a la Edge: debe existir factura emitida tipo 11 del pedido
  const { data: factura } = await supabase.from('facturas')
    .select('id').eq('pedido_id', pedido_id).eq('empresa_id', empresa_id)
    .eq('estado', 'emitida').eq('tipo_cbte', 11).maybeSingle()
  if (!factura) return NextResponse.json({ ok: false, error: 'El pedido no tiene factura emitida para anular' }, { status: 404 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'Faltan variables de entorno' }, { status: 500 })

  const res = await fetch(`${url}/functions/v1/arca-facturar`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresa_id, pedido_id, accion: 'nota_credito' }),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
