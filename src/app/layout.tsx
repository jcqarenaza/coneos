import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ConeOS',
  description: 'Sistema de pedidos para heladerías',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="manifest" href="/manifest.json" id="pwa-manifest" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" content="#faf8f5" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var path = window.location.pathname;
            var token = new URLSearchParams(window.location.search).get('token');
            var manifestLink = document.getElementById('pwa-manifest');
            if (!manifestLink) return;

            var esDelivery = path.includes('/delivery/') || path.split('/')[2] === 'd' || path.includes('/d/');
            if (!esDelivery) return;

            if (token) {
              manifestLink.href = '/api/manifest?token=' + encodeURIComponent(token);
            } else {
              // Sin token: /{empresa}/d/{token} o /{empresa}/delivery/{sucursal}
              var partes = path.split('/').filter(Boolean);
              if (partes[1] === 'd' && partes[2]) {
                manifestLink.href = '/api/manifest?token=' + encodeURIComponent(partes[2]);
              } else if (partes[1] === 'delivery' && partes[2]) {
                manifestLink.href = '/api/manifest?empresa=' + encodeURIComponent(partes[0]) + '&sucursal=' + encodeURIComponent(partes[2]);
              }
            }
          })();
        `}} />
      </head>
      <body className={geist.className}>{children}</body>
    </html>
  )
}
