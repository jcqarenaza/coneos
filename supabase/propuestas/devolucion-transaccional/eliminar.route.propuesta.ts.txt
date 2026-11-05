import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Elimina un pedido SOLO si no está cobrado (PAID/DELIVERED) ni facturado.
// La regla vive acá (server-side): el cliente no puede saltearla.
export async function POST(request: Request) {
  const { pedido_id } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase.from('pedidos')
    .select('id, estado, numero_pedido, empresa_id, sucursal_id, stock_descontado, numero_mesa, pagado, tipo_pedido').eq('id', pedido_id).single()
  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  // ── STOCK V1 REAL: regla de borrado post-9c ──
  // 9c volvió transitorio a PAID: los COBRADOS viven en PREPARING. La verdad
  // operativa: solo lo NO cobrado se elimina — PENDING_PAYMENT, o pedido de
  // mesa aún sin pagar (su flag pagado SÍ es confiable: nace false).
  const esBorrable = pedido.estado === 'PENDING_PAYMENT' ||
    (pedido.numero_mesa != null && pedido.pagado === false)
  if (!esBorrable) {
    return NextResponse.json({ error: 'No se puede eliminar un pedido ya cobrado' }, { status: 409 })
  }

  const { data: factura } = await supabase.from('facturas')
    .select('id').eq('pedido_id', pedido_id).eq('estado', 'emitida').maybeSingle()
  if (factura) {
    return NextResponse.json({ error: 'El pedido tiene factura emitida — corresponde Nota de Crédito, no eliminación' }, { status: 409 })
  }

  // ── STOCK: devolución TRANSACCIONAL E IDEMPOTENTE ──
  // Una sola RPC hace, en UNA transacción: lock del pedido, cálculo por snapshot
  // (cantidad × factor_stock_snap; NULL = factor 1), ajuste de stock con libro y
  // baja del flag stock_descontado. Todo o nada: si falla, el flag sigue en true,
  // no se devolvió nada y se puede reintentar. Reintento/doble click → no-op.
  if (pedido.stock_descontado) {
    const { error: errDev } = await supabase.rpc('devolver_stock_pedido', {
      p_empresa_id: pedido.empresa_id, p_pedido_id: pedido_id,
    })
    if (errDev) {
      console.error('[pedidos/eliminar] devolver_stock_pedido', errDev.message)
      return NextResponse.json({ error: 'No se pudo devolver el stock. El pedido NO se eliminó: reintentá.' }, { status: 500 })
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
  // E2: comprobantes retirada (tabla legacy rota — el registro real vive en facturas)
  await supabase.from('facturas').delete().eq('pedido_id', pedido_id) // solo no-emitidas llegan acá
  const { error } = await supabase.from('pedidos').delete().eq('id', pedido_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, eliminado: pedido.numero_pedido })
}
