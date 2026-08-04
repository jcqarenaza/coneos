import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const body = await request.json()
  console.log('MP webhook:', JSON.stringify(body))

  // MP envía notificaciones de tipo "payment"
  if (body.type !== 'payment' || !body.data?.id) {
    return NextResponse.json({ ok: true })
  }

  const paymentId = body.data.id

  // Obtener todos los access tokens configurados para verificar el pago
  const supabase = createAdminClient()
  const { data: sucursales } = await supabase
    .from('sucursal_pagos')
    .select('mp_access_token, sucursal_id, empresa_id')
    .not('mp_access_token', 'is', null)

  if (!sucursales?.length) return NextResponse.json({ ok: true })

  // Intentar verificar el pago con cada token hasta encontrar el correcto
  let payment = null
  let sucursalData = null

  for (const suc of sucursales) {
    if (!suc.mp_access_token) continue
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${suc.mp_access_token}` },
    })
    if (res.ok) {
      payment = await res.json()
      sucursalData = suc
      break
    }
  }

  if (!payment || !payment.external_reference) {
    return NextResponse.json({ ok: true })
  }

  const pedidoId = payment.external_reference
  const status = payment.status // approved, rejected, pending

  if (status === 'approved') {
    await supabase
      .from('pedidos')
      .update({ estado: 'PAID', mp_payment_id: String(paymentId) })
      .eq('id', pedidoId)

    await supabase.from('pedido_estados_log').insert({
      pedido_id: pedidoId,
      estado_anterior: 'PENDING_PAYMENT',
      estado_nuevo: 'PAID',
      operador_id: null,
      notas: `MP payment_id: ${paymentId}`,
    })
  } else if (status === 'rejected') {
    // El pedido queda en PENDING_PAYMENT — el cliente puede ir a caja
    console.log(`MP pago rechazado para pedido ${pedidoId}`)
  }

  return NextResponse.json({ ok: true })
}

// MP también hace GET para verificar el endpoint
export async function GET() {
  return NextResponse.json({ ok: true })
}
