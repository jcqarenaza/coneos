import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Webhook de Mercado Pago — confirma pagos
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ ok: true })

  // MP manda type=payment con data.id
  const paymentId = body?.data?.id
  const type = body?.type ?? body?.topic

  if (type !== 'payment' || !paymentId) {
    return NextResponse.json({ ok: true })
  }

  const supabase = createAdminClient()

  // Necesitamos saber de qué empresa es el pago — probamos con todas las credenciales
  // (MP no incluye empresa en el webhook, pero el payment tiene external_reference = pedido_id)
  const { data: credenciales } = await supabase.from('mp_credenciales').select('empresa_id, access_token')

  for (const cred of credenciales ?? []) {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${cred.access_token}` },
    })
    if (!res.ok) continue

    const payment = await res.json()
    const pedidoId = payment.external_reference
    if (!pedidoId) continue

    if (payment.status === 'approved') {
      const { data: pedido } = await supabase
        .from('pedidos')
        .select('id, estado, empresa_id')
        .eq('id', pedidoId)
        .eq('empresa_id', cred.empresa_id)
        .single()

      if (pedido && pedido.estado === 'PENDING_PAYMENT') {
        await supabase.from('pedidos')
          .update({ estado: 'PAID', notas: `MP payment ${paymentId}` })
          .eq('id', pedido.id)
        console.log(`[mp/webhook] Pedido ${pedidoId} pagado via MP ${paymentId}`)
      }
    }
    break
  }

  return NextResponse.json({ ok: true })
}
