'use client'

// ============================================================
// APP PÚBLICA DE PEDIDOS · ALCANCE EMPRESA · /{empresa}/pedidos
// (JC 13/10: una empresa con 2+ sucursales no tenía QR "de la
// empresa". Ajuste JC 13/10 08:52: la pantalla muestra DE UNA
// los canales de cada sucursal — nada de elegir sucursal y
// después el modo, un paso menos.)
// Sigue siendo entrada/orquestación: el estado de cada canal lo
// COMPONE el agregador por sucursal existente (una llamada por
// sucursal, misma fuente de verdad); esta página no inventa
// ninguna regla. Click → derecho al flujo del canal.
//   · 1 sola sucursal → redirect a /pedidos/{slug} (sin selector)
//   · 2+ → una card por sucursal con sus canales y estados
//   · query string (token, desde) → passthrough PURO
// Los QR por sucursal siguen vivos e intactos (regla sagrada).
// ============================================================

import { useEffect, useState } from 'react'

interface Canal { configurado: boolean; visible?: boolean; disponible: boolean; anticipado?: boolean; motivo: string | null; proximo: string | null; url: string }
interface SucursalItem { nombre: string; slug: string; direccion: string | null; url: string }
interface CtxSucursal {
  sucursal_nombre: string
  negocio: { mensaje: string | null; horarios?: { desde: string; hasta: string }[] }
  servicios: { delivery: Canal; takeaway: Canal }
}
interface Fila { suc: SucursalItem; ctx: CtxSucursal | null }
interface ContextoEmpresa {
  nombre: string
  config: { primary_color: string; secondary_color: string; logo_url: string | null }
  sucursales: SucursalItem[]
}

export default function EntradaEmpresaPage() {
  const [marca, setMarca] = useState<ContextoEmpresa | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
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
        const qs = window.location.search ?? ''
        if (sucs.length === 1) {
          setEstado('redirigiendo')
          window.location.replace(sucs[0].url + qs)
          return
        }
        setMarca(d)
        // Los canales de CADA sucursal, del agregador existente (fuente única)
        const detalles = await Promise.all(sucs.map(async (s): Promise<Fila> => {
          try {
            const r = await fetch(`/api/pedidos-entrada/contexto?empresa=${encodeURIComponent(empresaSlug)}&sucursal=${encodeURIComponent(s.slug)}`)
            if (!r.ok) return { suc: s, ctx: null }
            return { suc: s, ctx: (await r.json()) as CtxSucursal }
          } catch { return { suc: s, ctx: null } }
        }))
        setFilas(detalles)
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

  if (estado === 'no-disponible' || !marca) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-3" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-3xl">🍦</p>
      <p className="text-neutral-700 font-bold text-lg">Pedidos online no disponible</p>
      <p className="text-neutral-400 text-sm text-center">Este local todavía no tiene activados los pedidos por acá.</p>
    </div>
  )

  const color = marca.config.primary_color
  const qs = typeof window !== 'undefined' ? (window.location.search ?? '') : ''

  function CanalBtn({ canal, emoji, titulo, bajada }: { canal: Canal; emoji: string; titulo: string; bajada: string }) {
    if (!canal.configurado || canal.visible === false) return null
    const abierto = canal.disponible
    return (
      <a href={abierto ? canal.url + qs : undefined}
        className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${abierto ? 'border-neutral-100 bg-white active:scale-98 transition-transform' : 'border-neutral-100 bg-neutral-50 pointer-events-none'}`}>
        <div className="min-w-0">
          <p className={`text-sm font-bold ${abierto ? 'text-neutral-800' : 'text-neutral-400'}`}>{emoji} {titulo}</p>
          <p className="text-xs text-neutral-400">{bajada}</p>
          {abierto && (canal.anticipado && canal.proximo
            ? <p className="text-xs font-semibold text-amber-500 mt-0.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Abre a las {canal.proximo} — pedí ahora</p>
            : <p className="text-xs font-semibold text-green-600 mt-0.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Abierto</p>)}
          {!abierto && (
            <p className="text-xs font-semibold text-amber-500 mt-0.5 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
              {canal.motivo === 'No disponible' ? 'No disponible' : canal.proximo ? `Abre a las ${canal.proximo}` : canal.motivo ?? 'Cerrado'}
            </p>
          )}
        </div>
        {abierto
          ? <span className="flex-shrink-0 px-4 py-1.5 rounded-xl text-white text-sm font-bold" style={{ backgroundColor: color }}>Elegir</span>
          : <span className="flex-shrink-0 px-4 py-1.5 rounded-xl text-sm font-bold bg-neutral-100 text-neutral-300">No disponible</span>}
      </a>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-5 py-10" style={{ backgroundColor: '#faf8f5' }}>
      {marca.config.logo_url
        ? <img src={marca.config.logo_url} alt={marca.nombre} className="h-16 object-contain mb-5" />
        : <p className="text-2xl font-black mb-5" style={{ color }}>{marca.nombre}</p>}
      <h1 className="text-xl font-bold text-neutral-800 mb-1 text-center">{marca.nombre}</h1>
      <p className="text-neutral-400 text-sm mb-7 text-center">¿Cómo querés recibir tu pedido?</p>
      <div className="w-full max-w-md space-y-4">
        {filas.map(({ suc, ctx }) => {
          const canales = ctx ? [ctx.servicios.delivery, ctx.servicios.takeaway].filter(c => c.configurado && c.visible !== false) : []
          return (
            <div key={suc.slug} className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4">
              <p className="font-bold text-neutral-800">{suc.nombre}</p>
              {suc.direccion && <p className="text-neutral-400 text-xs">📍 {suc.direccion}</p>}
              {ctx && (ctx.negocio?.horarios?.length ?? 0) > 0 && (
                <p className="text-neutral-400 text-xs mb-2.5 mt-0.5">
                  🕐 {ctx.negocio.horarios!.map(h => h.desde === h.hasta ? 'Abierto las 24 h' : `${h.desde} a ${h.hasta}`).join(' · ')}
                </p>
              )}
              {(!ctx || (ctx.negocio?.horarios?.length ?? 0) === 0) && <div className="mb-2" />}
              {ctx === null ? (
                <p className="text-neutral-300 text-sm py-1">No disponible por el momento</p>
              ) : canales.length === 0 ? (
                <p className="text-neutral-300 text-sm py-1">{ctx.negocio?.mensaje ?? 'Sin pedidos online en esta sucursal'}</p>
              ) : (
                <div className="space-y-2">
                  <CanalBtn canal={ctx.servicios.delivery} emoji="🛵" titulo="Delivery" bajada="Te lo llevamos" />
                  <CanalBtn canal={ctx.servicios.takeaway} emoji="🥡" titulo="Take Away" bajada="Pedí y pasá a retirarlo" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
