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
  }

  return NextResponse.json({ ok: true })
}
