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
      .select(`id, numero_pedido, codigo_retiro, estado, total, metodo_pago, notas, created_at, numero_mesa, pagado, nombre_cliente, mesa_cuenta_id, tipo_pedido, costo_envio, datos_delivery, captura_transferencia_url, colaborador_id, colaborador_nombre, hora_retiro, comanda_impresa_at, ticket_impreso_at, updated_at, facturas(estado), cuenta_transfer:cuentas_transferencia(nombre), cuenta_mp:mp_credenciales(nombre),
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
    // Alertas de stock de la sucursal del dispositivo (viaja con el polling de
    // caja, costo ínfimo): agotados y bajos para el aviso del header.
    const { data: st } = await supabase.from('producto_stock')
      .select('cantidad, stock_minimo, productos(nombre)')
      .eq('sucursal_id', disp.sucursal_id)
    const enAlerta = (st ?? [])
      .filter(r => Number(r.cantidad) <= Number(r.stock_minimo))
      .map(r => ({ nombre: (Array.isArray(r.productos) ? r.productos[0] : r.productos)?.nombre ?? '—', cantidad: Number(r.cantidad) }))
      .sort((a, b) => a.cantidad - b.cantidad).slice(0, 12)
    const stockAgotados = enAlerta.filter(r => r.cantidad === 0).length
    const stockBajos = enAlerta.filter(r => r.cantidad > 0).length
    const { data: sucCfg } = await supabase.from('sucursales')
      .select('comanda_auto, ticket_auto').eq('id', disp.sucursal_id).maybeSingle()
    return NextResponse.json({ pedidos: pedidos ?? [], colaboradores: colaboradores ?? [], stock_alertas: { agotados: stockAgotados, bajos: stockBajos, items: enAlerta }, comanda_auto: sucCfg?.comanda_auto ?? false, ticket_auto: sucCfg?.ticket_auto ?? false })
  }

  if (accion === 'historial') {
    if (!body.fecha) return NextResponse.json({ error: 'fecha requerida' }, { status: 400 })
    let query = supabase.from('pedidos')
      .select('id, numero_pedido, codigo_retiro, estado, total, metodo_pago, notas, created_at, numero_mesa, pagado, nombre_cliente, mesa_cuenta_id, tipo_pedido, costo_envio, datos_delivery, captura_transferencia_url, colaborador_nombre, hora_retiro, cuenta_transfer:cuentas_transferencia(nombre), cuenta_mp:mp_credenciales(nombre), pedido_pagos(metodo, monto), pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad, pedido_item_opciones(nombre_snap, emoji_snap))')
      .eq('empresa_id', disp.empresa_id)
      .eq('fecha_pedido', body.fecha)
      .order('numero_pedido', { ascending: true })
    if (!body.verTodas) query = query.eq('sucursal_id', disp.sucursal_id)
    const { data } = await query
    return NextResponse.json({ pedidos: data ?? [] })
  }

  if (accion === 'preparacion') {
    let query = supabase.from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, notas, created_at, tipo_pedido, hora_retiro,
        sucursales(nombre),
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', disp.empresa_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PAID', 'PREPARING'])
      .order('numero_pedido', { ascending: true })
    if (!body.verTodas) query = query.eq('sucursal_id', disp.sucursal_id)
    const { data } = await query
    // V1.5: RÍO ÚNICO por hora efectiva — un TA con hora de retiro se ordena
    // por esa hora; el resto (y los TA "lo antes posible") por llegada. La
    // cocina mira UNA cola y el pedido de las 20:00 no molesta antes de tiempo.
    const ordenados = (data ?? []).sort((a, b) => {
      const ta = Date.parse((a as { hora_retiro?: string | null }).hora_retiro ?? a.created_at)
      const tb = Date.parse((b as { hora_retiro?: string | null }).hora_retiro ?? b.created_at)
      return ta - tb
    })
    return NextResponse.json({ pedidos: ordenados })
  }

  if (accion === 'display') {
    // DISPLAY V2: dos zonas (en preparación / para retirar) para los canales
    // PÚBLICOS de mostrador: kiosk, delivery y takeaway. MESA se excluye —
    // se entrega en la mesa, su número en el mostrador es ruido (decisión CTO).
    const base = () => supabase.from('pedidos')
      .select('id, numero_pedido, codigo_retiro, tipo_pedido')
      .eq('empresa_id', disp.empresa_id)
      .eq('sucursal_id', disp.sucursal_id)
      .eq('fecha_pedido', hoy)
      .neq('tipo_pedido', 'mesa')
      .order('numero_pedido', { ascending: true })
    const [{ data: preparando }, { data: listos }] = await Promise.all([
      base().eq('estado', 'PREPARING'),
      base().eq('estado', 'READY'),
    ])
    // pedidos: compat con clientes viejos del display (solo listos)
    return NextResponse.json({ preparando: preparando ?? [], listos: listos ?? [], pedidos: listos ?? [] })
  }

  // ══ 9c — comanda automática ══
  if (accion === 'comanda_auto_set') {
    await supabase.from('sucursales')
      .update({ comanda_auto: !!body.valor }).eq('id', disp.sucursal_id)
    // Línea de base al ACTIVAR: lo que ya estaba en preparación queda marcado
    // como visto — el automático aplica solo hacia adelante (prender el switch
    // a mitad del día no escupe el backlog histórico de comandas).
    if (body.valor) {
      await supabase.from('pedidos')
        .update({ comanda_impresa_at: new Date().toISOString() })
        .eq('sucursal_id', disp.sucursal_id)
        .eq('estado', 'PREPARING')
        .is('comanda_impresa_at', null)
    }
    return NextResponse.json({ ok: true, comanda_auto: !!body.valor })
  }
  // Claim idempotente de impresión (a prueba de polling: el UPDATE
  // condicional elige UN ganador; la reimpresión manual sigue en su botón).
  if (accion === 'comanda_claim') {
    const { data } = await supabase.from('pedidos')
      .update({ comanda_impresa_at: new Date().toISOString() })
      .eq('id', body.pedido_id).eq('empresa_id', disp.empresa_id)
      .is('comanda_impresa_at', null)
      .select('id')
    return NextResponse.json({ claimed: (data ?? []).length > 0 })
  }

  // ══ 9g — ticket automático (calco exacto del patrón comanda) ══
  if (accion === 'ticket_auto_set') {
    await supabase.from('sucursales')
      .update({ ticket_auto: !!body.valor }).eq('id', disp.sucursal_id)
    // Línea de base SERVER-SIDE al activar (orden CTO): lo ya cobrado queda
    // reclamado — activar el switch a las 10:01 no escupe los 27 de la mañana.
    if (body.valor) {
      await supabase.from('pedidos')
        .update({ ticket_impreso_at: new Date().toISOString() })
        .eq('sucursal_id', disp.sucursal_id)
        .in('estado', ['PREPARING', 'READY', 'DELIVERED'])
        .is('ticket_impreso_at', null)
    }
    return NextResponse.json({ ok: true, ticket_auto: !!body.valor })
  }
  // Claim ATÓMICO e idempotente (condición técnica del CTO): el UPDATE
  // condicional decide UN solo ganador — dos watchers simultáneos jamás
  // imprimen dos veces. Semántica de ticket_impreso_at: "reclamado para
  // autoimpresión, no volver a autoimprimir" — NO "el papel salió"
  // (la garantía física no existe; Reimprimir es la vía humana).
  if (accion === 'ticket_claim') {
    const { data } = await supabase.from('pedidos')
      .update({ ticket_impreso_at: new Date().toISOString() })
      .eq('id', body.pedido_id).eq('empresa_id', disp.empresa_id)
      .is('ticket_impreso_at', null)
      .select('id')
    return NextResponse.json({ claimed: (data ?? []).length > 0 })
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
