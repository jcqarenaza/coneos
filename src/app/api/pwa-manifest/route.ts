import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tipo = searchParams.get('tipo')
  const token = searchParams.get('token')
  const path = searchParams.get('path') ?? '/'

  let nombre = 'ConeOS'
  let startUrl = path

  if (token) {
    const supabase = createAdminClient()
    const { data: disp } = await supabase
      .from('dispositivos')
      .select('tipo, empresas(nombre)')
      .eq('device_token', token)
      .single()

    if (disp) {
      const empNombre = Array.isArray(disp.empresas)
        ? (disp.empresas as { nombre: string }[])[0]?.nombre
        : (disp.empresas as { nombre: string } | null)?.nombre

      if (tipo === 'delivery') nombre = `${empNombre ?? 'Delivery'}`
      else if (tipo === 'kiosk') nombre = `${empNombre ?? 'Kiosk'}`
      else if (tipo === 'display') nombre = `${empNombre ?? 'Display'}`
    }
  }

  const manifest = {
    name: nombre,
    short_name: nombre,
    description: 'Sistema de pedidos ConeOS',
    start_url: startUrl,
    id: startUrl,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf8f5',
    theme_color: '#faf8f5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }

  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-cache',
    },
  })
}
