import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Contexto público del modo MESA (el QR lo abre cualquier celular, sin token).
// GET ?empresa=<slug>&sucursal=<slug> → ids + branding, gated por modulos.mesas
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresaSlug = searchParams.get('empresa')
  const sucursalSlug = searchParams.get('sucursal')
  if (!empresaSlug || !sucursalSlug) return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: empresa } = await supabase.from('empresas')
    .select('id, nombre, slug').eq('slug', empresaSlug).maybeSingle()
  if (!empresa) return NextResponse.json({ error: 'Local no encontrado' }, { status: 404 })

  const [{ data: cfg }, { data: sucursal }] = await Promise.all([
    supabase.from('empresa_config').select('primary_color, secondary_color, logo_url, modulos, mesas_activo').eq('empresa_id', empresa.id).maybeSingle(),
    supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', empresa.id).eq('slug', sucursalSlug).maybeSingle(),
  ])
  if (!sucursal) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 })

  const modulos = (cfg?.modulos ?? {}) as Record<string, boolean>
  if (modulos.mesas !== true) {
    return NextResponse.json({ error: 'El pedido desde la mesa no está disponible en este local' }, { status: 403 })
  }
  // Llave del negocio (Admin→Mesas): el local puede pausar sin tocar el módulo
  if (cfg?.mesas_activo === false) {
    return NextResponse.json({ error: 'Los pedidos desde la mesa están pausados en este momento. ¡Llamá al mozo!' }, { status: 403 })
  }

  return NextResponse.json({
    empresa_id: empresa.id,
    sucursal_id: sucursal.id,
    nombre: empresa.nombre,
    sucursal_nombre: sucursal.nombre,
    config: {
      primary_color: cfg?.primary_color ?? '#1E3A5F',
      secondary_color: cfg?.secondary_color ?? '#F5C842',
      logo_url: cfg?.logo_url ?? null,
    },
  })
}
