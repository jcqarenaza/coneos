'use client'

import { useEffect, useState } from 'react'

export default function DeliveryShortLink() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function redirigir() {
      try {
        const partes = window.location.pathname.split('/').filter(Boolean)
        const token = partes[2]
        if (!token) { setError('No se encontró el código en la URL: ' + window.location.pathname); return }

        const res = await fetch('/api/device/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_token: token }),
        })

        let data: { dispositivo?: { sucursales?: { slug: string } | { slug: string }[]; empresas?: { slug: string } | { slug: string }[] }; error?: string } | null = null
        try { data = await res.json() } catch { setError('Respuesta inválida del servidor (' + res.status + ')'); return }

        if (!res.ok || !data?.dispositivo) {
          setError('Verify falló: ' + res.status + ' — ' + (data?.error ?? 'sin detalle'))
          return
        }

        const sucSlug = Array.isArray(data.dispositivo.sucursales)
          ? data.dispositivo.sucursales[0]?.slug
          : data.dispositivo.sucursales?.slug
        const empSlug = Array.isArray(data.dispositivo.empresas)
          ? data.dispositivo.empresas[0]?.slug
          : data.dispositivo.empresas?.slug

        if (!sucSlug || !empSlug) {
          setError('Faltan slugs: empresa=' + JSON.stringify(data.dispositivo.empresas) + ' sucursal=' + JSON.stringify(data.dispositivo.sucursales))
          return
        }

        window.location.replace(`/${empSlug}/delivery/${sucSlug}?token=${token}`)
      } catch (e) {
        setError('Error inesperado: ' + String(e))
      }
    }
    redirigir()
  }, [])

  if (error) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-neutral-600 text-sm font-semibold mb-2">No pudimos abrir el delivery</p>
      <p className="text-neutral-400 text-xs break-all max-w-xs">{error}</p>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
    </div>
  )
}
