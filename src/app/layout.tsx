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
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" content="#faf8f5" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var path = window.location.pathname;
            var token = new URLSearchParams(window.location.search).get('token');
            var partes = path.split('/').filter(Boolean);
            var href = '/manifest.json';

            if (token && (path.indexOf('/delivery/') !== -1 || partes[1] === 'd')) {
              href = '/api/manifest?token=' + encodeURIComponent(token);
            } else if (partes[1] === 'd' && partes[2]) {
              href = '/api/manifest?token=' + encodeURIComponent(partes[2]);
            } else if (partes[1] === 'delivery' && partes[2]) {
              href = '/api/manifest?empresa=' + encodeURIComponent(partes[0]) + '&sucursal=' + encodeURIComponent(partes[2]);
            }

            var link = document.createElement('link');
            link.rel = 'manifest';
            link.href = href;
            document.head.appendChild(link);
          })();
        `}} />
      </head>
      <body className={geist.className}>{children}</body>
    </html>
  )
}
