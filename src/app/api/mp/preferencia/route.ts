import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { credencialParaPedido } from '@/lib/pagos/mp'

// Crea una preferencia de pago de MP para un pedido (Fase 3).
// La cuenta la decide resolverPago() vía credencialParaPedido():
// mapeo explícito del canal → esa cuenta; sin mapeo → legacy exacto
// (cascada sucursal → marca). Refresh on-demand incluido.
// SNAPSHOT: pedidos.mp_credencial_id queda grabado con la cuenta REAL
// usada — cambios de mapeo posteriores no afectan pedidos ya creados.
// POST { pedido_id }
export async function POST(request: Request) {
  const { pedido_id } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase
    .from('pedidos')
    .select('id, numero_pedido, total, empresa_id, sucursal_id, tipo_pedido, numero_mesa, empresas(nombre, slug), sucursales(slug)')
    .eq('id', pedido_id)
    .single()

  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  const cred = await credencialParaPedido(supabase, pedido)
  if (!cred.ok) {
    console.error('[mp/preferencia] Sin credencial usable:', cred.error, 'pedido', pedido_id)
    return NextResponse.json({ error: 'Sin Mercado Pago conectado para esta sucursal/empresa' }, { status: 400 })
  }

  const emp = Array.isArray(pedido.empresas) ? pedido.empresas[0] : pedido.empresas

  // HOTFIX retorno MP: las back_urls se arman con el DOMINIO REAL donde navega
  // el cliente (antes hardcodeadas a coneos.vercel.app → quien pagaba desde
  // coneos.com.ar volvía a otro origen y "la app" no se enteraba — caso #13).
  // Whitelist estricta (condición CTO): jamás un dominio externo fabricado.
  // Prioridad: Origin permitido → Host permitido → fallback dominio conocido.
  // notification_url NO se toca: server-to-server, absoluta y estable.
  const hostPermitido = (h: string | null): string | null => {
    if (!h) return null
    const host = h.replace(/^https?:\/\//, '').split('/')[0].toLowerCase()
    const ok = host === 'coneos.com.ar' || host === 'www.coneos.com.ar'
      || host === 'coneos.vercel.app'
      || /^coneos(-[a-z0-9-]+)?\.vercel\.app$/.test(host) // previews del proyecto
    return ok ? `https://${host}` : null
  }
  const base = hostPermitido(request.headers.get('origin'))
    ?? hostPermitido(request.headers.get('host'))
    ?? 'https://coneos.vercel.app'

  // Firma del webhook: credencial exacta (?c=) + firma legacy (?e=&s=) para transición
  const notification = `https://coneos.vercel.app/api/mp/webhook?c=${cred.credencial_id}&e=${pedido.empresa_id}&s=${cred.sucursal_scope ?? ''}`

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cred.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [{
        title: `Pedido #${pedido.numero_pedido}${emp?.nombre ? ` — ${emp.nombre}` : ''}`,
        quantity: 1,
        unit_price: Number(pedido.total),
        currency_id: 'ARS',
      }],
      external_reference: pedido.id,
      notification_url: notification,
      // MESA vuelve A SU MESA (JC 24/09): el cartel genérico de pago-ok no
      // tenía salida y la mesa vive de rondas — el retorno cae en la misma
      // URL de mesa con ?pago=, que muestra el éxito y ofrece "Pedir algo más".
      // Los demás canales conservan su retorno de siempre.
      back_urls: (() => {
        const suc = Array.isArray(pedido.sucursales) ? pedido.sucursales[0] : pedido.sucursales
        if (pedido.tipo_pedido === 'mesa' && pedido.numero_mesa != null && suc?.slug) {
          const mesaUrl = `${base}/${emp?.slug}/mesa/${suc.slug}?m=${pedido.numero_mesa}`
          return { success: `${mesaUrl}&pago=ok&pedido=${pedido.numero_pedido}`, failure: `${mesaUrl}&pago=error&pedido=${pedido.numero_pedido}`, pending: `${mesaUrl}&pago=ok&pedido=${pedido.numero_pedido}` }
        }
        return {
          success: `${base}/${emp?.slug}/pago-ok?pedido=${pedido.numero_pedido}`,
          failure: `${base}/${emp?.slug}/pago-error?pedido=${pedido.numero_pedido}`,
          pending: `${base}/${emp?.slug}/pago-ok?pedido=${pedido.numero_pedido}`,
        }
      })(),
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
