import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { credencialesParaWebhook } from '@/lib/pagos/mp'
import { facturarSiCorresponde } from '@/lib/facturacion/facturar'

// Webhook de Mercado Pago — confirma pagos (Fase 3 multi-cuenta).
// Resolución de credencial: ?c= (exacta, con refresh on-demand) →
// ?e=&s= (firma legacy) → barrido total (preferencias antiguas).
// TODAS las validaciones previas se conservan: el payment se consulta
// a MP con la credencial (jamás se confía en el browser), el pedido
// se matchea por external_reference Y por empresa de la credencial,
// solo transiciona PENDING_PAYMENT→PAID (idempotencia), y al confirmar
// dispara la facturación ARCA exactamente como antes.

// MULTI-CUIT B1: la copia local de facturarSiCorresponde MURIÓ — única casa
// en @/lib/facturacion/facturar (T3). Diferencia heredada A FAVOR: la del lib
// además manda el receptor FA-1 del pedido si existe (la copia local no lo
// hacía) — un pedido con receptor cobrado por webhook ahora factura igual que
// cobrado por caja. Una regla, una casa.
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

  const { searchParams } = new URL(request.url)
  const { candidatas, via } = await credencialesParaWebhook(supabase, searchParams)

  for (const cred of candidatas) {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${cred.access_token}` },
    })
    if (!res.ok) continue

    const payment = await res.json()
    const pedidoId = payment.external_reference
    if (!pedidoId) continue

    if (payment.status === 'approved') {
      // El pedido debe pertenecer a la MISMA empresa que la credencial que
      // reconoció el payment — una credencial jamás confirma pedidos ajenos.
      const { data: pedido } = await supabase
        .from('pedidos')
        .select('id, estado, empresa_id, notas')
        .eq('id', pedidoId)
        .eq('empresa_id', cred.empresa_id)
        .single()

      if (pedido && pedido.estado === 'PENDING_PAYMENT') {
        await supabase.from('pedidos')
          // 9c: pago confirmado → PREPARING. (JC 25/09) el id del pago va a SU columna
          // (el ticket imprime la operación) y la nota ya no pisa las notas del cliente.
          .update({
            estado: 'PREPARING', pagado: true, mp_payment_id: String(paymentId),
            notas: pedido.notas ? `${pedido.notas} · MP payment ${paymentId}` : `MP payment ${paymentId}`,
          })
          .eq('id', pedido.id)
        console.log(`[mp/webhook] Pedido ${pedidoId} pagado via MP ${paymentId} (via ${via})`)
        await facturarSiCorresponde(pedido.id)
      }
    }
    break
  }

  return NextResponse.json({ ok: true })
}
