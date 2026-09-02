import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { acreditarPuntosPedido } from '@/lib/beneficios'

// GET ?pedido_id= → estado mínimo del pedido, para que kiosk/delivery (anónimos)
// detecten el pago MP y muestren número y código de retiro.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pedido_id = searchParams.get('pedido_id')
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('pedidos')
    .select('estado, numero_pedido, codigo_retiro')
    .eq('id', pedido_id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  return NextResponse.json(data)
}

// Facturación automática: al cobrar, emitir si el método del pedido está habilitado
// por el cliente (auto_facturar + metodos_auto). Único punto de disparo — la caja ya
// no dispara por su cuenta, así no hay carrera de doble emisión. Silencioso: nunca
// bloquea el cambio de estado; la Edge es idempotente (rechaza pedido ya facturado).

// Resuelve la config de facturación: fila de la sucursal si existe, si no la de la
// empresa (sucursal_id NULL). Devuelve null si no hay ninguna.
async function resolverFactConfig(supabase: ReturnType<typeof createAdminClient>, empresaId: string, sucursalId: string | null, columnas: string) {
  if (sucursalId) {
    const { data } = await supabase.from('facturacion_config')
      .select(columnas).eq('empresa_id', empresaId).eq('sucursal_id', sucursalId).maybeSingle()
    if (data) return data
  }
  const { data } = await supabase.from('facturacion_config')
    .select(columnas).eq('empresa_id', empresaId).is('sucursal_id', null).maybeSingle()
  return data
}
async function facturarSiCorresponde(pedido_id: string) {
  try {
    const supabase = createAdminClient()
    const { data: pedido } = await supabase.from('pedidos')
      .select('empresa_id, sucursal_id, metodo_pago').eq('id', pedido_id).maybeSingle()
    if (!pedido?.metodo_pago) return
    const cfg = await resolverFactConfig(supabase, pedido.empresa_id, pedido.sucursal_id ?? null,
      'activo, auto_facturar, metodos_auto, cert_pem, key_pem') as
      { activo: boolean; auto_facturar: boolean | null; metodos_auto: unknown; cert_pem: string | null; key_pem: string | null } | null
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
    console.log('[facturacion]', pedido_id, d?.ok ? `CAE ${d.cae} Nro ${d.nro_cbte}` : (d?.error ?? 'sin respuesta'))
  } catch (e) {
    console.error('[facturacion] hook error', e)
  }
}

// POST — cambio de estado desde caja (original Sprint 3B, restaurado)
export async function POST(request: Request) {
  const { pedido_id, estado_nuevo, operador_id } = await request.json()
  const supabase = createAdminClient()
  const { data: pedido } = await supabase
    .from('pedidos')
    .select('estado')
    .eq('id', pedido_id)
    .single()
  if (!pedido) {
    return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  }
  await supabase.from('pedidos').update({
    estado: estado_nuevo,
    updated_at: new Date().toISOString(),
  }).eq('id', pedido_id)
  await supabase.from('pedido_estados_log').insert({
    pedido_id,
    operador_id: operador_id || null,
    estado_anterior: pedido.estado,
    estado_nuevo,
  })

  // Beneficios: al cobrar/entregar, acreditar puntos si hay teléfono vinculado.
  // Idempotente y silencioso — nunca bloquea el cambio de estado.
  if (estado_nuevo === 'PAID' || estado_nuevo === 'DELIVERED') {
    await acreditarPuntosPedido(pedido_id).catch(() => {})
    // Facturación: solo la primera vez que pasa a cobrado (si venía de un estado
    // cobrado, ya se intentó antes; la Edge rechaza duplicados igual)
    if (!['PAID', 'PREPARING', 'READY', 'DELIVERED'].includes(pedido.estado)) {
      await facturarSiCorresponde(pedido_id)
    }
  }

  return NextResponse.json({ ok: true })
}
