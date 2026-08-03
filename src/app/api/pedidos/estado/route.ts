import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

  return NextResponse.json({ ok: true })
}
