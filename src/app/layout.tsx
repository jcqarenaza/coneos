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

            // Solo inyectar manifest si se resolvió uno dinámico (evita 404 de /manifest.json en caja/admin)
            if (href.indexOf('/api/manifest') === 0) {
              var link = document.createElement('link');
              link.rel = 'manifest';
              link.href = href;
              document.head.appendChild(link);
            }

            // apple-touch-icon dinamico para iOS (iOS ignora el manifest para el icono)
            if (href.indexOf('/api/manifest') === 0) {
              fetch(href).then(function(r) { return r.json() }).then(function(m) {
                if (m && m.icons && m.icons[0] && m.icons[0].src) {
                  var old = document.querySelectorAll('link[rel="apple-touch-icon"]');
                  old.forEach(function(l) { l.remove() });
                  var ai = document.createElement('link');
                  ai.rel = 'apple-touch-icon';
                  ai.href = m.icons[0].src;
                  document.head.appendChild(ai);
                  if (m.name) {
                    var mt = document.querySelector('meta[name="apple-mobile-web-app-title"]');
                    if (!mt) { mt = document.createElement('meta'); mt.name = 'apple-mobile-web-app-title'; document.head.appendChild(mt) }
                    mt.content = m.name;
                  }
                }
              }).catch(function() {});
            }
          })();
        `}} />
      </head>
      <body className={geist.className}>{children}</body>
    </html>
  )
}
