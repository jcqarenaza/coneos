import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { credencialesParaWebhook } from '@/lib/pagos/mp'

// Webhook de Mercado Pago — confirma pagos (Fase 3 multi-cuenta).
// Resolución de credencial: ?c= (exacta, con refresh on-demand) →
// ?e=&s= (firma legacy) → barrido total (preferencias antiguas).
// TODAS las validaciones previas se conservan: el payment se consulta
// a MP con la credencial (jamás se confía en el browser), el pedido
// se matchea por external_reference Y por empresa de la credencial,
// solo transiciona PENDING_PAYMENT→PAID (idempotencia), y al confirmar
// dispara la facturación ARCA exactamente como antes.

async function facturarSiCorresponde(supabase: ReturnType<typeof createAdminClient>, pedido_id: string) {
  try {
    const { data: pedido } = await supabase.from('pedidos')
      .select('empresa_id, sucursal_id, metodo_pago').eq('id', pedido_id).maybeSingle()
    if (!pedido?.metodo_pago) return

    // Config fiscal: fila de la sucursal → fallback fila de empresa (sucursal_id NULL)
    const cols = 'activo, auto_facturar, metodos_auto, cert_pem, key_pem'
    let cfg: { activo: boolean; auto_facturar: boolean | null; metodos_auto: unknown; cert_pem: string | null; key_pem: string | null } | null = null
    if (pedido.sucursal_id) {
      const { data } = await supabase.from('facturacion_config')
        .select(cols).eq('empresa_id', pedido.empresa_id).eq('sucursal_id', pedido.sucursal_id).maybeSingle()
      cfg = data as typeof cfg
    }
    if (!cfg) {
      const { data } = await supabase.from('facturacion_config')
        .select(cols).eq('empresa_id', pedido.empresa_id).is('sucursal_id', null).maybeSingle()
      cfg = data as typeof cfg
    }
    if (!cfg?.activo || !cfg.cert_pem || !cfg.key_pem) return
    if (cfg.auto_facturar === false) return
    const metodos = Array.isArray(cfg.metodos_auto) ? cfg.metodos_auto as string[] : ['transferencia']
    if (!metodos.includes(pedido.metodo_pago)) return

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return
    const res = await fetch(`${url}/functions/v1/arca-facturar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: pedido.empresa_id, pedido_id, accion: 'facturar' }),
    })
    const d = await res.json().catch(() => null)
    console.log('[mp/webhook][facturacion]', pedido_id, d?.ok ? `CAE ${d.cae} Nro ${d.nro_cbte}` : (d?.error ?? 'sin respuesta'))
  } catch (e) {
    console.error('[mp/webhook][facturacion] hook error', e)
  }
}

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
        await facturarSiCorresponde(supabase, pedido.id)
      }
    }
    break
  }

  return NextResponse.json({ ok: true })
}
