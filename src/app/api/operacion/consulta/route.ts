import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Datos de las pantallas de OPERACIÓN (caja/preparación/display), server-side.
// Estas pantallas no tienen sesión de auth propia: sus consultas directas a la
// base funcionaban "de prestado" con la sesión de admin guardada en la máquina
// y morían al vencerse (bug "sin operadores"/"sin pedidos" intermitente).
// Todo pasa por acá, validado por dispositivo; empresa y sucursal salen del
// dispositivo en el servidor (nunca del cliente).
// POST { dispositivo_id, accion, ...params }

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { dispositivo_id, accion } = body ?? {}
  if (!dispositivo_id || !accion) return NextResponse.json({ error: 'Datos requeridos' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: disp } = await supabase.from('dispositivos')
    .select('id, empresa_id, sucursal_id, activo')
    .eq('id', dispositivo_id).maybeSingle()
  if (!disp?.activo) return NextResponse.json({ error: 'Dispositivo no válido' }, { status: 403 })

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  if (accion === 'pedidos_hoy') {
    let query = supabase.from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, total, metodo_pago, notas, created_at, numero_mesa, pagado, nombre_cliente, mesa_cuenta_id, tipo_pedido, costo_envio, datos_delivery, captura_transferencia_url,
        sucursales(nombre),
        pedido_pagos(metodo, monto),
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', disp.empresa_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY', 'DELIVERED'])
      .order('numero_pedido', { ascending: false })
    if (!body.verTodas) query = query.eq('sucursal_id', disp.sucursal_id)
    const { data: pedidos } = await query
    const { data: colaboradores } = await supabase.from('colaboradores')
      .select('id, nombre').eq('empresa_id', disp.empresa_id)
      .eq('activo', true).eq('rol', 'cadete').order('nombre')
    return NextResponse.json({ pedidos: pedidos ?? [], colaboradores: colaboradores ?? [] })
  }

  if (accion === 'historial') {
    if (!body.fecha) return NextResponse.json({ error: 'fecha requerida' }, { status: 400 })
    let query = supabase.from('pedidos')
      .select('id, numero_pedido, codigo_retiro, estado, total, metodo_pago, notas, created_at, numero_mesa, pagado, nombre_cliente, mesa_cuenta_id, tipo_pedido, costo_envio, datos_delivery, colaborador_nombre, pedido_pagos(metodo, monto), pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad, pedido_item_opciones(nombre_snap, emoji_snap))')
      .eq('empresa_id', disp.empresa_id)
      .eq('fecha_pedido', body.fecha)
      .order('numero_pedido', { ascending: true })
    if (!body.verTodas) query = query.eq('sucursal_id', disp.sucursal_id)
    const { data } = await query
    return NextResponse.json({ pedidos: data ?? [] })
  }

  if (accion === 'display') {
    const { data } = await supabase.from('pedidos')
      .select('id, numero_pedido, codigo_retiro')
      .eq('empresa_id', disp.empresa_id)
      .eq('sucursal_id', disp.sucursal_id)
      .eq('fecha_pedido', hoy)
      .eq('estado', 'READY')
      .order('numero_pedido', { ascending: true })
    return NextResponse.json({ pedidos: data ?? [] })
  }

  if (accion === 'delivery_pausado_get') {
    const { data } = await supabase.from('delivery_config')
      .select('pausado').eq('sucursal_id', disp.sucursal_id).maybeSingle()
    return NextResponse.json({ pausado: data?.pausado ?? false })
  }

  if (accion === 'delivery_pausado_set') {
    await supabase.from('delivery_config')
      .update({ pausado: !!body.pausado }).eq('sucursal_id', disp.sucursal_id)
    return NextResponse.json({ ok: true })
  }

  if (accion === 'asignar_cadete') {
    const { pedido_ids, colaborador_id } = body
    if (!Array.isArray(pedido_ids) || !colaborador_id) return NextResponse.json({ error: 'Datos requeridos' }, { status: 400 })
    const { data: col } = await supabase.from('colaboradores')
      .select('id, nombre').eq('id', colaborador_id).eq('empresa_id', disp.empresa_id).maybeSingle()
    if (!col) return NextResponse.json({ error: 'Colaborador no válido' }, { status: 404 })
    await supabase.from('pedidos')
      .update({ colaborador_id: col.id, colaborador_nombre: col.nombre })
      .in('id', pedido_ids).eq('empresa_id', disp.empresa_id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
}
