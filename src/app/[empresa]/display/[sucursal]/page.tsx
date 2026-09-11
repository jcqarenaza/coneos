'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import LatidoDispositivo from '@/components/LatidoDispositivo'

interface Dispositivo {
  id: string; empresa_id: string; sucursal_id: string
  empresas: { nombre: string }
  sucursales: { nombre: string }
}
interface EmpresaConfig { primary_color: string; secondary_color: string; logo_url: string | null }
interface Pedido { id: string; numero_pedido: number; codigo_retiro: string; tipo_pedido?: string }

// DISPLAY V2: íconos por canal público (mesa queda excluida server-side —
// se entrega en la mesa, no en el mostrador)
const CANAL: Record<string, { emoji: string; label: string }> = {
  kiosk: { emoji: '🛒', label: 'MOSTRADOR' },
  delivery: { emoji: '🛵', label: 'DELIVERY' },
  takeaway: { emoji: '🥡', label: 'TAKE AWAY' },
}

export default function DisplayPage() {
  // Wake Lock: mientras esta pantalla de operación esté abierta, la pantalla
  // del dispositivo NO se suspende (si se suspendiera, el navegador congela el
  // polling y el sonido/actualización de pedidos llega tarde).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    async function pedirWakeLock() {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
        if (nav.wakeLock) lock = await nav.wakeLock.request('screen')
      } catch { /* sin soporte o denegado: seguimos sin lock */ }
    }
    pedirWakeLock()
    const onVis = () => { if (document.visibilityState === 'visible') pedirWakeLock() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}) }
  }, [])
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [dispositivo, setDispositivo] = useState<Dispositivo | null>(null)
  const [config, setConfig] = useState<EmpresaConfig | null>(null)
  const [preparando, setPreparando] = useState<Pedido[]>([])
  const [listos, setListos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hora, setHora] = useState('')

  // Refs para evitar closure stale en el handler de Realtime
  const empresaIdRef = useRef<string | null>(null)
  const sucursalIdRef = useRef<string | null>(null)  const dispositivoIdRef = useRef<string | null>(null)

  useEffect(() => {
    const tick = () => setHora(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [])

  async function cargarPedidos() {
    const dispId = dispositivoIdRef.current
    if (!dispId) return
    // Server-side por dispositivo: el display no tiene sesión de auth propia
    const res = await fetch('/api/operacion/consulta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispositivo_id: dispId, accion: 'display' }),
    })
    const d = await res.json().catch(() => null)
    if (!d) return
    setPreparando(d.preparando ?? [])
    setListos(d.listos ?? d.pedidos ?? [])
  }

  useEffect(() => {
    if (!token) { setError('Token no válido'); setLoading(false); return }
    fetch('/api/device/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_token: token }),
    })
      .then(r => r.json())
      .then(async data => {
        if (data.error) { setError(data.error); return }
        setDispositivo(data.dispositivo)

        // Guardar en refs antes de suscribir Realtime
        empresaIdRef.current = data.dispositivo.empresa_id
        sucursalIdRef.current = data.dispositivo.sucursal_id        dispositivoIdRef.current = data.dispositivo.id

        const res = await fetch(`/api/kiosk/config?empresa_id=${data.dispositivo.empresa_id}`)
        const cfg = await res.json()
        setConfig(cfg)
        setLoading(false)

        // Cargar pedidos iniciales
        await cargarPedidos()

        // Suscribir Realtime — una sola vez, usando refs para siempre tener los IDs actuales
        const supabase = createClient()
        supabase
          .channel(`display-${data.dispositivo.sucursal_id}`)
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'pedidos',
            filter: `empresa_id=eq.${data.dispositivo.empresa_id}`,
          }, () => cargarPedidos())
          .subscribe()
        // Respaldo sin sesión (Realtime no emite con RLS): refresco cada 15s
        setInterval(() => cargarPedidos(), 7000)
      })
      .catch(() => { setError('Error de conexión'); setLoading(false) })
  }, [token])

  if (loading) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-neutral-200" />
    </div>
  )

  if (error || !dispositivo || !config) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <p className="text-neutral-400">{error ?? 'Error de configuración'}</p>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <LatidoDispositivo empresaId={dispositivo.empresa_id} sucursalId={dispositivo.sucursal_id} dispositivoId={dispositivo.id} tipo="DISPLAY" />
      <div className="bg-white border-b border-neutral-100 shadow-sm px-10 py-5 flex items-center justify-between">
        <div>
          {config.logo_url
            ? <Image src={config.logo_url} alt="Logo" width={200} height={72} className="object-contain" style={{ maxHeight: 68 }} />
            : <span className="text-2xl font-bold text-neutral-800">{dispositivo.empresas?.nombre}</span>}
        </div>
        <div className="text-center">
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl" style={{ backgroundColor: `${config.primary_color}10` }}>
            <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: config.primary_color }} />
            <span className="text-sm font-bold tracking-widest uppercase" style={{ color: config.primary_color }}>
              En preparación y para retirar
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black text-neutral-300 tabular-nums">{hora}</p>
          <p className="text-neutral-300 text-xs mt-1">{dispositivo.sucursales?.nombre}</p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-0 px-8 py-8 min-h-0">
        {/* 🔥 EN PREPARACIÓN */}
        <div className="flex flex-col min-h-0 border-r border-neutral-200 pr-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl">🔥</span>
            <h2 className="text-2xl font-black tracking-widest text-neutral-400 uppercase">En preparación</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            {preparando.length === 0 ? (
              <p className="text-neutral-200 text-xl font-medium mt-10">Sin pedidos en preparación</p>
            ) : (
              <div className="flex flex-wrap content-start gap-4">
                {preparando.map(p => {
                  const c = CANAL[p.tipo_pedido ?? 'kiosk'] ?? CANAL.kiosk
                  return (
                    <div key={p.id} className="flex flex-col items-center bg-white rounded-2xl shadow-sm border border-neutral-100 px-6 py-4" style={{ minWidth: 150 }}>
                      <p className="font-black leading-none text-neutral-700" style={{ fontSize: '3.2rem' }}>#{p.numero_pedido}</p>
                      <p className="text-xs font-black tracking-wider text-neutral-400 mt-2">{c.emoji} {c.label}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        {/* ✅ PARA RETIRAR */}
        <div className="flex flex-col min-h-0 pl-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl">✅</span>
            <h2 className="text-2xl font-black tracking-widest uppercase" style={{ color: config.primary_color }}>Para retirar</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            {listos.length === 0 ? (
              <p className="text-neutral-200 text-xl font-medium mt-10">Sin pedidos listos</p>
            ) : (
              <div className="flex flex-wrap content-start gap-5">
                {listos.map(p => {
                  const c = CANAL[p.tipo_pedido ?? 'kiosk'] ?? CANAL.kiosk
                  return (
                    <div key={p.id} className="flex flex-col items-center bg-white rounded-3xl shadow-md border-2 px-8 py-6" style={{ minWidth: 190, borderColor: `${config.primary_color}30` }}>
                      <p className="font-black leading-none" style={{ fontSize: '4.5rem', color: config.primary_color }}>#{p.numero_pedido}</p>
                      <p className="text-sm font-black tracking-wider text-neutral-500 mt-3">{c.emoji} {c.label}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border-t border-neutral-100 px-10 py-4 flex items-center justify-between">
        <p className="text-neutral-300 text-sm">Presentá tu código al retirar tu pedido</p>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <p className="text-neutral-300 text-xs">
            {listos.length} para retirar · {preparando.length} en preparación
          </p>
        </div>
      </div>
    </div>
  )
}
