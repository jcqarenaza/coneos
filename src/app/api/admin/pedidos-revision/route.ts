import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { pedidosRetenidos } from '@/lib/pedidos/revision'

// ============================================================
// /api/admin/pedidos-revision — marcas de revisión de duplicados para el ADMIN (CTO 14/11, ajuste 1)
// Dado un conjunto de pedidos, devuelve cuáles están EN REVISIÓN (revisión PENDIENTE) y cuáles son DUPLICADO.
// SOLO LECTURA. Identidad: Bearer del admin bajo RLS (patrón cuits / pagos-cuentas); la empresa sale SIEMPRE de la sesión,
// jamás del body. pedido_revisiones_duplicado es service_role-only, por eso la lectura va por el cliente admin del servidor.
// ============================================================

const err = (mensaje: string, status = 400) => NextResponse.json({ error: mensaje }, { status })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 1000

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return err('Sesión requerida', 401)
  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: emp } = await rls.from('empresas').select('id').limit(1).maybeSingle()
  const empresaId = (emp as { id?: string } | null)?.id
  if (!empresaId) return err('Sesión inválida', 401)

  let body: { pedido_ids?: unknown }
  try { body = await request.json() } catch { return err('Cuerpo inválido') }
  const ids = Array.isArray(body.pedido_ids) ? [...new Set(body.pedido_ids.map(String))] : null
  if (!ids || ids.length > MAX_IDS || ids.some(i => !UUID.test(i))) return err('pedido_ids inválido')
  if (ids.length === 0) return NextResponse.json({ revisiones: {} })

  const r = await pedidosRetenidos(createAdminClient(), empresaId, ids)
  if (!r.ok) return err('No se pudo verificar la revisión de duplicados', 503)   // el Admin NO inventa: avisa que no pudo verificar
  const revisiones: Record<string, 'PENDIENTE' | 'DUPLICADO'> = {}
  for (const [id, est] of r.retenidos) revisiones[id] = est
  return NextResponse.json({ revisiones })
}
