import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Elimina un pedido SOLO si no está cobrado (PAID/DELIVERED) ni facturado.
// La regla vive acá (server-side): el cliente no puede saltearla.
export async function POST(request: Request) {
  const { pedido_id } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase.from('pedidos')
    .select('id, estado, numero_pedido').eq('id', pedido_id).single()
  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  if (pedido.estado === 'PAID' || pedido.estado === 'DELIVERED') {
    return NextResponse.json({ error: 'No se puede eliminar un pedido ya cobrado' }, { status: 409 })
  }

  const { data: factura } = await supabase.from('facturas')
    .select('id').eq('pedido_id', pedido_id).eq('estado', 'emitida').maybeSingle()
  if (factura) {
    return NextResponse.json({ error: 'El pedido tiene factura emitida — corresponde Nota de Crédito, no eliminación' }, { status: 409 })
  }

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
