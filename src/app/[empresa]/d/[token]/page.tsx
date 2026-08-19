'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'

export default function DeliveryShortLink() {
  const params = useParams()
  const empresa = params.empresa as string
  const token = params.token as string

  useEffect(() => {
    async function redirigir() {
      const res = await fetch('/api/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_token: token }),
      })
      const data = await res.json()
      if (!res.ok || !data.dispositivo) {
        return
      }
      const sucSlug = Array.isArray(data.dispositivo.sucursales)
        ? data.dispositivo.sucursales[0]?.slug
        : data.dispositivo.sucursales?.slug
      window.location.replace(`/${empresa}/delivery/${sucSlug}?token=${token}`)
    }
    redirigir()
  }, [empresa, token])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
    </div>
  )
}
