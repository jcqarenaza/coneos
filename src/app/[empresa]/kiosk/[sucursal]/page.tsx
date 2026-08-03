'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import KioskInicio from '@/components/kiosk/KioskInicio'
import KioskCatalogo from '@/components/kiosk/KioskCatalogo'
import KioskCarrito from '@/components/kiosk/KioskCarrito'
import KioskConfirmacion from '@/components/kiosk/KioskConfirmacion'

export interface EmpresaConfig {
  primary_color: string
  secondary_color: string
  logo_url: string | null
  texto_bienvenida: string
}

export interface DispositivoKiosk {
  id: string
  empresa_id: string
  sucursal_id: string
  sucursales: { nombre: string; slug: string }
  empresas: { nombre: string; slug: string }
}

export interface ItemCarrito {
  id: string
  presentacion_id: string
  nombre_producto: string
  nombre_presentacion: string
  precio: number
  cantidad: number
  opciones: { opcion_id: string; nombre: string; emoji: string | null; color: string | null }[]
}

export type PasoKiosk = 'inicio' | 'catalogo' | 'carrito' | 'confirmacion'

export default function KioskPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [dispositivo, setDispositivo] = useState<DispositivoKiosk | null>(null)
  const [config, setConfig] = useState<EmpresaConfig | null>(null)
  const [paso, setPaso] = useState<PasoKiosk>('inicio')
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pedidoCreado, setPedidoCreado] = useState<{ numero: number; codigo: string } | null>(null)
  const [categoriaInicial, setCategoriaInicial] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!token) { setError('Dispositivo no configurado'); setLoading(false); return }
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
      })
      .catch(() => setError('Error de conexión'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!config) return
    document.documentElement.style.setProperty('--brand-primary', config.primary_color)
    document.documentElement.style.setProperty('--brand-secondary', config.secondary_color)
  }, [config])

  function agregarItem(item: Omit<ItemCarrito, 'id'>) {
    setCarrito(prev => [...prev, { ...item, id: crypto.randomUUID() }])
  }

  function quitarItem(id: string) {
    setCarrito(prev => prev.filter(i => i.id !== id))
  }

  function limpiarCarrito() {
    setCarrito([])
    setPedidoCreado(null)
    setCategoriaInicial(undefined)
    setPaso('inicio')
  }

  function handleComenzar(categoriaId?: string) {
    setCategoriaInicial(categoriaId)
    setPaso('catalogo')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#D42B2B' }}>
      <Loader2 className="h-10 w-10 animate-spin text-white" />
    </div>
  )

  if (error || !dispositivo || !config) return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100">
      <p className="text-neutral-600 text-lg">{error ?? 'Error de configuración'}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#fdf8f4] flex flex-col select-none">
      {paso === 'inicio' && (
        <KioskInicio config={config} dispositivo={dispositivo} onComenzar={handleComenzar} />
      )}
      {paso === 'catalogo' && (
        <KioskCatalogo
          key={categoriaInicial ?? 'all'}
          dispositivo={dispositivo}
          config={config}
          carrito={carrito}
          categoriaIdInicial={categoriaInicial}
          onAgregar={agregarItem}
          onVerCarrito={() => setPaso('carrito')}
          onVolver={() => { setCategoriaInicial(undefined); setPaso('inicio') }}
        />
      )}
      {paso === 'carrito' && (
        <KioskCarrito
          config={config}
          carrito={carrito}
          onQuitar={quitarItem}
          onConfirmar={() => setPaso('confirmacion')}
          onSeguirComprando={() => setPaso('catalogo')}
          onVaciar={limpiarCarrito}
        />
      )}
      {paso === 'confirmacion' && (
        <KioskConfirmacion
          config={config}
          dispositivo={dispositivo}
          carrito={carrito}
          onPedidoCreado={(numero, codigo) => { setPedidoCreado({ numero, codigo }); setCarrito([]) }}
          pedidoCreado={pedidoCreado}
          onNuevoPedido={limpiarCarrito}
        />
      )}
    </div>
  )
}
