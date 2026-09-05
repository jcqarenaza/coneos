import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Crea una preferencia de pago de MP para un pedido.
// Credenciales: las de la SUCURSAL del pedido si tiene cuenta propia (franquicia),
// si no las de la marca (fila sucursal_id NULL) — la plata cae en la cuenta correcta.
// POST { pedido_id }
export async function POST(request: Request) {
  const { pedido_id } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase
    .from('pedidos')
    .select('id, numero_pedido, total, empresa_id, sucursal_id, empresas(nombre, slug)')
    .eq('id', pedido_id)
    .single()

  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  // Credenciales: sucursal propia → fallback marca. Recordamos el alcance usado
  // para firmarlo en el notification_url (así el webhook va directo, sin probar
  // todas las credenciales — clave a partir de ~10 cuentas conectadas).
  let cred: { access_token: string } | null = null
  let credScope: string = ''
  if (pedido.sucursal_id) {
    const { data } = await supabase.from('mp_credenciales')
      .select('access_token')
      .eq('empresa_id', pedido.empresa_id).eq('sucursal_id', pedido.sucursal_id)
      .maybeSingle()
    if (data) { cred = data; credScope = pedido.sucursal_id }
  }
  if (!cred) {
    const { data } = await supabase.from('mp_credenciales')
      .select('access_token')
      .eq('empresa_id', pedido.empresa_id).is('sucursal_id', null)
      .maybeSingle()
    cred = data
  }

  if (!cred) return NextResponse.json({ error: 'Sin Mercado Pago conectado para esta sucursal/empresa' }, { status: 400 })

  const emp = Array.isArray(pedido.empresas) ? pedido.empresas[0] : pedido.empresas

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cred.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [{
        title: `Pedido #${pedido.numero_pedido} — ${emp?.nombre ?? 'Heladería'}`,
        quantity: 1,
        unit_price: Number(pedido.total),
        currency_id: 'ARS',
      }],
      external_reference: pedido.id,
      notification_url: `https://coneos.vercel.app/api/mp/webhook?e=${pedido.empresa_id}&s=${credScope}`,
      back_urls: {
        success: `https://coneos.vercel.app/${emp?.slug}/pago-ok?pedido=${pedido.numero_pedido}`,
        failure: `https://coneos.vercel.app/${emp?.slug}/pago-error?pedido=${pedido.numero_pedido}`,
        pending: `https://coneos.vercel.app/${emp?.slug}/pago-ok?pedido=${pedido.numero_pedido}`,
      },
      auto_return: 'approved',
      statement_descriptor: emp?.nombre?.substring(0, 22) ?? 'ConeOS',
    }),
  })

  const data = await res.json()

  if (!res.ok || !data.init_point) {
    console.error('[mp/preferencia] Error:', data)
    return NextResponse.json({ error: 'Error creando preferencia de pago' }, { status: 500 })
  }

  return NextResponse.json({ init_point: data.init_point, preference_id: data.id })
}
