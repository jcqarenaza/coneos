import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  const sucursal_id = searchParams.get('sucursal_id')

  if (!empresa_id || !sucursal_id) {
    return NextResponse.json({ error: 'Parámetros requeridos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const [{ data: categorias }, { data: productos }, { data: presentaciones }, { data: grupos }, { data: opciones }, { data: inventario }, { data: presGrupos }] =
    await Promise.all([
      supabase.from('categorias').select('id, nombre, icono_url, orden').eq('empresa_id', empresa_id).eq('activo', true).is('deleted_at', null).order('orden'),
      supabase.from('productos').select('id, nombre, descripcion, imagen_url, categoria_id, orden').eq('empresa_id', empresa_id).eq('activo', true).eq('visible_kiosk', true).is('deleted_at', null).order('orden'),
      supabase.from('presentaciones').select('id, nombre, precio, permite_opciones, opciones_min, opciones_max, orden, producto_id').eq('empresa_id', empresa_id).eq('activo', true).order('orden'),
      supabase.from('grupos_opciones').select('id, nombre, orden').eq('empresa_id', empresa_id).eq('activo', true).order('orden'),
      supabase.from('opciones').select('id, nombre, descripcion, emoji, color, grupo_id, orden').eq('empresa_id', empresa_id).eq('activo', true).is('deleted_at', null).order('orden'),
      supabase.from('inventario_opciones').select('opcion_id, disponible').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id),
      supabase.from('presentacion_grupos').select('presentacion_id, grupo_id'),
    ])

  const inventarioMap: Record<string, boolean> = {}
  ;(inventario ?? []).forEach((i: { opcion_id: string; disponible: boolean }) => { inventarioMap[i.opcion_id] = i.disponible })
  const opcionesFiltradas = (opciones ?? []).filter((op: { id: string }) => inventarioMap[op.id] !== false)

  return NextResponse.json({ categorias, productos, presentaciones, grupos, opciones: opcionesFiltradas, presentacion_grupos: presGrupos ?? [] })
}
