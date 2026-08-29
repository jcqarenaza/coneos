import { createAdminClient } from '@/lib/supabase/admin'

// ─── Programa de beneficios: lógica compartida (server-side only) ───

// Normaliza teléfonos argentinos a solo dígitos comparables:
// quita todo lo no numérico, el 54/549 internacional, el 0 inicial y el 15 de área.
export function normalizarTelefono(raw: string): string {
  let t = String(raw ?? '').replace(/\D/g, '')
  if (t.startsWith('549')) t = t.slice(3)
  else if (t.startsWith('54')) t = t.slice(2)
  if (t.startsWith('0')) t = t.slice(1)
  // "15" después del código de área (ej 2302 15 354211) — caso común: quitar '15' si deja 10 dígitos
  if (t.length === 12 && t.slice(4, 6) === '15') t = t.slice(0, 4) + t.slice(6)
  return t
}

export async function getConfigBeneficios(empresaId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase.from('beneficios_config')
    .select('activo, pesos_por_punto').eq('empresa_id', empresaId).maybeSingle()
  return { activo: !!data?.activo, pesosPorPunto: Number(data?.pesos_por_punto ?? 1000) }
}

// Acredita los puntos de un pedido cobrado. Idempotente (índice único por pedido).
// Reglas: solo estados cobrados; no suman envío ni ítems canjeados (precio_snap = 0).
export async function acreditarPuntosPedido(pedidoId: string): Promise<{ ok: boolean; puntos?: number; total?: number; motivo?: string }> {
  const supabase = createAdminClient()

  const { data: pedido } = await supabase.from('pedidos')
    .select('id, empresa_id, estado, total, costo_envio, telefono_beneficios, datos_delivery, pedido_items(precio_snap, cantidad)')
    .eq('id', pedidoId).single()
  if (!pedido) return { ok: false, motivo: 'pedido no encontrado' }

  const cfg = await getConfigBeneficios(pedido.empresa_id)
  if (!cfg.activo) return { ok: false, motivo: 'beneficios inactivos' }

  if (!['PAID', 'PREPARING', 'READY', 'DELIVERED'].includes(pedido.estado)) {
    return { ok: false, motivo: 'pedido no cobrado' }
  }

  const dd = pedido.datos_delivery as { telefono?: string } | null
  const telRaw = pedido.telefono_beneficios || dd?.telefono
  if (!telRaw) return { ok: false, motivo: 'sin teléfono' }
  const telefono = normalizarTelefono(telRaw)
  if (telefono.length < 8) return { ok: false, motivo: 'teléfono inválido' }

  // Base: solo productos pagados (sin envío; los canjes van con precio_snap 0 y no aportan)
  const items = (pedido.pedido_items ?? []) as { precio_snap: number; cantidad: number }[]
  const baseProductos = items.reduce((s, i) => s + Number(i.precio_snap) * i.cantidad, 0)
  const puntos = Math.floor(baseProductos / cfg.pesosPorPunto)
  if (puntos <= 0) return { ok: false, motivo: 'monto insuficiente' }

  // Cliente (upsert por empresa+teléfono)
  const { data: cliente, error: eCli } = await supabase.from('clientes_beneficios')
    .upsert({ empresa_id: pedido.empresa_id, telefono, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id,telefono', ignoreDuplicates: false })
    .select('id, puntos, puntos_historicos').single()
  if (eCli || !cliente) return { ok: false, motivo: eCli?.message ?? 'error cliente' }

  // Movimiento 'ganado' — el índice único por pedido evita doble acreditación
  const { error: eMov } = await supabase.from('beneficios_movimientos').insert({
    empresa_id: pedido.empresa_id, cliente_id: cliente.id, pedido_id: pedido.id,
    tipo: 'ganado', puntos, detalle: `Pedido cobrado — base $${baseProductos}`,
  })
  if (eMov) {
    if (eMov.code === '23505') return { ok: false, motivo: 'ya acreditado' }
    return { ok: false, motivo: eMov.message }
  }

  const nuevoSaldo = cliente.puntos + puntos
  await supabase.from('clientes_beneficios').update({
    puntos: nuevoSaldo, puntos_historicos: cliente.puntos_historicos + puntos, updated_at: new Date().toISOString(),
  }).eq('id', cliente.id)

  return { ok: true, puntos, total: nuevoSaldo }
}
