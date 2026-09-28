'use client'
// ═══════════════════════════════════════════════════════════════
// 🛵 REPARTO V1 — PUERTA DEL CADETE (brief CTO 28/09)
// /[empresa]/reparto/[sucursal] — independiente de Caja y App Pública.
// Login nombre+PIN (colaborador rol cadete) → token en localStorage
// (el server valida SIEMPRE) → mis entregas → navegar → ENTREGADO.
// Tracking: watchPosition mientras haya reparto activo; el server
// rechaza sin reparto y borra la posición al entregar el último.
// Limitación V1 documentada: la PWA debe estar en pantalla (Wake
// Lock pedido); background con app cerrada = V2/nativa.
// ═══════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

interface DatosDelivery { nombre: string; telefono: string; direccion: string; entre_calles?: string }
interface PedidoCadete { id: string; numero_pedido: number; estado: string; total: number; metodo_pago: string | null; pagado?: boolean | null; notas: string | null; datos_delivery: DatosDelivery | null; hora_retiro: string | null; created_at: string }

function slugsDesdeURL() {
  // Next 16: params de client pages son Promise → pathname (regla del proyecto)
  const partes = window.location.pathname.split('/').filter(Boolean)
  return { empresa: partes[0] ?? '', sucursal: partes[2] ?? '' }
}
const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`

export default function RepartoPage() {
  const [fase, setFase] = useState<'cargando' | 'apagado' | 'login' | 'panel'>('cargando')
  const [empresaId, setEmpresaId] = useState('')
  const [sucursalId, setSucursalId] = useState('')
  const [marca, setMarca] = useState<{ nombre: string; color: string; logo: string | null; sucursal: string }>({ nombre: '', color: '#1E3A5F', logo: null, sucursal: '' })
  const [nombre, setNombre] = useState('')
  const [pin, setPin] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [cadete, setCadete] = useState<{ id: string; nombre: string } | null>(null)
  const [pedidos, setPedidos] = useState<PedidoCadete[]>([])
  const [entregando, setEntregando] = useState<string | null>(null)
  const [gps, setGps] = useState<'ok' | 'off' | 'pedir'>('pedir')
  const tokenRef = useRef<string | null>(null)
  const ultimaPosRef = useRef(0)

  const api = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/reparto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token: tokenRef.current }),
    })
    const d = await res.json().catch(() => null)
    if (res.status === 401) { tokenRef.current = null; localStorage.removeItem(`reparto_token_${empresaId}`); setFase('login') }
    if (!res.ok) throw new Error(d?.error ?? 'Error')
    return d
  }, [empresaId])

  // ── Arranque: resolver empresa/sucursal + módulo + token guardado ──
  useEffect(() => {
    const { empresa, sucursal } = slugsDesdeURL()
    if (!empresa || !sucursal) { setFase('apagado'); return }
    setSucursalId(sucursal)
    const supabase = createClient()
    ;(async () => {
      const { data: emp } = await supabase.from('empresas')
        .select('id, nombre, config:empresa_config(primary_color, logo_url, modulos)')
        .eq('slug', empresa).single()
      if (!emp) { setFase('apagado'); return }
      const cfg = Array.isArray(emp.config) ? emp.config[0] : emp.config
      if ((cfg?.modulos as Record<string, unknown> | null)?.reparto !== true) { setFase('apagado'); return }
      const { data: suc } = await supabase.from('sucursales').select('nombre').eq('id', sucursal).maybeSingle()
      setEmpresaId(emp.id)
      setMarca({ nombre: emp.nombre, color: cfg?.primary_color || '#1E3A5F', logo: cfg?.logo_url ?? null, sucursal: suc?.nombre ?? '' })
      const guardado = localStorage.getItem(`reparto_token_${emp.id}`)
      if (guardado) { tokenRef.current = guardado; setFase('panel') } else setFase('login')
    })()
  }, [])

  // ── Panel: polling de mis pedidos (10s) ──
  useEffect(() => {
    if (fase !== 'panel' || !empresaId) return
    let vivo = true
    const traer = async () => {
      try {
        const d = await api({ accion: 'mis_pedidos' })
        if (!vivo) return
        setCadete(d.cadete)
        setPedidos(d.pedidos ?? [])
      } catch { /* 401 ya redirige; resto: siguiente polling */ }
    }
    traer()
    const i = setInterval(traer, 10000)
    return () => { vivo = false; clearInterval(i) }
  }, [fase, empresaId, api])

  // ── Tracking: watchPosition mientras haya reparto activo ──
  useEffect(() => {
    if (fase !== 'panel' || pedidos.length === 0) return
    if (!navigator.geolocation) { setGps('off'); return }
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setGps('ok')
        const ahora = Date.now()
        if (ahora - ultimaPosRef.current < 9000) return  // throttle cliente (el server re-throttlea)
        ultimaPosRef.current = ahora
        api({ accion: 'posicion', lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {})
      },
      () => setGps('off'),
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    // Wake Lock: que la pantalla no se apague mientras reparte
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let wakeLock: any = null
    ;(navigator as any).wakeLock?.request?.('screen').then((wl: any) => { wakeLock = wl }).catch(() => {})
    return () => { navigator.geolocation.clearWatch(watchId); wakeLock?.release?.().catch(() => {}) }
  }, [fase, pedidos.length, api])

  async function ingresar() {
    if (!nombre.trim() || pin.length !== 4) { setErrorMsg('Completá nombre y PIN de 4 dígitos'); return }
    setEnviando(true); setErrorMsg(null)
    try {
      const res = await fetch('/api/reparto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'login', empresa_id: empresaId, sucursal_id: sucursalId, nombre: nombre.trim(), pin }),
      })
      const d = await res.json()
      if (!res.ok) { setErrorMsg(d?.error ?? 'No se pudo ingresar'); return }
      tokenRef.current = d.token
      localStorage.setItem(`reparto_token_${empresaId}`, d.token)
      setCadete(d.cadete); setPin(''); setFase('panel')
    } catch { setErrorMsg('Sin conexión — probá de nuevo') } finally { setEnviando(false) }
  }

  async function entregar(p: PedidoCadete) {
    if (!confirm(`¿Marcar ENTREGADO el pedido #${p.numero_pedido}?`)) return
    setEntregando(p.id)
    try {
      await api({ accion: 'entregar', pedido_id: p.id })
      setPedidos(prev => prev.filter(x => x.id !== p.id))
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo marcar') } finally { setEntregando(null) }
  }

  function salir() {
    tokenRef.current = null
    localStorage.removeItem(`reparto_token_${empresaId}`)
    setCadete(null); setPedidos([]); setFase('login')
  }

  if (fase === 'cargando') return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <Loader2 className="h-8 w-8 animate-spin text-neutral-300" />
    </div>
  )
  if (fase === 'apagado') return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-3" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-5xl">🛵</p>
      <p className="font-bold text-neutral-700">Reparto no disponible</p>
      <p className="text-neutral-400 text-sm text-center">Este link no está habilitado. Consultá con el local.</p>
    </div>
  )

  if (fase === 'login') return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <p className="text-5xl mb-2">🛵</p>
          <h1 className="text-2xl font-black text-neutral-800">REPARTO</h1>
          <p className="text-neutral-400 text-sm mt-1">{marca.nombre}{marca.sucursal ? ` · ${marca.sucursal}` : ''}</p>
        </div>
        <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wide mb-1">Nombre</label>
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Juan" autoComplete="off"
          className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-lg font-semibold mb-4" />
        <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wide mb-1">PIN</label>
        <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="• • • •"
          type="password" inputMode="numeric" autoComplete="off"
          className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-2xl font-black tracking-[0.5em] text-center mb-4" />
        {errorMsg && <p className="text-sm font-semibold text-red-500 text-center mb-3">{errorMsg}</p>}
        <button onClick={ingresar} disabled={enviando}
          className="w-full py-4 rounded-xl text-white font-black text-lg shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ backgroundColor: marca.color }}>
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : 'INGRESAR'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <div className="bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <p className="font-black text-neutral-800">🛵 Mis entregas</p>
          <p className="text-xs text-neutral-400">Hola {cadete?.nombre ?? ''} · {marca.sucursal || marca.nombre}</p>
        </div>
        <div className="flex items-center gap-2">
          {pedidos.length > 0 && (
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${gps === 'ok' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {gps === 'ok' ? '📡 Compartiendo ubicación' : '⚠️ Activá el GPS'}
            </span>
          )}
          <button onClick={salir} className="text-xs font-semibold text-neutral-400 border border-neutral-200 rounded-lg px-2.5 py-1.5">Salir</button>
        </div>
      </div>

      <div className="px-4 py-4 max-w-sm mx-auto space-y-3">
        {pedidos.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-2">😴</p>
            <p className="font-bold text-neutral-600">Sin entregas asignadas</p>
            <p className="text-neutral-400 text-sm mt-1">Cuando la caja te asigne un pedido, aparece acá solo.</p>
          </div>
        )}
        {pedidos.map(p => {
          const listo = p.estado === 'READY'
          const dd = p.datos_delivery
          const cobra = p.metodo_pago === 'efectivo' && p.pagado !== true
          return (
            <div key={p.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${listo ? 'border-green-200' : 'border-neutral-100'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-black text-xl text-neutral-800">#{p.numero_pedido}</span>
                {listo
                  ? <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-50 text-green-700">✅ LISTO PARA SALIR</span>
                  : <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700">👨‍🍳 PREPARANDO</span>}
              </div>
              {dd && (
                <div className="space-y-1 mb-3">
                  <p className="text-sm font-semibold text-neutral-800">{dd.nombre}</p>
                  <p className="text-sm text-neutral-600">📍 {dd.direccion}{dd.entre_calles ? ` (entre ${dd.entre_calles})` : ''}</p>
                  <a href={`tel:${dd.telefono}`} className="text-sm text-neutral-500 underline block">📞 {dd.telefono}</a>
                </div>
              )}
              {p.notas && <p className="text-xs text-neutral-500 bg-neutral-50 rounded-lg px-3 py-2 mb-3">📝 {p.notas}</p>}
              <p className={`text-sm font-bold mb-3 ${cobra ? 'text-red-600' : 'text-neutral-500'}`}>
                {cobra ? `💵 COBRAR ${fmt(p.total)} EN EFECTIVO` : `✔️ Pagado · ${fmt(p.total)}`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a href={`https://maps.google.com/?q=${encodeURIComponent(`${dd?.direccion ?? ''} ${marca.sucursal}`.trim())}`}
                  target="_blank" rel="noopener noreferrer"
                  className="py-3 rounded-xl border-2 border-neutral-200 text-neutral-700 font-bold text-sm text-center">
                  🗺️ NAVEGAR
                </a>
                <button onClick={() => entregar(p)} disabled={!listo || entregando === p.id}
                  title={listo ? '' : 'Se habilita cuando el local lo marque LISTO'}
                  className="py-3 rounded-xl text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-1"
                  style={{ backgroundColor: listo ? '#16a34a' : '#9ca3af' }}>
                  {entregando === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '✅ ENTREGADO'}
                </button>
              </div>
            </div>
          )
        })}
        <p className="text-center text-[10px] text-neutral-300 pt-2">Mantené la pantalla prendida mientras repartís para compartir tu ubicación · ConeOS</p>
      </div>
    </div>
  )
}
