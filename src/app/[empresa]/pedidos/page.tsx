'use client'

// ============================================================
// APP PÚBLICA DE PEDIDOS · ALCANCE EMPRESA · /{empresa}/pedidos
// (JC 13/10: una empresa con 2+ sucursales no tenía QR "de la
// empresa" — la puerta única nacía atada a la sucursal.)
// Es un ESCALÓN ARRIBA del orquestador existente: lista las
// sucursales activas y manda a /{empresa}/pedidos/{sucursal},
// que sigue siendo el único que conoce canales y estados.
//   · 1 sola sucursal → redirect directo, sin selector
//   · 2+ → tarjetas con nombre y dirección
//   · query string (token, desde) → passthrough PURO al destino
// Los QR por sucursal siguen vivos e intactos (regla sagrada).
// ============================================================

import { useEffect, useState } from 'react'

interface SucursalItem { nombre: string; slug: string; direccion: string | null; url: string }
interface ContextoEmpresa {
  nombre: string
  config: { primary_color: string; secondary_color: string; logo_url: string | null }
  sucursales: SucursalItem[]
}

export default function EntradaEmpresaPage() {
  const [ctx, setCtx] = useState<ContextoEmpresa | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'no-disponible' | 'selector' | 'redirigiendo'>('cargando')

  useEffect(() => {
    async function init() {
      const partes = window.location.pathname.split('/').filter(Boolean)
      const empresaSlug = partes[0]
      if (!empresaSlug) { setEstado('no-disponible'); return }
      try {
        const res = await fetch(`/api/pedidos-entrada/contexto?empresa=${encodeURIComponent(empresaSlug)}`)
        if (!res.ok) { setEstado('no-disponible'); return }
        const d = (await res.json()) as ContextoEmpresa
        const sucs = d.sucursales ?? []
        if (sucs.length === 0) { setEstado('no-disponible'); return }
        // Passthrough puro de la query (token del puente de delivery, desde=app)
        const qs = window.location.search ?? ''
        if (sucs.length === 1) {
          setEstado('redirigiendo')
          window.location.replace(sucs[0].url + qs)
          return
        }
        setCtx({ ...d, sucursales: sucs.map(s => ({ ...s, url: s.url + qs })) })
        setEstado('selector')
      } catch { setEstado('no-disponible') }
    }
    init()
  }, [])

  if (estado === 'cargando' || estado === 'redirigiendo') return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-400 rounded-full animate-spin" />
    </div>
  )

  if (estado === 'no-disponible' || !ctx) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-3" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-3xl">🍦</p>
      <p className="text-neutral-700 font-bold text-lg">Pedidos online no disponible</p>
      <p className="text-neutral-400 text-sm text-center">Este local todavía no tiene activados los pedidos por acá.</p>
    </div>
  )

  const color = ctx.config.primary_color

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-12" style={{ backgroundColor: '#faf8f5' }}>
      {ctx.config.logo_url
        ? <img src={ctx.config.logo_url} alt={ctx.nombre} className="h-16 object-contain mb-6" />
        : <p className="text-2xl font-black mb-6" style={{ color }}>{ctx.nombre}</p>}
      <h1 className="text-xl font-bold text-neutral-800 mb-1 text-center">{ctx.nombre}</h1>
      <p className="text-neutral-400 text-sm mb-8 text-center">¿En qué sucursal querés pedir?</p>
      <div className="w-full max-w-md space-y-3">
        {ctx.sucursales.map(s => (
          <a key={s.slug} href={s.url}
            className="block bg-white rounded-2xl border border-neutral-100 shadow-sm px-5 py-4 active:scale-98 transition-transform">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-neutral-800">{s.nombre}</p>
                {s.direccion && <p className="text-neutral-400 text-sm truncate">📍 {s.direccion}</p>}
              </div>
              <span className="flex-shrink-0 px-4 py-2 rounded-xl text-white text-sm font-bold" style={{ backgroundColor: color }}>
                Pedir
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
