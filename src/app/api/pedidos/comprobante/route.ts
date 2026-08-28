import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Guarda el número de comprobante de transferencia que el cliente carga en el kiosk.
// Server-side porque el kiosk es anónimo y la RLS bloquea el update directo.
export async function POST(request: Request) {
  const { pedido_id, comprobante } = await request.json()
  if (!pedido_id || !comprobante) return NextResponse.json({ error: 'pedido_id y comprobante requeridos' }, { status: 400 })

  const limpio = String(comprobante).replace(/\D/g, '').slice(0, 10)
  if (!limpio) return NextResponse.json({ error: 'comprobante inválido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: pedido } = await supabase.from('pedidos')
    .select('id, metodo_pago, notas').eq('id', pedido_id).single()
  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  if (pedido.metodo_pago !== 'transferencia') {
    return NextResponse.json({ error: 'El pedido no es por transferencia' }, { status: 400 })
  }

  // Formato que la caja ya sabe mostrar destacado
  const nota = `Comprobante: ...${limpio}`
  const notas = pedido.notas && !pedido.notas.startsWith('Comprobante:')
    ? `${nota} · ${pedido.notas}`
    : nota

  const { error } = await supabase.from('pedidos').update({ notas }).eq('id', pedido_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
