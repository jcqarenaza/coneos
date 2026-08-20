import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Manifest dinámico por empresa/sucursal o por token de dispositivo
// URL: /api/manifest?empresa=X&sucursal=Y  ó  /api/manifest?token=Z
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresaSlug = searchParams.get('empresa')
  const sucursalSlug = searchParams.get('sucursal')
  const token = searchParams.get('token')

  let nombre = 'ConeOS'
  let themeColor = '#1E3A5F'
  let logoUrl: string | null = null
  let pwaNombre: string | null = null
  let pwaIconoUrl: string | null = null
  let startUrl = '/'

  const supabase = createAdminClient()

  if (token) {
    // Resolver por token de dispositivo
    const { data: disp } = await supabase
      .from('dispositivos')
      .select('device_token, empresas(nombre, slug), sucursales(slug)')
      .eq('device_token', token)
      .eq('activo', true)
      .maybeSingle()
    if (disp) {
      const emp = Array.isArray(disp.empresas) ? disp.empresas[0] : disp.empresas
      const suc = Array.isArray(disp.sucursales) ? disp.sucursales[0] : disp.sucursales
      if (emp) {
        nombre = emp.nombre
        startUrl = `/${emp.slug}/d/${token}`
        const { data: cfg } = await supabase.from('empresa_config').select('primary_color, logo_url, pwa_nombre, pwa_icono_url').eq('empresa_id', (await supabase.from('empresas').select('id').eq('slug', emp.slug).single()).data?.id ?? '').maybeSingle()
        if (cfg?.primary_color) themeColor = cfg.primary_color
        if (cfg?.logo_url) logoUrl = cfg.logo_url
        if (cfg?.pwa_nombre) pwaNombre = cfg.pwa_nombre
        if (cfg?.pwa_icono_url) pwaIconoUrl = cfg.pwa_icono_url
      }
    }
  } else if (empresaSlug) {
    const { data: emp } = await supabase
      .from('empresas')
      .select('id, nombre, config:empresa_config(primary_color, logo_url, pwa_nombre, pwa_icono_url)')
      .eq('slug', empresaSlug)
      .single()
    if (emp) {
      nombre = emp.nombre
      const cfg = Array.isArray(emp.config) ? emp.config[0] : emp.config
      if (cfg?.primary_color) themeColor = cfg.primary_color
      if (cfg?.logo_url) logoUrl = cfg.logo_url
      if (cfg?.pwa_nombre) pwaNombre = cfg.pwa_nombre
      if (cfg?.pwa_icono_url) pwaIconoUrl = cfg.pwa_icono_url
      if (sucursalSlug) startUrl = `/${empresaSlug}/delivery/${sucursalSlug}`
    }
  }

  const nombreFinal = pwaNombre ?? `${nombre} — Pedidos`
  const iconoFinal = pwaIconoUrl ?? logoUrl

  const manifest = {
    name: nombreFinal,
    short_name: pwaNombre ?? nombre,
    description: `Hacé tu pedido en ${nombre}`,
    start_url: startUrl,
    display: 'standalone',
    background_color: '#faf8f5',
    theme_color: themeColor,
    icons: iconoFinal
      ? [
          { src: iconoFinal, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: iconoFinal, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      : [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
  }

  return NextResponse.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' },
  })
}
