import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

// ============================================================
// /api/catalogo/canal — VISIBILIDAD POR CANAL (GO CTO 03/10)
// Regla CTO: el toggle de un canal existe SOLO si el módulo está
// habilitado para la empresa — y la UI no alcanza: EL SERVER ES
// LA AUTORIDAD. Módulo OFF → MODULO_DESHABILITADO, no se guarda
// configuración de un canal que el negocio no tiene.
// Identidad: Bearer del admin bajo RLS (patrón /api/compras);
// mutación: admin client server-side, empresa SIEMPRE de la
// sesión, jamás del body. Los toggles NUEVOS nacen server-side
// (la deuda client-side del catálogo viejo queda fichada aparte).
// ============================================================

const err = (mensaje: string, status = 400) => NextResponse.json({ error: mensaje }, { status })

function rlsClient(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  )
}
async function empresaDelAdmin(db: NonNullable<ReturnType<typeof rlsClient>>) {
  const { data } = await db.from('empresas').select('id').limit(1).maybeSingle()
  return data?.id as string | undefined
}

// canal → columna de productos · llave del jsonb de módulos (OJO: 'mesas' plural)
const CANALES: Record<string, { col: string; modulo: string }> = {
  kiosk: { col: 'visible_kiosk', modulo: 'kiosk' },
  delivery: { col: 'visible_delivery', modulo: 'delivery' },
  mesa: { col: 'visible_mesa', modulo: 'mesas' },
  takeaway: { col: 'visible_takeaway', modulo: 'takeaway' },
}

export async function POST(request: Request) {
  try {
    const rls = rlsClient(request)
    if (!rls) return err('Sesión requerida', 401)
    const empresaId = await empresaDelAdmin(rls)
    if (!empresaId) return err('Sesión sin empresa', 403)

    const body = await request.json()
    const canal = String(body.canal ?? '')
    const productoId = String(body.producto_id ?? '')
    const visible = body.visible === true

    const def = CANALES[canal]
    if (!def) return err(`Canal inválido: ${canal}`, 400)
    if (!productoId) return err('producto_id requerido', 400)

    const admin = createAdminClient()

    // LA AUTORIDAD: módulo habilitado o no se toca nada
    const { data: cfg } = await admin.from('empresa_config').select('modulos').eq('empresa_id', empresaId).maybeSingle()
    const modulos = (cfg?.modulos ?? {}) as Record<string, boolean>
    if (modulos[def.modulo] !== true) {
      return err(`MODULO_DESHABILITADO: el negocio no tiene ${canal} habilitado`, 403)
    }

    const { data: upd, error } = await admin.from('productos')
      .update({ [def.col]: visible })
      .eq('id', productoId).eq('empresa_id', empresaId)
      .select('id').maybeSingle()
    if (error) return err(`No se pudo guardar (${error.message.slice(0, 80)})`, 500)
    if (!upd) return err('Producto inexistente en esta empresa', 404)

    return NextResponse.json({ ok: true, producto_id: productoId, canal, visible })
  } catch {
    return err('Error inesperado', 500)
  }
}

// GET: los módulos de la empresa (para que el admin sepa QUÉ iconitos mostrar)
export async function GET(request: Request) {
  const rls = rlsClient(request)
  if (!rls) return err('Sesión requerida', 401)
  const empresaId = await empresaDelAdmin(rls)
  if (!empresaId) return err('Sesión sin empresa', 403)
  const admin = createAdminClient()
  const { data: cfg } = await admin.from('empresa_config').select('modulos').eq('empresa_id', empresaId).maybeSingle()
  return NextResponse.json({ ok: true, modulos: (cfg?.modulos ?? {}) as Record<string, boolean> })
}
