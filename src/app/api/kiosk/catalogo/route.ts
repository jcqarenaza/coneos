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

  const [{ data: categorias }, { data: productos }, { data: presentaciones }, { data: grupos }, { data: opciones }, { data: inventario }, { data: presGrupos }, { data: catalogoConfig }, { data: stockRows }] =
    await Promise.all([
      supabase.from('categorias').select('id, nombre, icono_url, orden').eq('empresa_id', empresa_id).eq('activo', true).is('deleted_at', null).order('orden'),
      supabase.from('productos').select('id, nombre, descripcion, imagen_url, categoria_id, orden, controla_stock').eq('empresa_id', empresa_id).eq('activo', true).eq('visible_kiosk', true).is('deleted_at', null).order('orden'),
      supabase.from('presentaciones').select('id, nombre, precio, permite_opciones, opciones_min, opciones_max, orden, producto_id, imagen_url, es_novedad').eq('empresa_id', empresa_id).eq('activo', true).eq('visible_kiosk', true).order('orden'),
      supabase.from('grupos_opciones').select('id, nombre, orden').eq('empresa_id', empresa_id).eq('activo', true).order('orden'),
      supabase.from('opciones').select('id, nombre, descripcion, emoji, color, imagen_url, grupo_id, orden, precio_adicional').eq('empresa_id', empresa_id).eq('activo', true).eq('visible_kiosk', true).is('deleted_at', null).order('orden'),
      supabase.from('inventario_opciones').select('opcion_id, disponible').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id),
      supabase.from('presentacion_grupos').select('presentacion_id, grupo_id'),
      supabase.from('sucursal_catalogo_config').select('entidad_id, entidad_tipo, disponible').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id),
      supabase.from('producto_stock').select('producto_id, cantidad').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id),
    ])

  // Mapa de disponibilidad por sucursal
  const dispoMap: Record<string, boolean> = {}
  ;(catalogoConfig ?? []).forEach((r: { entidad_id: string; disponible: boolean }) => { dispoMap[r.entidad_id] = r.disponible })

  // Filtrar productos y presentaciones no disponibles en esta sucursal
  // + STOCK V1: producto contable (controla_stock) con cantidad 0 — o sin fila
  // de stock para esta sucursal — se OCULTA. Misma regla que la RPC al vender:
  // sin fila = sin stock. Un solo punto de inserción para los 4 canales.
  const stockMap: Record<string, number> = {}
  ;(stockRows ?? []).forEach((s: { producto_id: string; cantidad: number }) => { stockMap[s.producto_id] = s.cantidad })
  const sinStock = (p: { id: string; controla_stock?: boolean }) =>
    p.controla_stock === true && !(stockMap[p.id] > 0)

  const ocultosPorStock = new Set((productos ?? []).filter(sinStock).map((p: { id: string }) => p.id))
  const productosFiltrados = (productos ?? [])
    .filter((p: { id: string }) => dispoMap[p.id] !== false && !ocultosPorStock.has(p.id))
    .map(({ controla_stock: _cs, ...p }: { id: string; controla_stock?: boolean }) => p) // el flag no viaja al cliente
  const presentacionesFiltradas = (presentaciones ?? []).filter((p: { id: string; producto_id: string }) =>
    dispoMap[p.id] !== false && !ocultosPorStock.has(p.producto_id))

  // Filtrar opciones por inventario_opciones (sabores sin stock)
  const inventarioMap: Record<string, boolean> = {}
  ;(inventario ?? []).forEach((i: { opcion_id: string; disponible: boolean }) => { inventarioMap[i.opcion_id] = i.disponible })
  const opcionesFiltradas = (opciones ?? []).filter((op: { id: string }) => inventarioMap[op.id] !== false)

  return NextResponse.json({ categorias, productos: productosFiltrados, presentaciones: presentacionesFiltradas, grupos, opciones: opcionesFiltradas, presentacion_grupos: presGrupos ?? [] })
}
