import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizarTelefono, getConfigBeneficios, acreditarPuntosPedido } from '@/lib/beneficios'

// GET ?empresa_id=&telefono= → { activo, puntos, canjeables: [{id,nombre,puntos_canje}] }
// Para kiosk/delivery (anónimos): consulta de saldo y premios alcanzables.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  const telefonoRaw = searchParams.get('telefono')
  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })

  const cfg = await getConfigBeneficios(empresa_id)
  if (!cfg.activo) return NextResponse.json({ activo: false })

  const supabase = createAdminClient()
  let puntos = 0
  if (telefonoRaw) {
    const telefono = normalizarTelefono(telefonoRaw)
    const { data: cliente } = await supabase.from('clientes_beneficios')
      .select('puntos').eq('empresa_id', empresa_id).eq('telefono', telefono).maybeSingle()
    puntos = cliente?.puntos ?? 0
  }

  const { data: canjeables } = await supabase.from('opciones')
    .select('id, nombre, emoji, imagen_url, puntos_canje')
    .eq('empresa_id', empresa_id).not('puntos_canje', 'is', null).gt('puntos_canje', 0)
    .order('puntos_canje')

  return NextResponse.json({ activo: true, puntos, pesos_por_punto: cfg.pesosPorPunto, canjeables: canjeables ?? [] })
}

// POST { accion:'canjear', pedido_id, telefono, opcion_ids } → descuenta los puntos de los
// accesorios canjeados en un pedido recién creado. Valida saldo server-side.
export async function PUT(request: Request) {
  const { pedido_id, telefono, opcion_ids } = await request.json()
  if (!pedido_id || !telefono || !Array.isArray(opcion_ids) || opcion_ids.length === 0) {
    return NextResponse.json({ error: 'pedido_id, telefono y opcion_ids requeridos' }, { status: 400 })
  }
  const tel = normalizarTelefono(telefono)
  const supabase = createAdminClient()

  const { data: pedido } = await supabase.from('pedidos').select('id, empresa_id').eq('id', pedido_id).single()
  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  const cfg = await getConfigBeneficios(pedido.empresa_id)
  if (!cfg.activo) return NextResponse.json({ error: 'Beneficios inactivos' }, { status: 409 })

  const { data: opciones } = await supabase.from('opciones')
    .select('id, nombre, puntos_canje').in('id', opcion_ids).not('puntos_canje', 'is', null)
  const costo = (opciones ?? []).reduce((s, o) => s + Number(o.puntos_canje), 0)
  if (costo <= 0) return NextResponse.json({ error: 'Nada canjeable' }, { status: 400 })

  const { data: cliente } = await supabase.from('clientes_beneficios')
    .select('id, puntos').eq('empresa_id', pedido.empresa_id).eq('telefono', tel).maybeSingle()
  if (!cliente || cliente.puntos < costo) {
    return NextResponse.json({ error: 'Puntos insuficientes' }, { status: 409 })
  }

  await supabase.from('beneficios_movimientos').insert({
    empresa_id: pedido.empresa_id, cliente_id: cliente.id, pedido_id: pedido.id,
    tipo: 'canjeado', puntos: -costo,
    detalle: `Canje: ${(opciones ?? []).map(o => o.nombre).join(', ')}`,
  })
  await supabase.from('clientes_beneficios').update({
    puntos: cliente.puntos - costo, updated_at: new Date().toISOString(),
  }).eq('id', cliente.id)
  await supabase.from('pedidos').update({ telefono_beneficios: tel }).eq('id', pedido_id)

  return NextResponse.json({ ok: true, canjeado: costo, saldo: cliente.puntos - costo })
}

// POST { pedido_id, telefono } → vincula el teléfono al pedido y, si ya está cobrado,
// acredita al instante (kiosk post-pago MP). Si aún no (efectivo), la acreditación
// llega sola cuando la caja lo cobre.
export async function POST(request: Request) {
  const { pedido_id, telefono } = await request.json()
  if (!pedido_id || !telefono) return NextResponse.json({ error: 'pedido_id y telefono requeridos' }, { status: 400 })

  const tel = normalizarTelefono(telefono)
  if (tel.length < 8) return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: pedido } = await supabase.from('pedidos')
    .select('id, empresa_id').eq('id', pedido_id).single()
  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  const cfg = await getConfigBeneficios(pedido.empresa_id)
  if (!cfg.activo) return NextResponse.json({ activo: false }, { status: 409 })

  await supabase.from('pedidos').update({ telefono_beneficios: tel }).eq('id', pedido_id)

  // Si el pedido ya está cobrado (MP aprobado), acreditar ya y devolver el saldo
  const resultado = await acreditarPuntosPedido(pedido_id)
  if (resultado.ok) return NextResponse.json({ activo: true, acreditado: true, sumaste: resultado.puntos, tenes: resultado.total })

  // No cobrado todavía: quedó vinculado, se acredita al cobrar
  const { data: cliente } = await supabase.from('clientes_beneficios')
    .select('puntos').eq('empresa_id', pedido.empresa_id).eq('telefono', tel).maybeSingle()
  return NextResponse.json({ activo: true, acreditado: false, tenes: cliente?.puntos ?? 0 })
}
