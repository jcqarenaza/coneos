import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ConeOS',
    short_name: 'ConeOS',
    description: 'Sistema de pedidos para heladerías',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf8f5',
    theme_color: '#1E3A5F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
