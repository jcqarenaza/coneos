'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'

interface Dispositivo {
  id: string; empresa_id: string; sucursal_id: string
  empresas: { nombre: string }
  sucursales: { nombre: string }
}

interface EmpresaConfig {
  primary_color: string; secondary_color: string; logo_url: string | null
}

interface Pedido {
  id: string; numero_pedido: number; codigo_retiro: string
}

export default function DisplayPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [dispositivo, setDispositivo] = useState<Dispositivo | null>(null)
  const [config, setConfig] = useState<EmpresaConfig | null>(null)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hora, setHora] = useState('')
  const [empresaId, setEmpresaId] = useState<string | null>(null)
  const [sucursalId, setSucursalId] = useState<string | null>(null)

  useEffect(() => {
    const tick = () => setHora(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [])

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
        setEmpresaId(data.dispositivo.empresa_id)
        setSucursalId(data.dispositivo.sucursal_id)
        const res = await fetch(`/api/kiosk/config?empresa_id=${data.dispositivo.empresa_id}`)
        const cfg = await res.json()
        setConfig(cfg)
        setLoading(false)
      })
      .catch(() => { setError('Error de conexión'); setLoading(false) })
  }, [token])

  const cargarPedidos = useCallback(async () => {
    if (!empresaId || !sucursalId) return
    const supabase = createClient()
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const { data } = await supabase
      .from('pedidos')
      .select('id, numero_pedido, codigo_retiro')
      .eq('empresa_id', empresaId)
      .eq('sucursal_id', sucursalId)
      .eq('fecha_pedido', hoy)
      .eq('estado', 'READY')
      .order('numero_pedido', { ascending: true })
    setPedidos((data ?? []) as Pedido[])
  }, [empresaId, sucursalId])

  // Cargar pedidos cuando tengamos los IDs
  useEffect(() => {
    if (empresaId && sucursalId) cargarPedidos()
  }, [empresaId, sucursalId, cargarPedidos])

  // Realtime — se reconecta cuando cambia cargarPedidos
  useEffect(() => {
    if (!empresaId || !sucursalId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`display-${sucursalId}-${Date.now()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pedidos',
        filter: `empresa_id=eq.${empresaId}`,
      }, () => cargarPedidos())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [empresaId, sucursalId, cargarPedidos])

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
      {/* Header */}
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
              Pedidos listos
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black text-neutral-300 tabular-nums">{hora}</p>
          <p className="text-neutral-300 text-xs mt-1">{dispositivo.sucursales?.nombre}</p>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 flex flex-col items-center justify-center px-10 py-12">
        {pedidos.length === 0 ? (
          <div className="text-center">
            <div className="w-24 h-24 rounded-3xl bg-neutral-100 flex items-center justify-center mx-auto mb-6">
              <span className="text-5xl">🍦</span>
            </div>
            <p className="text-neutral-300 text-2xl font-medium">Sin pedidos listos</p>
            <p className="text-neutral-200 text-base mt-2">Los pedidos aparecerán aquí cuando estén listos</p>
          </div>
        ) : (
          <div className="w-full max-w-5xl">
            <div className="flex flex-wrap justify-center gap-6">
              {pedidos.map(pedido => (
                <div key={pedido.id} className="flex flex-col items-center justify-center bg-white rounded-3xl shadow-md border border-neutral-100"
                  style={{ minWidth: 220, minHeight: 220, padding: '2.5rem' }}>
                  <p className="font-black text-neutral-200 text-lg mb-1 tracking-wide">PEDIDO</p>
                  <p className="font-black leading-none mb-4" style={{ fontSize: '7rem', color: config.primary_color }}>
                    #{pedido.numero_pedido}
                  </p>
                  <div className="h-px w-16 rounded mb-4 bg-neutral-100" />
                  <p className="text-xs font-semibold tracking-widest uppercase text-neutral-300 mb-1">Código</p>
                  <p className="font-black text-3xl tracking-[0.25em] font-mono" style={{ color: config.secondary_color }}>
                    {pedido.codigo_retiro}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-neutral-100 px-10 py-4 flex items-center justify-between">
        <p className="text-neutral-300 text-sm">Presentá tu código al retirar tu pedido</p>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <p className="text-neutral-300 text-xs">
            {pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''} listo{pedidos.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
