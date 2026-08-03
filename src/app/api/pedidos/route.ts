import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { empresa_id, sucursal_id, dispositivo_id, session_id, items, metodo_pago, notas } = await request.json()

  if (!empresa_id || !sucursal_id || !items?.length) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Obtener número de pedido
  const hoy = new Date().toISOString().split('T')[0]
  const { data: numData } = await supabase.rpc('get_next_pedido_numero', {
    p_sucursal_id: sucursal_id,
    p_fecha: hoy,
  })

  const total = items.reduce((acc: number, item: { precio_snap: number; cantidad: number }) =>
    acc + item.precio_snap * item.cantidad, 0)

  // Crear pedido
  const { data: pedido, error } = await supabase
    .from('pedidos')
    .insert({
      empresa_id,
      sucursal_id,
      dispositivo_id: dispositivo_id || null,
      operator_session_id: session_id || null,
      numero_pedido: numData,
      fecha_pedido: hoy,
      origen: 'CAJA',
      estado: metodo_pago ? 'PAID' : 'PENDING_PAYMENT',
      metodo_pago: metodo_pago || null,
      total,
      notas: notas || null,
    })
    .select('id, numero_pedido, codigo_retiro')
    .single()

  if (error || !pedido) {
    return NextResponse.json({ error: 'Error al crear pedido' }, { status: 500 })
  }

  // Crear items
  for (const item of items) {
    const { data: pedidoItem } = await supabase
      .from('pedido_items')
      .insert({
        pedido_id: pedido.id,
        presentacion_id: item.presentacion_id,
        nombre_producto_snap: item.nombre_producto_snap,
        nombre_presentacion_snap: item.nombre_presentacion_snap,
        precio_snap: item.precio_snap,
        cantidad: item.cantidad,
        notas: item.notas || null,
      })
      .select('id')
      .single()

    if (pedidoItem && item.opciones?.length) {
      await supabase.from('pedido_item_opciones').insert(
        item.opciones.map((op: { opcion_id: string; nombre_snap: string; color_snap?: string; emoji_snap?: string }) => ({
          pedido_item_id: pedidoItem.id,
          opcion_id: op.opcion_id,
          nombre_snap: op.nombre_snap,
          color_snap: op.color_snap || null,
          emoji_snap: op.emoji_snap || null,
        }))
      )
    }
  }

  // Log estado inicial
  await supabase.from('pedido_estados_log').insert({
    pedido_id: pedido.id,
    estado_anterior: null,
    estado_nuevo: metodo_pago ? 'PAID' : 'PENDING_PAYMENT',
  })

  return NextResponse.json({ pedido })
}
