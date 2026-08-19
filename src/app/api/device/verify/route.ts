import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { device_token, empresa_slug, sucursal_slug, tipo } = await request.json()

  const supabase = createAdminClient()

  // ── Modo 1: por token (flujo normal) ──
  if (device_token) {
    const { data: dispositivo, error } = await supabase
      .from('dispositivos')
      .select('id, nombre, tipo, activo, empresa_id, sucursal_id, sucursales(nombre, slug), empresas(nombre, slug)')
      .eq('device_token', device_token)
      .single()

    if (error || !dispositivo) {
      return NextResponse.json({ error: 'Dispositivo no encontrado' }, { status: 404 })
    }
    if (!dispositivo.activo) {
      return NextResponse.json({ error: 'Dispositivo inactivo' }, { status: 403 })
    }

    const sucursales = Array.isArray(dispositivo.sucursales) ? dispositivo.sucursales[0] : dispositivo.sucursales
    const empresas = Array.isArray(dispositivo.empresas) ? dispositivo.empresas[0] : dispositivo.empresas

    return NextResponse.json({ dispositivo: { ...dispositivo, sucursales, empresas } })
  }

  // ── Modo 2: por slugs (fallback PWA Android sin token — solo DELIVERY) ──
  if (empresa_slug && sucursal_slug && tipo === 'DELIVERY') {
    const { data: emp } = await supabase.from('empresas').select('id').eq('slug', empresa_slug).single()
    if (!emp) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const { data: suc } = await supabase.from('sucursales').select('id').eq('empresa_id', emp.id).eq('slug', sucursal_slug).single()
    if (!suc) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 })

    const { data: dispositivo } = await supabase
      .from('dispositivos')
      .select('id, nombre, tipo, activo, empresa_id, sucursal_id, sucursales(nombre, slug), empresas(nombre, slug)')
      .eq('sucursal_id', suc.id)
      .eq('tipo', 'DELIVERY')
      .eq('activo', true)
      .limit(1)
      .maybeSingle()

    if (!dispositivo) {
      return NextResponse.json({ error: 'No hay delivery activo para esta sucursal' }, { status: 404 })
    }

    const sucursales = Array.isArray(dispositivo.sucursales) ? dispositivo.sucursales[0] : dispositivo.sucursales
    const empresas = Array.isArray(dispositivo.empresas) ? dispositivo.empresas[0] : dispositivo.empresas

    return NextResponse.json({ dispositivo: { ...dispositivo, sucursales, empresas } })
  }

  return NextResponse.json({ error: 'Token requerido' }, { status: 400 })
}
