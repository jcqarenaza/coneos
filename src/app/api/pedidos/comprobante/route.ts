import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Guarda el comprobante de transferencia que el cliente carga.
// Server-side porque el kiosk/delivery es anónimo y la RLS bloquea tanto el
// update directo a pedidos como (según políticas) el upload al storage.
// Dos modos:
//  - JSON { pedido_id, comprobante }: últimos dígitos (kiosk) → notas
//  - FormData { pedido_id, archivo }: imagen (delivery/takeaway) → storage
//    'capturas' con admin + captura_transferencia_url
export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  // ── Modo imagen (FormData) ──
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    const pedido_id = form?.get('pedido_id')
    const archivo = form?.get('archivo')
    if (!pedido_id || !(archivo instanceof File)) {
      return NextResponse.json({ error: 'pedido_id y archivo requeridos' }, { status: 400 })
    }
    if (archivo.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Imagen demasiado grande (máx 8MB)' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: pedido } = await supabase.from('pedidos')
      .select('id, metodo_pago').eq('id', String(pedido_id)).single()
    if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
    if (pedido.metodo_pago !== 'transferencia') {
      return NextResponse.json({ error: 'El pedido no es por transferencia' }, { status: 400 })
    }

    const ext = (archivo.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `pedidos/${pedido.id}.${ext}`
    const { error: upErr } = await supabase.storage.from('capturas')
      .upload(path, archivo, { upsert: true, contentType: archivo.type || 'image/jpeg' })
    if (upErr) return NextResponse.json({ error: `Storage: ${upErr.message}` }, { status: 500 })

    const { data: pub } = supabase.storage.from('capturas').getPublicUrl(path)
    const { error } = await supabase.from('pedidos')
      .update({ captura_transferencia_url: pub.publicUrl }).eq('id', pedido.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, url: pub.publicUrl })
  }

  // ── Modo dígitos (JSON, kiosk) ──
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
