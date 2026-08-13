import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const body = await request.json()
  const {
    empresa_id, sucursal_id, dispositivo_id, items,
    metodo_pago, origen = 'KIOSK',
    tipo_pedido = 'kiosk', costo_envio = 0, datos_delivery = null,
  } = body

  if (!empresa_id || !sucursal_id || !items?.length) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Obtener número de pedido del día
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const { count } = await supabase.from('pedidos')
    .select('*', { count: 'exact', head: true })
    .eq('empresa_id', empresa_id)
    .eq('fecha_pedido', hoy)

  const numero_pedido = (count ?? 0) + 1
  const codigo_retiro = Math.random().toString(36).substring(2, 6).toUpperCase()

  const total = items.reduce((acc: number, item: { precio_snap: number; cantidad: number }) =>
    acc + Number(item.precio_snap) * item.cantidad, 0) + Number(costo_envio)

  // Crear pedido
  const { data: pedido, error } = await supabase.from('pedidos').insert({
    empresa_id,
    sucursal_id,
    dispositivo_id: dispositivo_id || null,
    numero_pedido,
    codigo_retiro,
    estado: 'PENDING_PAYMENT',
    metodo_pago,
    total,
    fecha_pedido: hoy,
    origen,
    tipo_pedido,
    costo_envio: Number(costo_envio),
    datos_delivery,
  }).select('id, numero_pedido, codigo_retiro').single()

  if (error || !pedido) {
    return NextResponse.json({ error: error?.message ?? 'Error al crear pedido' }, { status: 500 })
  }

  // Insertar items
  const itemsInsert = items.map((item: {
    presentacion_id: string; nombre_producto_snap: string; nombre_presentacion_snap: string
    precio_snap: number; cantidad: number; opciones?: { opcion_id: string; nombre_snap: string; emoji_snap: string | null; color_snap: string | null }[]
  }) => ({
    pedido_id: pedido.id,
    empresa_id,
    presentacion_id: item.presentacion_id,
    nombre_producto_snap: item.nombre_producto_snap,
    nombre_presentacion_snap: item.nombre_presentacion_snap,
    precio_snap: item.precio_snap,
    cantidad: item.cantidad,
  }))

  const { data: itemsCreados } = await supabase.from('pedido_items').insert(itemsInsert).select('id, presentacion_id')

  // Insertar opciones
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const itemCreado = itemsCreados?.[i]
    if (!itemCreado || !item.opciones?.length) continue
    await supabase.from('pedido_item_opciones').insert(
      item.opciones.map((op: { opcion_id: string; nombre_snap: string; emoji_snap: string | null; color_snap: string | null }) => ({
        pedido_item_id: itemCreado.id,
        opcion_id: op.opcion_id,
        nombre_snap: op.nombre_snap,
        emoji_snap: op.emoji_snap,
        color_snap: op.color_snap,
      }))
    )
  }

  return NextResponse.json({ pedido })
}
