import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Manifest dinámico por empresa/sucursal para PWA delivery
// URL: /api/manifest?empresa=federal&sucursal=federal
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresaSlug = searchParams.get('empresa')
  const sucursalSlug = searchParams.get('sucursal')
  const token = searchParams.get('token')

  let nombre = 'ConeOS'
  let themeColor = '#1E3A5F'
  let logoUrl: string | null = null

  if (empresaSlug) {
    const supabase = createAdminClient()
    const { data: emp } = await supabase
      .from('empresas')
      .select('nombre, config:empresa_config(primary_color, logo_url)')
      .eq('slug', empresaSlug)
      .single()
    if (emp) {
      nombre = emp.nombre
      const cfg = Array.isArray(emp.config) ? emp.config[0] : emp.config
      if (cfg?.primary_color) themeColor = cfg.primary_color
      if (cfg?.logo_url) logoUrl = cfg.logo_url
    }
  }

  const startUrl = empresaSlug && sucursalSlug
    ? `/${empresaSlug}/delivery/${sucursalSlug}${token ? `?token=${token}` : ''}`
    : '/'

  const manifest = {
    name: `${nombre} — Pedidos`,
    short_name: nombre,
    description: `Hacé tu pedido en ${nombre}`,
    start_url: startUrl,
    display: 'standalone',
    background_color: '#faf8f5',
    theme_color: themeColor,
    icons: logoUrl
      ? [
          { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' },
        ]
      : [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
  }

  return NextResponse.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  })
}
