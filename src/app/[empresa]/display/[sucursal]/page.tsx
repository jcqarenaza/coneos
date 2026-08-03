'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'

interface Dispositivo {
  id: string
  empresa_id: string
  sucursal_id: string
  empresas: { nombre: string; slug: string }
  sucursales: { nombre: string }
}

interface EmpresaConfig {
  primary_color: string
  secondary_color: string
  logo_url: string | null
}

interface Pedido {
  id: string
  numero_pedido: number
  codigo_retiro: string
  estado: string
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

        const res = await fetch(`/api/kiosk/config?empresa_id=${data.dispositivo.empresa_id}`)
        const cfg = await res.json()
        setConfig(cfg)
        setLoading(false)
      })
      .catch(() => { setError('Error de conexión'); setLoading(false) })
  }, [token])

  // Cargar pedidos listos
  const cargarPedidos = async (disp: Dispositivo) => {
    const supabase = createClient()
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const { data } = await supabase
      .from('pedidos')
      .select('id, numero_pedido, codigo_retiro, estado')
      .eq('empresa_id', disp.empresa_id)
      .eq('sucursal_id', disp.sucursal_id)
      .eq('fecha_pedido', hoy)
      .eq('estado', 'READY')
      .order('numero_pedido', { ascending: true })
    setPedidos((data ?? []) as Pedido[])
  }

  // Realtime
  useEffect(() => {
    if (!dispositivo) return
    cargarPedidos(dispositivo)
    const supabase = createClient()
    const channel = supabase
      .channel(`display-${dispositivo.sucursal_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pedidos',
        filter: `empresa_id=eq.${dispositivo.empresa_id}`,
      }, () => cargarPedidos(dispositivo))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [dispositivo])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-900">
      <Loader2 className="h-12 w-12 animate-spin text-white" />
    </div>
  )

  if (error || !dispositivo || !config) return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-900">
      <p className="text-white/60">{error ?? 'Error de configuración'}</p>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: config.primary_color }}>
      {/* Header */}
      <div className="flex items-center justify-between px-12 py-6 border-b border-white/10">
        <div>
          {config.logo_url ? (
            <div className="bg-white rounded-xl px-5 py-2">
              <Image src={config.logo_url} alt="Logo" width={180} height={65} className="object-contain w-auto" style={{ maxHeight: 52 }} />
            </div>
          ) : (
            <span className="text-white text-2xl font-bold">{dispositivo.empresas?.nombre}</span>
          )}
        </div>
        <div className="text-center">
          <p className="text-white/60 text-sm mb-1">{dispositivo.sucursales?.nombre}</p>
          <p className="text-white text-5xl font-bold tracking-tight">{hora}</p>
        </div>
        <div className="text-right">
          <p className="text-white/40 text-sm">Sistema de pedidos</p>
          <p className="text-white/40 text-xs mt-1">ConeOS</p>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-10">
        {/* Título */}
        <div className="text-center mb-16">
          <h1 className="text-white/80 text-3xl font-medium tracking-widest uppercase mb-3">Pedidos listos</h1>
          <div className="h-1 w-24 mx-auto rounded-full opacity-40" style={{ backgroundColor: config.secondary_color }} />
        </div>

        {pedidos.length === 0 ? (
          <div className="text-center">
            <p className="text-white/30 text-4xl font-light">— Sin pedidos listos —</p>
            <p className="text-white/20 text-xl mt-4">Los pedidos aparecerán aquí cuando estén listos</p>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-8 max-w-5xl">
            {pedidos.map(pedido => (
              <div
                key={pedido.id}
                className="flex flex-col items-center justify-center rounded-3xl shadow-2xl"
                style={{
                  backgroundColor: config.secondary_color,
                  minWidth: 200,
                  minHeight: 200,
                  padding: '2rem',
                }}
              >
                <p className="font-black text-8xl leading-none" style={{ color: config.primary_color }}>
                  #{pedido.numero_pedido}
                </p>
                <p className="font-mono font-bold text-2xl mt-4 opacity-60" style={{ color: config.primary_color }}>
                  {pedido.codigo_retiro}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-12 py-4 border-t border-white/10 flex items-center justify-between">
        <p className="text-white/30 text-sm">Presentá tu código al retirar el pedido</p>
        <p className="text-white/20 text-xs">{pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''} listo{pedidos.length !== 1 ? 's' : ''}</p>
      </div>
    </div>
  )
}
