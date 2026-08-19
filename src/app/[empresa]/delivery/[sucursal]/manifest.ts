import { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function manifest({ params }: { params: { empresa: string; sucursal: string } }): Promise<MetadataRoute.Manifest> {
  const supabase = createAdminClient()
  
  const { data: empresa } = await supabase
    .from('empresas')
    .select('nombre')
    .eq('slug', params.empresa)
    .single()

  const nombre = empresa?.nombre ?? 'Delivery'

  return {
    name: nombre,
    short_name: nombre,
    description: 'Pedí tu helado a domicilio',
    start_url: `/${params.empresa}/delivery/${params.sucursal}`,
    id: `/${params.empresa}/delivery/${params.sucursal}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf8f5',
    theme_color: '#faf8f5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
