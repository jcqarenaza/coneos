'use client'

import { useEffect, useState } from 'react'

export default function DeliveryShortLink() {
  const [error, setError] = useState(false)

  useEffect(() => {
    async function redirigir() {
      // Leer de pathname: /{empresa}/d/{token} — params son Promise en Next 16
      const partes = window.location.pathname.split('/').filter(Boolean)
      const token = partes[2]
      if (!token) { setError(true); return }

      const res = await fetch('/api/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_token: token }),
      })
      const data = await res.json()
      if (!res.ok || !data.dispositivo) { setError(true); return }

      const sucSlug = Array.isArray(data.dispositivo.sucursales)
        ? data.dispositivo.sucursales[0]?.slug
        : data.dispositivo.sucursales?.slug
      const empSlug = Array.isArray(data.dispositivo.empresas)
        ? data.dispositivo.empresas[0]?.slug
        : data.dispositivo.empresas?.slug

      if (!sucSlug || !empSlug) { setError(true); return }

      window.location.replace(`/${empSlug}/delivery/${sucSlug}?token=${token}`)
    }
    redirigir()
  }, [])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-neutral-400 text-sm">Link no válido</p>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
    </div>
  )
}
