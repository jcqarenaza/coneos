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
        <meta name="apple-mobile-web-app-title" content="ConeOS" />
        <meta name="theme-color" content="#faf8f5" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var path = window.location.pathname;
            var token = new URLSearchParams(window.location.search).get('token');
            var manifestLink = document.getElementById('pwa-manifest');
            if (!manifestLink) return;

            // Detectar tipo de dispositivo por ruta
            var tipo = null;
            if (path.includes('/delivery/') || path.includes('/d/')) tipo = 'delivery';
            else if (path.includes('/kiosk/')) tipo = 'kiosk';
            else if (path.includes('/display/')) tipo = 'display';

            if (tipo && token) {
              // Manifest dinámico via API
              manifestLink.href = '/api/pwa-manifest?tipo=' + tipo + '&token=' + encodeURIComponent(token) + '&path=' + encodeURIComponent(path);
            }
          })();
        `}} />
      </head>
      <body className={geist.className}>{children}</body>
    </html>
  )
}
