import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const body = await request.json()
  const { empresa_id, sucursal_id, dispositivo_id, session_id, items, metodo_pago, notas, origen } = body

  if (!empresa_id || !sucursal_id || !items?.length) {
    return NextResponse.json({ error: 'Datos requeridos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Obtener siguiente número correlativo por empresa
  const { data: numeroData, error: numError } = await supabase
    .rpc('siguiente_numero_pedido', { p_empresa_id: empresa_id })

  if (numError) {
    console.error('RPC error:', JSON.stringify(numError))
    return NextResponse.json({ error: 'Error RPC', detail: numError.message }, { status: 500 })
  }

  if (!numeroData) {
    console.error('RPC returned null for empresa_id:', empresa_id)
    return NextResponse.json({ error: 'RPC sin resultado' }, { status: 500 })
  }

  const numero_pedido = numeroData
  const codigo_retiro = String(Math.floor(1000 + Math.random() * 9000))
  const total = items.reduce((acc: number, item: { precio_snap: number; cantidad: number }) => acc + item.precio_snap * item.cantidad, 0)
  const fecha_pedido = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const { data: pedido, error: pedidoError } = await supabase
    .from('pedidos')
    .insert({
      empresa_id,
      sucursal_id,
      dispositivo_id,
      session_id: session_id ?? null,
      numero_pedido,
      codigo_retiro,
      total,
      metodo_pago: metodo_pago ?? 'efectivo',
      notas: notas ?? null,
      origen: origen ?? 'CAJA',
      estado: 'PENDING_PAYMENT',
      fecha_pedido,
    })
    .select('id, numero_pedido, codigo_retiro')
    .single()

  if (pedidoError) {
    console.error('Insert pedido error:', JSON.stringify(pedidoError))
    return NextResponse.json({ error: 'Error creando pedido', detail: pedidoError.message }, { status: 500 })
  }

  if (!pedido) {
    return NextResponse.json({ error: 'Pedido no creado' }, { status: 500 })
  }

  for (const item of items) {
    const { data: pedidoItem, error: itemError } = await supabase
      .from('pedido_items')
      .insert({
        pedido_id: pedido.id,
        presentacion_id: item.presentacion_id,
        nombre_producto_snap: item.nombre_producto_snap,
        nombre_presentacion_snap: item.nombre_presentacion_snap,
        precio_snap: item.precio_snap,
        cantidad: item.cantidad,
      })
      .select('id')
      .single()

    if (itemError) console.error('Item error:', JSON.stringify(itemError))

    if (pedidoItem && item.opciones?.length) {
      const { error: opError } = await supabase.from('pedido_item_opciones').insert(
        item.opciones.map((op: { opcion_id: string; nombre_snap: string; emoji_snap: string | null; color_snap: string | null }) => ({
          pedido_item_id: pedidoItem.id,
          opcion_id: op.opcion_id,
          nombre_snap: op.nombre_snap,
          emoji_snap: op.emoji_snap ?? null,
          color_snap: op.color_snap ?? null,
        }))
      )
      if (opError) console.error('Opcion error:', JSON.stringify(opError))
    }
  }

  await supabase.from('pedido_estados_log').insert({
    pedido_id: pedido.id,
    estado_nuevo: 'PENDING_PAYMENT',
    estado_anterior: null,
    operador_id: null,
  })

  return NextResponse.json({ pedido })
}
