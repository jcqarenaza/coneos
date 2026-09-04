import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Webhook de Mercado Pago — confirma pagos.
// Además, al confirmar dispara la facturación automática (mismo criterio que el hook
// de /api/pedidos/estado): los pagos MP no pasan por la route de estado, así que sin
// esto facturaban recién al marcar entregado.

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

  // Necesitamos saber de qué cuenta es el pago — probamos con todas las credenciales
  // (ahora incluye las de sucursales/franquicias; el payment tiene
  // external_reference = pedido_id y validamos que el pedido sea de esa empresa)
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
          .update({ estado: 'PAID', pagado: true, notas: `MP payment ${paymentId}` })
          .eq('id', pedido.id)
        console.log(`[mp/webhook] Pedido ${pedidoId} pagado via MP ${paymentId}`)
        await facturarSiCorresponde(supabase, pedido.id)
      }
    }
    break
  }

  return NextResponse.json({ ok: true })
}
