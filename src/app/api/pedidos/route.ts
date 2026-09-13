import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const body = await request.json()
  const {
    empresa_id, sucursal_id, dispositivo_id, items,
    metodo_pago, origen = 'KIOSK',
    tipo_pedido = 'kiosk', costo_envio = 0, datos_delivery = null,
    // MESA: número de mesa + nombre del cliente; pago_mp true = paga ya con MP,
    // false = "pagar al mozo" (va a cocina sin cobrar, queda por cobrar en caja)
    numero_mesa = null, nombre_cliente = null, pago_mp = false,
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
          const finCrudo = hah * 60 + ham
          const cruza = finCrudo < minDesde
          const minHasta = cruza ? (finCrudo + tol) % 1440 : Math.min(finCrudo + tol, 1439)
          return cruza ? (minActual >= minDesde || minActual <= minHasta) : (minActual >= minDesde && minActual <= minHasta)
        })
        if (!dentro) {
          return NextResponse.json({ error: dc.mensaje_fuera_horario ?? 'El delivery ya cerró por hoy.' }, { status: 409 })
        }

  // Validación server-side para pedidos TAKE AWAY: horario propio del canal
  // (mismo motor que delivery, leyendo takeaway_config — decisión CTO: horarios
  // independientes; sin pausa ni costo de envío, el canal no los tiene)
  if (tipo_pedido === 'takeaway') {
    const { data: tc } = await supabase
      .from('takeaway_config')
      .select('activo, horarios, tolerancia_cierre, mensaje_fuera_horario')
      .eq('sucursal_id', sucursal_id)
      .maybeSingle()
    if (!tc?.activo) {
      return NextResponse.json({ error: 'El take away no está disponible en esta sucursal.' }, { status: 409 })
    }
    const horariosTa = (tc.horarios as { desde: string; hasta: string }[] | null) ?? []
    if (horariosTa.length > 0) {
      const tolerancia = Number(tc.tolerancia_cierre ?? 5)
      const horaArg = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
      const [hh, mm] = horaArg.split(':').map(Number)
      const minActual = hh * 60 + mm
      const dentro = horariosTa.some(({ desde, hasta }) => {
        const [dh, dm] = desde.split(':').map(Number)
        const [hah, ham] = hasta.split(':').map(Number)
        const minDesde = dh * 60 + dm
        const finCrudo = hah * 60 + ham
        const cruzaMedianoche = finCrudo < minDesde
        const minHasta = cruzaMedianoche ? (finCrudo + tolerancia) % 1440 : Math.min(finCrudo + tolerancia, 1439)
        if (cruzaMedianoche) return minActual >= minDesde || minActual <= minHasta
        return minActual >= minDesde && minActual <= minHasta
      })
      if (!dentro) {
        return NextResponse.json({ error: tc.mensaje_fuera_horario ?? 'El take away ya cerró por hoy.' }, { status: 409 })
      }
    }
  }
      }
    }
  }

  // ── MESA: resolver la cuenta (regla de Juan Cruz: si hay cuenta abierta con
  // saldo pendiente, el pedido SUMA a esa cuenta; si lo anterior está todo pago,
  // se cierra y se abre cuenta nueva) ──
  let mesa_cuenta_id: string | null = null
  if (origen === 'MESA') {
    if (!numero_mesa || Number(numero_mesa) < 1) {
      return NextResponse.json({ error: 'Falta el número de mesa' }, { status: 400 })
    }
    const { data: cuentaAbierta } = await supabase.from('mesa_cuentas')
      .select('id').eq('sucursal_id', sucursal_id).eq('numero_mesa', Number(numero_mesa))
      .eq('estado', 'abierta').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (cuentaAbierta) {
      const { data: pendiente } = await supabase.from('pedidos')
        .select('id').eq('mesa_cuenta_id', cuentaAbierta.id).eq('pagado', false).limit(1).maybeSingle()
      if (pendiente) {
        mesa_cuenta_id = cuentaAbierta.id
      } else {
        await supabase.from('mesa_cuentas')
          .update({ estado: 'cerrada', closed_at: new Date().toISOString() }).eq('id', cuentaAbierta.id)
      }
    }
    if (!mesa_cuenta_id) {
      const { data: nueva, error: errCuenta } = await supabase.from('mesa_cuentas')
        .insert({ empresa_id, sucursal_id, numero_mesa: Number(numero_mesa), nombre_cliente: nombre_cliente || null })
        .select('id').single()
      if (errCuenta || !nueva) return NextResponse.json({ error: 'No se pudo abrir la cuenta de la mesa' }, { status: 500 })
      mesa_cuenta_id = nueva.id
    }
  }


  // ── Creación TRANSACCIONAL vía RPC crear_pedido_stock (Stock V1) ──
  // Numeración serializada + descuento atómico de stock + pedido + items +
  // opciones en un solo COMMIT. Con controla_stock=false en todos los
  // productos la RPC no toca stock y el resultado es idéntico al histórico.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const dispositivoIdSano = typeof dispositivo_id === 'string' && UUID_RE.test(dispositivo_id) ? dispositivo_id : null

  const codigo_retiro = Math.random().toString(36).substring(2, 6).toUpperCase()
  const esMesa = origen === 'MESA'

  const itemsRpc = items.map((item: {
    presentacion_id: string; nombre_producto_snap: string; nombre_presentacion_snap: string
    precio_snap: number; cantidad: number; opciones?: { opcion_id: string; nombre_snap: string; emoji_snap: string | null; color_snap: string | null }[]
  }) => ({
    presentacion_id: item.presentacion_id || null,
    nombre_producto_snap: item.nombre_producto_snap,
    nombre_presentacion_snap: item.nombre_presentacion_snap,
    precio_snap: item.precio_snap,
    cantidad: item.cantidad,
    opciones: (item.opciones ?? []).map(op => ({
      opcion_id: op.opcion_id, nombre_snap: op.nombre_snap,
      emoji_snap: op.emoji_snap, color_snap: op.color_snap,
    })),
  }))

  const { data: pedido, error } = await supabase.rpc('crear_pedido_stock', {
    p_empresa_id: empresa_id,
    p_sucursal_id: sucursal_id,
    p_dispositivo_id: dispositivoIdSano,
    p_items: itemsRpc,
    p_metodo_pago: esMesa && !pago_mp ? null : metodo_pago,
    p_origen: origen,
    p_tipo_pedido: esMesa ? 'mesa' : tipo_pedido,
    p_costo_envio: Number(costo_envio),
    p_datos_delivery: datos_delivery,
    p_estado: esMesa && !pago_mp ? 'PREPARING' : 'PENDING_PAYMENT',
    p_codigo_retiro: codigo_retiro,
    p_mesa_cuenta_id: mesa_cuenta_id,
    p_numero_mesa: esMesa ? Number(numero_mesa) : null,
    p_pagado: esMesa ? false : null,
    p_nombre_cliente: esMesa
      ? (nombre_cliente || null)
      : (tipo_pedido === 'takeaway' && datos_delivery?.nombre ? datos_delivery.nombre : null),
  })

  if (error || !pedido) {
    // Rechazo limpio por falta de stock (RAISE de la RPC): 409 con el producto
    const msg = error?.message ?? ''
    if (msg.includes('SIN_STOCK:')) {
      const producto = msg.split('SIN_STOCK:')[1]?.split('\n')[0]?.trim() ?? 'un producto'
      return NextResponse.json({ error: `No queda stock de ${producto}. Sacalo del carrito e intentá de nuevo.` }, { status: 409 })
    }
    console.error('[pedidos] Error creando pedido (RPC):', error)
    return NextResponse.json({ error: error?.message ?? 'Error al crear pedido' }, { status: 500 })
  }

  return NextResponse.json({ pedido })
}

