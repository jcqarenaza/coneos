'use client'

// ============================================================
// CICLO 2 — APP PÚBLICA DE PEDIDOS · /{empresa}/pedidos/{sucursal}
// La URL canónica de la App Pública (alcance SUCURSAL implícito).
// Es ENTRADA/ORQUESTADOR, no un flujo (contrato CTO): decide a qué
// flujo EXISTENTE mandar al cliente y nada más. No conoce carrito,
// catálogo ni checkout. TOKEN: passthrough PURO — si llegó ?token=
// (QR de delivery redirigido por el puente), se reenvía intacto al
// flujo Delivery; esta capa no lo lee ni lo valida ni lo modifica.
// ?desde=app: SOLO anti-loop (el puente de delivery no re-reenvía
// cuando está); jamás estado de negocio.
//   toggle OFF (gate server-side del agregador) → no disponible
//   ambos canales disponibles → selector estado+acción
//   exactamente uno disponible → redirect directo, sin selector
//   configurados pero ninguno disponible → pantalla cerrado que
//     MUESTRA los canales con su estado (el cliente entiende que
//     existen — decisión CTO)
//   ninguno configurado → no disponible
// Las rutas viejas de delivery (token o slug) y TA siguen vivas e
// intocadas, independientes del toggle.
// ============================================================

import { useEffect, useState } from 'react'

interface Canal { configurado: boolean; visible?: boolean; disponible: boolean; anticipado?: boolean; motivo: string | null; proximo: string | null; url: string }
interface Contexto {
  nombre: string
  sucursal_nombre: string
  negocio: { direccion: string | null; horarios: { desde: string; hasta: string }[]; mensaje: string | null }
  config: { primary_color: string; secondary_color: string; logo_url: string | null }
  servicios: { delivery: Canal; takeaway: Canal }
}

