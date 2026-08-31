'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { Gift, Loader2, Check, Cherry, Users, History } from 'lucide-react'

interface Config { activo: boolean; habilitado_admin: boolean; pesos_por_punto: number }
interface Accesorio { id: string; nombre: string; emoji: string | null; imagen_url: string | null; puntos_canje: number | null }
interface Cliente { id: string; telefono: string; puntos: number; puntos_historicos: number; created_at: string }
interface Movimiento { id: string; tipo: string; puntos: number; detalle: string | null; created_at: string; cliente_id: string }

function formatFecha(ts: string) {
  return new Date(ts).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function BeneficiosPage() {
  const { ctx } = useEmpresa()
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<Config | null>(null)
  const [accesorios, setAccesorios] = useState<Accesorio[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [guardandoToggle, setGuardandoToggle] = useState(false)
  const [puntosEdit, setPuntosEdit] = useState<Record<string, string>>({})
  const [guardandoAcc, setGuardandoAcc] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!ctx?.empresaId) return
    const supabase = createClient()
    const [{ data: cfg }, { data: grupos }, { data: cli }, { data: movs }] = await Promise.all([
      supabase.from('beneficios_config').select('activo, habilitado_admin, pesos_por_punto').eq('empresa_id', ctx.empresaId).maybeSingle(),
      supabase.from('grupos_opciones').select('id, nombre').eq('empresa_id', ctx.empresaId),
      supabase.from('clientes_beneficios').select('id, telefono, puntos, puntos_historicos, created_at').eq('empresa_id', ctx.empresaId).order('puntos', { ascending: false }).limit(100),
      supabase.from('beneficios_movimientos').select('id, tipo, puntos, detalle, created_at, cliente_id').eq('empresa_id', ctx.empresaId).order('created_at', { ascending: false }).limit(30),
    ])
    setConfig(cfg ? { activo: !!cfg.activo, habilitado_admin: cfg.habilitado_admin !== false, pesos_por_punto: Number(cfg.pesos_por_punto) } : null)
    setClientes(cli ?? [])
    setMovimientos(movs ?? [])

    // Accesorios: opciones de los grupos cuyo nombre contiene "accesorio"
    const grupoIds = (grupos ?? []).filter(g => g.nombre.toLowerCase().includes('accesorio')).map(g => g.id)
    if (grupoIds.length > 0) {
      const { data: accs } = await supabase.from('opciones')
        .select('id, nombre, emoji, imagen_url, puntos_canje')
        .in('grupo_id', grupoIds).order('nombre')
      setAccesorios(accs ?? [])
      const edit: Record<string, string> = {}
      for (const a of accs ?? []) edit[a.id] = a.puntos_canje != null ? String(a.puntos_canje) : ''
      setPuntosEdit(edit)
    }
    setLoading(false)
  }, [ctx?.empresaId])

  useEffect(() => { load() }, [load])

  async function toggleHabilitado() {
    if (!ctx?.empresaId || !config) return
    setGuardandoToggle(true)
    const supabase = createClient()
    const { error } = await supabase.from('beneficios_config')
      .update({ habilitado_admin: !config.habilitado_admin, updated_at: new Date().toISOString() })
      .eq('empresa_id', ctx.empresaId)
    setGuardandoToggle(false)
    if (error) { alert(`No se pudo guardar: ${error.message}`); return }
    setConfig({ ...config, habilitado_admin: !config.habilitado_admin })
  }

  async function guardarPuntosAccesorio(acc: Accesorio) {
    setGuardandoAcc(acc.id)
    const supabase = createClient()
    const raw = (puntosEdit[acc.id] ?? '').trim()
    const valor = raw === '' ? null : Math.max(0, parseInt(raw) || 0) || null
    const { error } = await supabase.from('opciones').update({ puntos_canje: valor }).eq('id', acc.id)
    setGuardandoAcc(null)
    if (error) { alert(`No se pudo guardar: ${error.message}`); return }
    setAccesorios(prev => prev.map(a => a.id === acc.id ? { ...a, puntos_canje: valor } : a))
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-200" /></div>

  if (!config || !config.activo) return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900">Programa de Beneficios</h1>
      </div>
      <div className="bg-white rounded-2xl border border-neutral-100 p-10 text-center shadow-sm max-w-lg">
        <Gift className="h-10 w-10 text-neutral-200 mx-auto mb-3" />
        <p className="text-neutral-700 font-bold mb-1">Módulo no contratado</p>
        <p className="text-neutral-400 text-sm">El Programa de Beneficios no está activo para tu cuenta. Consultá con QP C&IA para activarlo.</p>
      </div>
    </div>
  )

  const telefonoMap: Record<string, string> = {}
  for (const c of clientes) telefonoMap[c.id] = c.telefono

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900">Programa de Beneficios</h1>
        <p className="text-neutral-400 text-sm mt-0.5">Tus clientes suman {`1 punto cada $${Number(config.pesos_por_punto).toLocaleString('es-AR')}`} en productos</p>
      </div>

      {/* Toggle del programa */}
      <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm mb-6 flex items-center justify-between max-w-2xl">
        <div>
          <p className="font-bold text-neutral-800">Programa de puntos {config.habilitado_admin ? 'activo' : 'pausado'}</p>
          <p className="text-neutral-400 text-sm">{config.habilitado_admin ? 'Los clientes pueden sumar puntos en cada compra' : 'El programa está pausado — no se muestran ni acreditan puntos'}</p>
        </div>
        <button onClick={toggleHabilitado} disabled={guardandoToggle}
          className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${config.habilitado_admin ? 'bg-green-500' : 'bg-neutral-200'}`}>
          <span className={`absolute top-1 h-6 w-6 bg-white rounded-full shadow transition-all ${config.habilitado_admin ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Puntos de canje por accesorio */}
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm mb-6 max-w-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-50 flex items-center gap-2">
          <Cherry className="h-4 w-4 text-neutral-400" />
          <h2 className="font-bold text-neutral-700">Canje por accesorios</h2>
        </div>
        <div className="px-5 py-3">
          <p className="text-neutral-400 text-xs mb-3">Definí cuántos puntos cuesta cada accesorio. Vacío = no canjeable.</p>
          {accesorios.length === 0 ? (
            <p className="text-neutral-300 text-sm py-4 text-center">Sin accesorios cargados</p>
          ) : (
            <div className="space-y-2 pb-2">
              {accesorios.map(acc => (
                <div key={acc.id} className="flex items-center gap-3">
                  {acc.imagen_url
                    ? <img src={acc.imagen_url} alt={acc.nombre} className="w-8 h-8 object-cover rounded-lg" />
                    : <span className="w-8 h-8 rounded-lg bg-neutral-50 flex items-center justify-center">{acc.emoji ?? '🍒'}</span>}
                  <span className="flex-1 text-sm font-semibold text-neutral-700">{acc.nombre.replace(/^Toppings?\s+/i, '')}</span>
                  <input value={puntosEdit[acc.id] ?? ''} inputMode="numeric" placeholder="—"
                    onChange={e => setPuntosEdit(prev => ({ ...prev, [acc.id]: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                    className="w-20 px-3 py-1.5 rounded-lg border border-neutral-200 text-sm font-bold text-center focus:outline-none focus:border-neutral-400" />
                  <span className="text-xs text-neutral-400 w-8">pts</span>
                  <button onClick={() => guardarPuntosAccesorio(acc)} disabled={guardandoAcc === acc.id}
                    className="w-8 h-8 rounded-lg bg-neutral-800 text-white flex items-center justify-center disabled:opacity-40 hover:bg-neutral-700 transition-colors">
                    {guardandoAcc === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Clientes */}
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm mb-6 max-w-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-neutral-400" />
            <h2 className="font-bold text-neutral-700">Clientes</h2>
          </div>
          <span className="text-xs text-neutral-400">{clientes.length} clientes</span>
        </div>
        {clientes.length === 0 ? (
          <p className="text-neutral-300 text-sm py-8 text-center">Todavía nadie sumó puntos</p>
        ) : (
          <div className="divide-y divide-neutral-50">
            <div className="px-5 py-2 grid grid-cols-3 gap-2 text-xs text-neutral-400 font-semibold uppercase tracking-wide">
              <span>Teléfono</span><span className="text-right">Puntos</span><span className="text-right">Histórico</span>
            </div>
            {clientes.map(c => (
              <div key={c.id} className="px-5 py-3 grid grid-cols-3 gap-2 items-center">
                <span className="font-mono font-bold text-neutral-800 text-sm">{c.telefono}</span>
                <span className="text-right font-black text-neutral-800">{c.puntos}</span>
                <span className="text-right text-neutral-400 text-sm">{c.puntos_historicos}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Últimos movimientos */}
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm max-w-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-50 flex items-center gap-2">
          <History className="h-4 w-4 text-neutral-400" />
          <h2 className="font-bold text-neutral-700">Últimos movimientos</h2>
        </div>
        {movimientos.length === 0 ? (
          <p className="text-neutral-300 text-sm py-8 text-center">Sin movimientos todavía</p>
        ) : (
          <div className="divide-y divide-neutral-50">
            {movimientos.map(m => (
              <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-700">
                    <span className="font-mono">{telefonoMap[m.cliente_id] ?? '—'}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${m.tipo === 'ganado' ? 'bg-green-50 text-green-600' : m.tipo === 'canjeado' ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-500'}`}>{m.tipo}</span>
                  </p>
                  {m.detalle && <p className="text-neutral-400 text-xs truncate">{m.detalle}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`font-black ${m.puntos >= 0 ? 'text-green-600' : 'text-red-500'}`}>{m.puntos >= 0 ? '+' : ''}{m.puntos}</p>
                  <p className="text-neutral-300 text-xs">{formatFecha(m.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
