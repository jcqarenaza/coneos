import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const body = await request.json()
  const {
    empresa_id, sucursal_id, dispositivo_id, items,
    metodo_pago, origen = 'KIOSK',
    tipo_pedido = 'kiosk', costo_envio = 0, datos_delivery = null,
  } = body

  console.log('[pedidos] body recibido:', JSON.stringify({ empresa_id, sucursal_id, items_length: items?.length, origen }))

  if (!empresa_id || !sucursal_id || !items?.length) {
    return NextResponse.json({ error: 'Datos incompletos', debug: { empresa_id, sucursal_id, items_length: items?.length } }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Validación server-side para pedidos DELIVERY: pausa y horario con tolerancia
  if (origen === 'DELIVERY') {
    const { data: dc } = await supabase
      .from('delivery_config')
      .select('activo, pausado, horarios, tolerancia_cierre, mensaje_pausa, mensaje_fuera_horario')
      .eq('sucursal_id', sucursal_id)
      .maybeSingle()

    if (dc) {
      if (dc.pausado) {
        return NextResponse.json({ error: dc.mensaje_pausa ?? 'El delivery está pausado momentáneamente.' }, { status: 409 })
      }
      const horarios = (dc.horarios as { desde: string; hasta: string }[] | null) ?? []
      if (dc.activo && horarios.length > 0) {
        const horaArg = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })
        const [hh, mm] = horaArg.split(':').map(Number)
        const minActual = hh * 60 + mm
        const tol = Number(dc.tolerancia_cierre ?? 5)
        const dentro = horarios.some(({ desde, hasta }) => {
          const [dh, dm] = desde.split(':').map(Number)
          const [hah, ham] = hasta.split(':').map(Number)
          const minDesde = dh * 60 + dm
          const minHasta = (hah * 60 + ham + tol) % 1440
          const cruza = (hah * 60 + ham) < minDesde || minHasta < minDesde
          return cruza ? (minActual >= minDesde || minActual <= minHasta) : (minActual >= minDesde && minActual <= minHasta)
        })
        if (!dentro) {
          return NextResponse.json({ error: dc.mensaje_fuera_horario ?? 'El delivery ya cerró por hoy.' }, { status: 409 })
        }
      }
    }
  }

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const { data: maxData } = await supabase.from('pedidos')
    .select('numero_pedido')
    .eq('sucursal_id', sucursal_id)
    .eq('fecha_pedido', hoy)
    .order('numero_pedido', { ascending: false })
    .limit(1)

  const numero_pedido = (maxData?.[0]?.numero_pedido ?? 0) + 1
  const codigo_retiro = Math.random().toString(36).substring(2, 6).toUpperCase()

  const total = items.reduce((acc: number, item: { precio_snap: number; cantidad: number }) =>
    acc + Number(item.precio_snap) * item.cantidad, 0) + Number(costo_envio)

  const { data: pedido, error } = await supabase.from('pedidos').insert({
    empresa_id, sucursal_id,
    dispositivo_id: dispositivo_id || null,
    numero_pedido, codigo_retiro,
    estado: 'PENDING_PAYMENT',
    metodo_pago, total,
    fecha_pedido: hoy,
    origen, tipo_pedido,
    costo_envio: Number(costo_envio),
    datos_delivery,
  }).select('id, numero_pedido, codigo_retiro').single()

  if (error || !pedido) {
    console.error('[pedidos] Error creando pedido:', error)
    return NextResponse.json({ error: error?.message ?? 'Error al crear pedido' }, { status: 500 })
  }

  const itemsInsert = items.map((item: {
    presentacion_id: string; nombre_producto_snap: string; nombre_presentacion_snap: string
    precio_snap: number; cantidad: number; opciones?: { opcion_id: string; nombre_snap: string; emoji_snap: string | null; color_snap: string | null }[]
  }) => ({
    pedido_id: pedido.id,
    presentacion_id: item.presentacion_id || null,
    nombre_producto_snap: item.nombre_producto_snap,
    nombre_presentacion_snap: item.nombre_presentacion_snap,
    precio_snap: item.precio_snap,
    cantidad: item.cantidad,
  }))

  const { data: itemsCreados, error: errorItems } = await supabase
    .from('pedido_items').insert(itemsInsert).select('id, presentacion_id')

  if (errorItems) {
    console.error('[pedidos] Error insertando items:', errorItems)
    return NextResponse.json({ error: 'Pedido creado pero error en items: ' + errorItems.message, pedido }, { status: 500 })
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const itemCreado = itemsCreados?.[i]
    if (!itemCreado || !item.opciones?.length) continue
    const { error: errorOpciones } = await supabase.from('pedido_item_opciones').insert(
      item.opciones.map((op: { opcion_id: string; nombre_snap: string; emoji_snap: string | null; color_snap: string | null }) => ({
        pedido_item_id: itemCreado.id,
        opcion_id: op.opcion_id,
        nombre_snap: op.nombre_snap,
        emoji_snap: op.emoji_snap,
        color_snap: op.color_snap,
      }))
    )
    if (errorOpciones) console.error('[pedidos] Error insertando opciones item', i, ':', errorOpciones)
  }

  return NextResponse.json({ pedido })
}
