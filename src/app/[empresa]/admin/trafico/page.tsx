'use client'

import { useEffect, useState } from 'react'
import { useEmpresa } from '@/lib/useEmpresa'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// Admin → Tráfico: cuántos clientes entran al delivery y a las mesas,
// cuántos piden, y la conversión — hoy y últimos 14 días.
// Los datos son SOLO de esta empresa (scoped por contexto del admin).
// ═══════════════════════════════════════════════════════════════════

interface Dia { fecha: string; visitantes: number; aperturas: number; pedidos: number; conversion: number | null }

function hoyAR() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) }
function fechaCorta(f: string) {
  const [y, m, d] = f.split('-')
  return `${d}/${m}`
}

function CanalCard({ titulo, emoji, serie, activo }: { titulo: string; emoji: string; serie: Dia[]; activo: boolean }) {
  const hoy = serie.find(d => d.fecha === hoyAR())
  const maxVis = Math.max(1, ...serie.map(d => d.visitantes))
  const tot = serie.reduce((a, d) => ({ v: a.v + d.visitantes, p: a.p + d.pedidos }), { v: 0, p: 0 })
  const convTotal = tot.v > 0 ? Math.round(1000 * tot.p / tot.v) / 10 : null

  return (
    <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-black text-neutral-800">{emoji} {titulo}</h2>
        {!activo && <span className="text-xs text-neutral-300">sin datos aún</span>}
      </div>

      {/* Hoy */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-neutral-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-neutral-800">{hoy?.visitantes ?? 0}</p>
          <p className="text-xs text-neutral-400 font-semibold">Visitantes hoy</p>
        </div>
        <div className="bg-neutral-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-neutral-800">{hoy?.pedidos ?? 0}</p>
          <p className="text-xs text-neutral-400 font-semibold">Pedidos hoy</p>
        </div>
        <div className="bg-neutral-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-neutral-800">{hoy?.conversion != null ? `${hoy.conversion}%` : '—'}</p>
          <p className="text-xs text-neutral-400 font-semibold">Conversión hoy</p>
        </div>
      </div>

      {/* Serie 14 días */}
      {serie.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-6">Cuando los clientes empiecen a entrar, acá aparecen los días 📈</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center text-xs font-semibold text-neutral-300 uppercase tracking-wide gap-2">
            <span className="w-11">Día</span>
            <span className="flex-1">Visitantes</span>
            <span className="w-14 text-right">Pedidos</span>
            <span className="w-14 text-right">Conv.</span>
          </div>
          {serie.map(d => (
            <div key={d.fecha} className="flex items-center gap-2 text-sm">
              <span className="w-11 text-neutral-400 font-semibold text-xs">{fechaCorta(d.fecha)}</span>
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className="h-4 rounded bg-neutral-800/80" style={{ width: `${Math.max(3, 100 * d.visitantes / maxVis)}%` }} />
                <span className="text-neutral-600 font-bold text-xs flex-shrink-0">{d.visitantes}</span>
              </div>
              <span className="w-14 text-right font-bold text-neutral-700">{d.pedidos}</span>
              <span className="w-14 text-right text-neutral-400 font-semibold">{d.conversion != null ? `${d.conversion}%` : '—'}</span>
            </div>
          ))}
          {tot.v > 0 && (
            <div className="flex items-center gap-2 text-sm border-t border-neutral-100 pt-2 mt-2">
              <span className="w-11 text-neutral-400 font-bold text-xs">Total</span>
              <span className="flex-1 font-black text-neutral-800">{tot.v} visitantes</span>
              <span className="w-14 text-right font-black text-neutral-800">{tot.p}</span>
              <span className="w-14 text-right font-bold text-neutral-600">{convTotal != null ? `${convTotal}%` : '—'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TraficoPage() {
  const { ctx } = useEmpresa()
  const [loading, setLoading] = useState(true)
  const [delivery, setDelivery] = useState<Dia[]>([])
  const [mesa, setMesa] = useState<Dia[]>([])
  const [takeaway, setTakeaway] = useState<Dia[]>([])
  const [app, setApp] = useState<Dia[]>([])
  const [adquisicion, setAdquisicion] = useState<{ referrers: { nombre: string; visitas: number }[]; utm_sources: { nombre: string; visitas: number }[] }>({ referrers: [], utm_sources: [] })
  const [destinos, setDestinos] = useState<{ total: number; items: { destino: string; pedidos: number; participacion: number }[] }>({ total: 0, items: [] })
  const [modulos, setModulos] = useState<Record<string, boolean>>({})
  const [appHabilitada, setAppHabilitada] = useState(false)

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    Promise.all([
      fetch(`/api/visitas/resumen?empresa_id=${ctx.empresaId}`).then(r => r.json()),
      supabase.from('empresa_config').select('modulos, entrada_unificada').eq('empresa_id', ctx.empresaId).maybeSingle(),
    ])
      .then(([d, { data: cfg }]) => {
        setDelivery(d.delivery ?? [])
        setMesa(d.mesa ?? [])
        setTakeaway(d.takeaway ?? [])
        setApp(d.app ?? [])
        setAdquisicion(d.adquisicion ?? { referrers: [], utm_sources: [] })
        setDestinos(d.destinos ?? { total: 0, items: [] })
        setModulos((cfg?.modulos ?? {}) as Record<string, boolean>)
        setAppHabilitada((cfg as { entrada_unificada?: boolean } | null)?.entrada_unificada === true)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [ctx])

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-black text-neutral-900">📈 Tráfico</h1>
        <p className="text-neutral-400 text-sm">Cuántos clientes entran desde el celular y cuántos terminan pidiendo — últimos 14 días</p>
      </div>
      {/* Cada canal aparece solo si el módulo está contratado (o si tuvo datos alguna vez) */}
      {appHabilitada && app.length > 0 && <CanalCard titulo="App de pedidos" emoji="📱" serie={app} activo={app.length > 0} />}
      {(modulos.delivery === true || delivery.length > 0) && <CanalCard titulo="Delivery" emoji="🛵" serie={delivery} activo={delivery.length > 0} />}
      {(modulos.takeaway === true || takeaway.length > 0) && <CanalCard titulo="Take Away" emoji="🥡" serie={takeaway} activo={takeaway.length > 0} />}
      {(modulos.mesas === true || mesa.length > 0) && <CanalCard titulo="Mesas" emoji="🪑" serie={mesa} activo={mesa.length > 0} />}

      {/* ¿De dónde vienen? — adquisición (referrer + utm_source, 14 días) */}
      {(adquisicion.referrers.length > 0 || adquisicion.utm_sources.length > 0) && (
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5">
          <h2 className="font-black text-neutral-800 mb-3">🌐 ¿De dónde vienen?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {adquisicion.utm_sources.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-neutral-300 uppercase tracking-wide mb-1.5">Campañas (utm_source)</p>
                {adquisicion.utm_sources.map(r => (
                  <div key={r.nombre} className="flex justify-between text-sm py-0.5"><span className="text-neutral-600 font-semibold">{r.nombre}</span><span className="text-neutral-400 font-bold">{r.visitas}</span></div>
                ))}
              </div>
            )}
            {adquisicion.referrers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-neutral-300 uppercase tracking-wide mb-1.5">Sitios que derivan (referrer)</p>
                {adquisicion.referrers.map(r => (
                  <div key={r.nombre} className="flex justify-between text-sm py-0.5"><span className="text-neutral-600 font-semibold truncate mr-2">{r.nombre}</span><span className="text-neutral-400 font-bold">{r.visitas}</span></div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-neutral-300 mt-3">Solo se registra el primer origen conocido de cada visitante por día. Sin campaña ni sitio derivador, la visita cuenta igual pero no aparece acá.</p>
        </div>
      )}

      {/* ¿A dónde entregamos? — destino delivery desde datos_delivery, sin captura nueva */}
      {destinos.items.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5">
          <h2 className="font-black text-neutral-800 mb-1">📦 ¿A dónde entregamos?</h2>
          <p className="text-xs text-neutral-400 mb-3">Direcciones más pedidas por delivery — últimos 14 días ({destinos.total} entregas)</p>
          <div className="space-y-1.5">
            {destinos.items.map(d => (
              <div key={d.destino} className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <div className="h-4 rounded bg-neutral-800/80" style={{ width: `${Math.max(4, d.participacion)}%` }} />
                  <span className="text-neutral-600 font-semibold text-xs truncate">{d.destino}</span>
                </div>
                <span className="w-10 text-right font-bold text-neutral-700">{d.pedidos}</span>
                <span className="w-12 text-right text-neutral-400 font-semibold text-xs">{d.participacion}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {modulos.delivery !== true && modulos.mesas !== true && delivery.length === 0 && mesa.length === 0 && (
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-8 text-center">
          <span className="text-4xl block mb-2">📈</span>
          <p className="text-neutral-500 text-sm">El tráfico se mide en los canales donde tus clientes entran desde el celular: Delivery y Mesas. Activá alguno para empezar a medir.</p>
        </div>
      )}
      <p className="text-xs text-neutral-300 text-center">Visitantes = celulares únicos por día (anónimo). Conversión = pedidos ÷ visitantes. La App convierte contra los pedidos online (Delivery + Take Away).</p>
    </div>
  )
}
