import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esUuid, rutaCaptura, validarArchivoComprobante, MAX_BYTES_COMPROBANTE } from '@/lib/storage'

// Guarda el comprobante de transferencia que el cliente carga.
// Server-side porque el kiosk/delivery es anónimo y la RLS bloquea tanto el
// update directo a pedidos como (según políticas) el upload al storage.
// Dos modos:
//  - JSON { pedido_id, comprobante }: últimos dígitos (kiosk) → notas
//  - FormData { pedido_id, archivo }: imagen JPEG/PNG/WebP (delivery/takeaway) → storage
//    'capturas' en <empresa_id>/pedidos/<pedido_id>.<ext>, y la RUTA (no una URL) en captura_transferencia_url
//
// MODO ARCHIVO — reglas (A2, orden CTO 09/11):
//  1. El comprador es anónimo: su autorización es el pedido_id (UUID). Con él NO se puede reemplazar, modificar ni consultar nada.
//  2. Se valida el archivo ANTES de mirar el pedido (tamaño, formato REAL por contenido, tipo declarado, extensión): así el error
//     de archivo no depende de si el pedido existe.
//  3. La empresa sale SIEMPRE del pedido, nunca del cliente.
//  4. Solo se adjunta a un pedido que existe, es por transferencia, está en un estado habilitado y todavía no tiene comprobante.
//     Cualquiera de esas condiciones que falle devuelve la MISMA respuesta (409): no permite enumerar pedidos.
//  5. upsert:false (jamás pisa un archivo) + update condicional (pedido sigue habilitado y sin comprobante). Si el update falla
//     o pierde la carrera, se borra el objeto recién subido; si ese borrado también falla se deja un log para recuperarlo.
//  6. Respuesta { ok: true }: no se devuelve ninguna URL de Storage.
const ESTADOS_QUE_ADMITEN_COMPROBANTE = ['PENDING_PAYMENT']   // el comprobante se adjunta al crear el pedido, mientras espera el pago

const NO_SE_PUEDE = () => NextResponse.json({ ok: false, error: 'No se puede adjuntar el comprobante a este pedido' }, { status: 409 })

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  // ── Modo archivo (FormData) ──
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    const pedido_id = form?.get('pedido_id')
    const archivo = form?.get('archivo')
    if (typeof pedido_id !== 'string' || !esUuid(pedido_id) || !(archivo instanceof File)) {
      return NextResponse.json({ ok: false, error: 'pedido_id y archivo requeridos' }, { status: 400 })
    }
    if (archivo.size > MAX_BYTES_COMPROBANTE) {
      return NextResponse.json({ ok: false, error: 'Archivo demasiado grande (máx 10 MB)' }, { status: 413 })
    }
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    const v = validarArchivoComprobante({ name: archivo.name, type: archivo.type, size: archivo.size }, bytes)
    if (v.ok === false) return NextResponse.json({ ok: false, error: v.mensaje }, { status: v.codigo === 'GRANDE' ? 413 : v.codigo === 'VACIO' ? 400 : 415 })

    const supabase = createAdminClient()
    const { data: fila } = await supabase.from('pedidos')
      .select('id, empresa_id, metodo_pago, estado, captura_transferencia_url').eq('id', pedido_id).maybeSingle()
    // El tipo generado de `pedidos` está desactualizado (el cliente infiere `never`): se tipa acá lo que lee este modo.
    const pedido = fila as unknown as { id: string; empresa_id: string; metodo_pago: string | null; estado: string; captura_transferencia_url: string | null } | null
    if (!pedido || pedido.metodo_pago !== 'transferencia' || !ESTADOS_QUE_ADMITEN_COMPROBANTE.includes(pedido.estado) || pedido.captura_transferencia_url) {
      return NO_SE_PUEDE()
    }

    const ruta = rutaCaptura(pedido.empresa_id, pedido.id, 'comprobante', v.tipo)   // <empresa_id>/pedidos/<pedido_id>.<ext>
    const { error: upErr } = await supabase.storage.from('capturas').upload(ruta, bytes, { upsert: false, contentType: v.tipo })
    if (upErr) {
      const e = upErr as { message?: string; statusCode?: string | number }
      if (String(e.statusCode) === '409' || /already exists|duplicate/i.test(e.message ?? '')) return NO_SE_PUEDE()
      console.error('[capturas][SUBIDA_FALLIDA]', JSON.stringify({ pedido_id: pedido.id, ruta, motivo: e.message }))
      return NextResponse.json({ ok: false, error: 'No se pudo guardar el comprobante' }, { status: 500 })
    }

    // El objeto ya está subido: si lo que sigue no termina bien, hay que sacarlo para no dejar un archivo huérfano.
    const retirarSubido = async (motivo: string) => {
      try {
        const { error } = await supabase.storage.from('capturas').remove([ruta])
        if (error) throw new Error(error.message)
      } catch (err) {
        console.error('[capturas][LIMPIEZA_FALLIDA]', JSON.stringify({ pedido_id: pedido.id, empresa_id: pedido.empresa_id, bucket: 'capturas', ruta, motivo, limpieza: err instanceof Error ? err.message : String(err) }))
      }
    }
    const { data: act, error } = await supabase.from('pedidos')
      .update({ captura_transferencia_url: ruta })
      .eq('id', pedido.id).eq('estado', 'PENDING_PAYMENT').is('captura_transferencia_url', null)
      .select('id')
    if (error) {
      await retirarSubido(`update: ${error.message}`)
      return NextResponse.json({ ok: false, error: 'No se pudo guardar el comprobante' }, { status: 500 })
    }
    if (!act || act.length !== 1) {   // el pedido cambió de estado o ya recibió otro comprobante mientras se subía
      await retirarSubido('update condicional sin filas')
      return NO_SE_PUEDE()
    }
    return NextResponse.json({ ok: true })
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
