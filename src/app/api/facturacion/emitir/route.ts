import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET ?empresa_id= → { activa: boolean }  (para que la caja sepa si mostrar/disparar)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })
  const supabase = createAdminClient()
  const { data } = await supabase.from('facturacion_config')
    .select('activo, cert_pem, key_pem').eq('empresa_id', empresa_id).maybeSingle()
  return NextResponse.json({ activa: !!(data?.activo && data?.cert_pem && data?.key_pem) })
}

// POST { empresa_id, pedido_id } → emite Factura C via Edge Function
export async function POST(request: Request) {
  const { empresa_id, pedido_id } = await request.json()
  if (!empresa_id || !pedido_id) return NextResponse.json({ error: 'empresa_id y pedido_id requeridos' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: cfg } = await supabase.from('facturacion_config')
    .select('activo').eq('empresa_id', empresa_id).maybeSingle()
  if (!cfg?.activo) return NextResponse.json({ ok: false, error: 'Facturación desactivada' }, { status: 409 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'Faltan variables de entorno' }, { status: 500 })

  const res = await fetch(`${url}/functions/v1/arca-facturar`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresa_id, pedido_id, accion: 'facturar' }),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
