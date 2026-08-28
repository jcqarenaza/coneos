import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Estado mínimo de un pedido para que kiosk/delivery (anónimos) detecten el pago MP.
// Expone solo lo necesario: estado, número y código de retiro.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pedido_id = searchParams.get('pedido_id')
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('pedidos')
    .select('estado, numero_pedido, codigo_retiro')
    .eq('id', pedido_id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  return NextResponse.json(data)
}
