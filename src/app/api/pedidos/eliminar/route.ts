import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Elimina un pedido SOLO si no está cobrado (PAID/DELIVERED) ni facturado.
// La regla vive acá (server-side): el cliente no puede saltearla.
export async function POST(request: Request) {
  const { pedido_id } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase.from('pedidos')
    .select('id, estado, numero_pedido, empresa_id, sucursal_id, stock_descontado').eq('id', pedido_id).single()
  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  if (pedido.estado === 'PAID' || pedido.estado === 'DELIVERED') {
    return NextResponse.json({ error: 'No se puede eliminar un pedido ya cobrado' }, { status: 409 })
  }

  const { data: factura } = await supabase.from('facturas')
    .select('id').eq('pedido_id', pedido_id).eq('estado', 'emitida').maybeSingle()
  if (factura) {
    return NextResponse.json({ error: 'El pedido tiene factura emitida — corresponde Nota de Crédito, no eliminación' }, { status: 409 })
  }

  // ── STOCK V1: devolución IDEMPOTENTE ──
  // Flip atómico del flag ANTES de devolver: solo la llamada que logra pasar
  // stock_descontado true→false devuelve cantidades. Reintentos del endpoint
  // (o doble click) no afectan fila → no devuelven nada. Jamás doble devolución.
  if (pedido.stock_descontado) {
    const { data: flip } = await supabase.from('pedidos')
      .update({ stock_descontado: false })
      .eq('id', pedido_id).eq('stock_descontado', true)
      .select('id')
    if (flip && flip.length > 0) {
      // Cantidades a devolver: items del pedido → presentación → producto contable
      const { data: itemsStock } = await supabase.from('pedido_items')
        .select('cantidad, presentacion_id, presentaciones(producto_id, productos(id, controla_stock))')
        .eq('pedido_id', pedido_id)
        .not('presentacion_id', 'is', null)
      const porProducto = new Map<string, number>()
      for (const it of itemsStock ?? []) {
        const pres = it.presentaciones as unknown as { producto_id: string; productos: { id: string; controla_stock: boolean } | null } | null
        if (!pres?.productos?.controla_stock) continue
        porProducto.set(pres.producto_id, (porProducto.get(pres.producto_id) ?? 0) + it.cantidad)
      }
      for (const [productoId, q] of porProducto) {
        const { data: stk } = await supabase.from('producto_stock')
          .select('id, cantidad').eq('producto_id', productoId)
          .eq('sucursal_id', pedido.sucursal_id).maybeSingle()
        if (stk) {
          await supabase.from('producto_stock')
            .update({ cantidad: stk.cantidad + q, updated_at: new Date().toISOString() })
            .eq('id', stk.id)
        }
      }
    }
  }

  // Beneficios: revertir puntos del pedido (ganados se restan, canjes se devuelven)
  const { data: movs } = await supabase.from('beneficios_movimientos')
    .select('id, cliente_id, puntos, tipo').eq('pedido_id', pedido_id)
  for (const m of movs ?? []) {
    const { data: cli } = await supabase.from('clientes_beneficios')
      .select('puntos, puntos_historicos').eq('id', m.cliente_id).single()
    if (cli) {
      await supabase.from('clientes_beneficios').update({
        puntos: cli.puntos - m.puntos,
        puntos_historicos: m.tipo === 'ganado' ? Math.max(0, cli.puntos_historicos - m.puntos) : cli.puntos_historicos,
        updated_at: new Date().toISOString(),
      }).eq('id', m.cliente_id)
      await supabase.from('beneficios_movimientos').insert({
        empresa_id: pedido.empresa_id,
        cliente_id: m.cliente_id, tipo: 'reversa', puntos: -m.puntos,
        detalle: `Reversa por eliminación del pedido #${pedido.numero_pedido}`,
      })
    }
  }
  await supabase.from('beneficios_movimientos').delete().eq('pedido_id', pedido_id)

  // Borrado en orden por FKs
  const { data: items } = await supabase.from('pedido_items').select('id').eq('pedido_id', pedido_id)
  const itemIds = (items ?? []).map(i => i.id)
  if (itemIds.length > 0) await supabase.from('pedido_item_opciones').delete().in('pedido_item_id', itemIds)
  await supabase.from('pedido_items').delete().eq('pedido_id', pedido_id)
  await supabase.from('comprobantes').delete().eq('pedido_id', pedido_id)
  await supabase.from('facturas').delete().eq('pedido_id', pedido_id) // solo no-emitidas llegan acá
  const { error } = await supabase.from('pedidos').delete().eq('id', pedido_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, eliminado: pedido.numero_pedido })
}
