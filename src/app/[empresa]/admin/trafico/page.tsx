'use client'

import { useEffect, useState } from 'react'
import { useEmpresa } from '@/lib/useEmpresa'
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

  useEffect(() => {
    if (!ctx) return
    fetch(`/api/visitas/resumen?empresa_id=${ctx.empresaId}`)
      .then(r => r.json())
      .then(d => {
        setDelivery(d.delivery ?? [])
        setMesa(d.mesa ?? [])
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
      <CanalCard titulo="Delivery" emoji="🛵" serie={delivery} activo={delivery.length > 0} />
      <CanalCard titulo="Mesas" emoji="🪑" serie={mesa} activo={mesa.length > 0} />
      <p className="text-xs text-neutral-300 text-center">Visitantes = celulares únicos por día (anónimo). Conversión = pedidos ÷ visitantes.</p>
    </div>
  )
}