export default function EntradaPedidosPage() {
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'no-disponible' | 'selector' | 'cerrado' | 'redirigiendo'>('cargando')

  useEffect(() => {
    async function init() {
      // Slugs del pathname: /{empresa}/pedidos/{sucursal} (mismo criterio que
      // delivery/TA: los params de client pages son Promise en Next 16)
      const partes = window.location.pathname.split('/').filter(Boolean)
      const empresaSlug = partes[0]
      const sucursalSlug = partes[2]
      if (!empresaSlug || !sucursalSlug) { setEstado('no-disponible'); return }

      const res = await fetch(`/api/pedidos-entrada/contexto?empresa=${empresaSlug}&sucursal=${sucursalSlug}`)
      if (!res.ok) { setEstado('no-disponible'); return } // gate OFF o slugs inválidos: acá muere
      const data: Contexto = await res.json()
      setCtx(data)

      // Token passthrough puro (condición CTO): si el puente nos mandó el
      // token del QR, viaja intacto hacia Delivery. Esta capa NO lo interpreta.
      const token = new URLSearchParams(window.location.search).get('token')
      const armarUrl = (base: string, esDelivery: boolean) => {
        const p = new URLSearchParams()
        if (esDelivery && token) p.set('token', token)
        p.set('desde', 'app') // solo anti-loop
        return `${base}?${p.toString()}`
      }

      const d = { ...data.servicios.delivery, url: armarUrl(data.servicios.delivery.url, true) }
      const t = { ...data.servicios.takeaway, url: armarUrl(data.servicios.takeaway.url, false) }
      data.servicios = { delivery: d, takeaway: t }
      // CANALES VISIBLES (espec JC): la puerta pública muestra configurado &&
      // visible — la URL directa del canal ni se entera de esta llave
      const mostrables = [d, t].filter(c => c.configurado && c.visible !== false)
      const disponibles = mostrables.filter(c => c.disponible)

      if (mostrables.length === 0) { setEstado('no-disponible'); return }
      // DECISIÓN JC 22/09 (mata el redirect del Ciclo 2): la App es LA puerta,
      // SIEMPRE. El selector se muestra aunque haya un solo servicio — una
      // tarjeta también es selector. Cero teletransportes, cero clientes
      // atrapados en un slug cuando la config cambia: F5 y la puerta dice
      // la verdad del momento. (El token sigue viajando en la tarjeta de
      // delivery — passthrough intacto.)
      setEstado(disponibles.length >= 1 ? 'selector' : 'cerrado')
    }
    init()
  }, [])

  if (estado === 'cargando' || estado === 'redirigiendo') return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      {/* 2.1a: con contexto en mano, la espera muestra la marca (pulso suave);
          antes del contexto no hay logo — spinner neutro. Cero delay agregado. */}
      {ctx?.config.logo_url
        ? <img src={ctx.config.logo_url} alt="" className="w-24 h-24 object-contain animate-pulse" />
        : <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />}
    </div>
  )

  if (estado === 'no-disponible' || !ctx) {
    // Con contexto (toggle ON pero sin servicios que mostrar): la PÁGINA DEL
    // NEGOCIO — nombre, dirección y horarios del local (datos de sucursales).
    // Sin contexto (toggle OFF / slugs inválidos): mensaje neutro, sin rubro.
    if (!ctx) return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-3 text-center" style={{ backgroundColor: '#faf8f5' }}>
        <p className="text-neutral-500">Esta página no está disponible.</p>
      </div>
    )
    const horariosNegocio = [...(ctx.negocio?.horarios ?? [])].sort((a, b) => a.desde.localeCompare(b.desde)).map(h => `${h.desde} a ${h.hasta}`).join(' y ')
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-3 text-center" style={{ backgroundColor: '#faf8f5' }}>
        {ctx.config.logo_url && <img src={ctx.config.logo_url} alt="Logo" className="w-28 h-28 object-contain" />}
        <h1 className="text-2xl font-black text-neutral-800">{ctx.nombre}</h1>
        <p className="text-sm text-neutral-400 -mt-2">{ctx.sucursal_nombre}</p>
        {ctx.negocio?.direccion && <p className="text-sm font-semibold text-neutral-600">📍 {ctx.negocio.direccion}</p>}
        {horariosNegocio && <p className="text-neutral-700 text-sm font-semibold bg-white border border-neutral-100 rounded-2xl px-5 py-3 shadow-sm">🕗 Nuestro horario: {horariosNegocio}</p>}
        <p className="text-neutral-500 text-sm max-w-xs">{ctx.negocio?.mensaje ?? 'En este momento no estamos tomando pedidos online. ¡Te esperamos en el local!'}</p>
      </div>
    )
  }

  const color = ctx.config.primary_color
  const tarjetas: { emoji: string; titulo: string; sub: string; canal: Canal }[] = [
    { emoji: '🛵', titulo: 'Delivery', sub: 'Te lo llevamos', canal: ctx.servicios.delivery },
    { emoji: '🥡', titulo: 'Take Away', sub: 'Pedí y pasá a retirarlo', canal: ctx.servicios.takeaway },
  ].filter(x => x.canal.configurado && x.canal.visible !== false) // En App OFF = ni tarjeta ni cerrado: NADA
  // Cerrado global: "volvemos a atender a las X" = la próxima apertura más
  // temprana entre los servicios configurados (dato del agregador, no cálculo)
  const proximos = tarjetas.map(t => t.canal.proximo).filter((x): x is string => !!x).sort()
  const volvemosA = proximos[0] ?? null

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-md text-center">
        {ctx.config.logo_url
          ? <img src={ctx.config.logo_url} alt="Logo" className="w-28 h-28 object-contain mx-auto mb-4" />
          : null}
        <h1 className="text-2xl font-black text-neutral-800">{ctx.nombre}</h1>
        <p className="text-sm text-neutral-400 mb-2">{ctx.sucursal_nombre}</p>
        <h2 className="text-lg font-bold text-neutral-700 mt-6 mb-1">
          {estado === 'selector' ? '¿Cómo querés recibir tu pedido?' : 'Ahora estamos cerrados'}
        </h2>
        {estado === 'cerrado' && volvemosA && (
          <p className="text-sm font-semibold text-neutral-500 mb-4">Volvemos a atender a las {volvemosA}</p>
        )}
        {(estado === 'selector' || !volvemosA) && <div className="mb-3" />}

        <div className="space-y-3">
          {tarjetas.map(({ emoji, titulo, sub, canal }) => (
            <div key={titulo}
              className={`w-full bg-white rounded-2xl border-2 p-5 text-left shadow-sm transition-all ${canal.disponible ? '' : 'opacity-70'}`}
              style={{ borderColor: canal.disponible ? `${color}40` : '#e5e5e5' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-neutral-800">{emoji} {titulo}</p>
                  <p className="text-xs text-neutral-400">{sub}</p>
                  {canal.disponible
                    ? (canal.anticipado
                        ? <p className="text-sm font-semibold text-amber-600 mt-1">🟠 Abre a las {canal.proximo} — pedí ahora</p>
                        : <p className="text-sm font-semibold text-green-600 mt-1">🟢 Abierto</p>)
                    : canal.proximo
                      ? <p className="text-sm font-semibold text-amber-600 mt-1">🟠 Abre a las {canal.proximo}</p>
                      : <p className="text-sm font-semibold text-neutral-400 mt-1">{canal.motivo ?? 'No disponible'}</p>}
                </div>
                {canal.disponible ? (
                  <a href={canal.url}
                    className="px-5 py-2.5 rounded-xl text-white font-bold text-sm shadow-sm active:scale-95 transition-transform whitespace-nowrap"
                    style={{ backgroundColor: color }}>
                    Elegir
                  </a>
                ) : (
                  <span className="px-5 py-2.5 rounded-xl bg-neutral-100 text-neutral-400 font-bold text-sm whitespace-nowrap">No disponible</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {estado === 'cerrado' && (
          <p className="text-sm text-neutral-400 mt-6">¡Volvé dentro del horario de atención!</p>
        )}
      </div>
    </div>
  )
}
