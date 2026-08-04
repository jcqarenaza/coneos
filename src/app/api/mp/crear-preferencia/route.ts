import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { pedido_id, sucursal_id, empresa_id, items, total } = await request.json()

  if (!pedido_id || !sucursal_id || !items?.length) {
    return NextResponse.json({ error: 'Datos requeridos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Obtener access token de la sucursal
  const { data: pagos } = await supabase
    .from('sucursal_pagos')
    .select('mp_access_token, mp_public_key')
    .eq('sucursal_id', sucursal_id)
    .single()

  if (!pagos?.mp_access_token) {
    return NextResponse.json({ error: 'Mercado Pago no configurado para esta sucursal' }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://coneos.vercel.app'

  // Crear preferencia en MP
  const body = {
    items: items.map((item: { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number }) => ({
      title: `${item.nombre_producto_snap} — ${item.nombre_presentacion_snap}`,
      quantity: item.cantidad,
      unit_price: Number(item.precio_snap),
      currency_id: 'ARS',
    })),
    external_reference: pedido_id,
    notification_url: `${baseUrl}/api/mp/webhook`,
    back_urls: {
      success: `${baseUrl}/api/mp/callback?status=approved&pedido_id=${pedido_id}`,
      failure: `${baseUrl}/api/mp/callback?status=rejected&pedido_id=${pedido_id}`,
      pending: `${baseUrl}/api/mp/callback?status=pending&pedido_id=${pedido_id}`,
    },
    auto_return: 'approved',
    statement_descriptor: 'ConeOS',
  }

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${pagos.mp_access_token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json()
    console.error('MP error:', err)
    return NextResponse.json({ error: 'Error al crear preferencia en Mercado Pago' }, { status: 500 })
  }

  const preference = await res.json()

  // Guardar preference_id en el pedido
  await supabase
    .from('pedidos')
    .update({ mp_preference_id: preference.id })
    .eq('id', pedido_id)

  return NextResponse.json({
    preference_id: preference.id,
    init_point: preference.init_point,
    sandbox_init_point: preference.sandbox_init_point,
    public_key: pagos.mp_public_key,
  })
}
