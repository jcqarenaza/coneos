'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import KioskInicio from '@/components/kiosk/KioskInicio'
import KioskCatalogo from '@/components/kiosk/KioskCatalogo'
import KioskCarritoDelivery from '@/components/delivery/KioskCarritoDelivery'
import KioskConfirmacionDelivery from '@/components/delivery/KioskConfirmacionDelivery'

export interface EmpresaConfig {
  primary_color: string; secondary_color: string; logo_url: string | null
}
export interface Accesorio {
  id: string
  nombre: string
  emoji: string | null
  imagen_url: string | null
  precio_adicional: number
  grupo_id: string
}

export interface DispositivoKiosk {
  id: string; empresa_id: string; sucursal_id: string
  empresas?: { nombre: string } | null
}
export interface ItemCarrito {
  id: string; presentacion_id: string; nombre_producto: string
  nombre_presentacion: string; precio: number; cantidad: number
  opciones: { opcion_id: string; nombre: string; emoji: string | null; color: string | null }[]
}

type Paso = 'inicio' | 'catalogo' | 'carrito' | 'confirmacion'

function estaEnHorario(horarios: { desde: string; hasta: string }[], horaArgentina: string): boolean {
  if (!horarios || horarios.length === 0) return true
  const [hh, mm] = horaArgentina.split(':').map(Number)
  const minActual = hh * 60 + mm
  return horarios.some(({ desde, hasta }) => {
    const [dh, dm] = desde.split(':').map(Number)
    const [hah, ham] = hasta.split(':').map(Number)
    const minDesde = dh * 60 + dm
    const minHasta = hah * 60 + ham
    if (minHasta < minDesde) {
      return minActual >= minDesde || minActual <= minHasta
    }
    return minActual >= minDesde && minActual <= minHasta
  })
}

function generarId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

export default function DeliveryPage({ params }: { params: { empresa: string; sucursal: string } }) {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [dispositivo, setDispositivo] = useState<DispositivoKiosk | null>(null)
  const [config, setConfig] = useState<EmpresaConfig>({ primary_color: '#1E3A5F', secondary_color: '#F5C842', logo_url: null })
  const [costoEnvio, setCostoEnvio] = useState(4000)
  const [paso, setPaso] = useState<Paso>('inicio')
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [categoriaInicial, setCategoriaInicial] = useState<string | undefined>()
  const [pedidoCreado, setPedidoCreado] = useState<{ numero: number; codigo: string } | null>(null)
  const [accesorios, setAccesorios] = useState<Accesorio[]>([])
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null)
  const [mostrarInstall, setMostrarInstall] = useState(false)

  useEffect(() => {
    function handler(e: Event) {
      e.preventDefault()
      setInstallPrompt(e)
      setMostrarInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [horarioActivo, setHorarioActivo] = useState(true)
  const [mensajeFueraHorario, setMensajeFueraHorario] = useState('El delivery no está disponible en este momento. ¡Volvemos pronto!')

  useEffect(() => {
    async function init() {
      if (!token) { setError('Dispositivo no configurado'); setLoading(false); return }

      // Usar /api/device/verify igual que kiosk — compatible con todos los browsers
      const res = await fetch('/api/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_token: token }),
      })
      const data = await res.json()
      if (!res.ok || !data.dispositivo) { setError(data.error ?? 'Dispositivo no encontrado'); setLoading(false); return }

      const disp = data.dispositivo
      if (disp.tipo !== 'DELIVERY') { setError('Este dispositivo no es de delivery'); setLoading(false); return }

      // Cargar config de empresa
      const supabase = createClient()
      const { data: empData } = await supabase.from('empresas')
        .select('nombre, config:empresa_config(primary_color, secondary_color, logo_url)')
        .eq('id', disp.empresa_id).single()
      const cfg = Array.isArray(empData?.config) ? empData?.config[0] : empData?.config
      if (cfg) setConfig({ primary_color: cfg.primary_color || '#1E3A5F', secondary_color: cfg.secondary_color || '#F5C842', logo_url: cfg.logo_url })

      setDispositivo({ id: disp.id, empresa_id: disp.empresa_id, sucursal_id: disp.sucursal_id, empresas: { nombre: empData?.nombre ?? '' } })

      // Obtener delivery_config, empresa_config y hora Argentina desde el servidor (evita RLS del cliente)
      const horaRes = await fetch(`/api/hora-argentina?sucursal_id=${disp.sucursal_id}&empresa_id=${disp.empresa_id}`)
      if (horaRes.ok) {
        const horaData = await horaRes.json()
        const dc = horaData.delivery_config
        if (dc) {
          setCostoEnvio(Number(dc.costo_envio))
          const horarios = (dc.horarios as { desde: string; hasta: string }[]) ?? []
          setHorarioActivo(dc.activo ? estaEnHorario(horarios, horaData.hora) : false)
          if (dc.mensaje_fuera_horario) setMensajeFueraHorario(dc.mensaje_fuera_horario)
        }
        // Config de empresa
        const emp = horaData.empresa_config
        const cfg = Array.isArray(emp?.config) ? emp?.config[0] : emp?.config
        if (cfg) setConfig({ primary_color: cfg.primary_color || '#1E3A5F', secondary_color: cfg.secondary_color || '#F5C842', logo_url: cfg.logo_url })
      }

      // Cargar accesorios
      const catRes = await fetch(`/api/kiosk/catalogo?empresa_id=${disp.empresa_id}&sucursal_id=${disp.sucursal_id}`)
      if (catRes.ok) {
        const cat = await catRes.json()
        const grupos = (cat.grupos ?? []) as { id: string; nombre: string }[]
        const gruposAccesorios = grupos.filter((g: { id: string; nombre: string }) => g.nombre.toLowerCase().includes('accesorio'))
        const grupoIds = new Set(gruposAccesorios.map((g: { id: string }) => g.id))
        const opcionesAcc = (cat.opciones ?? []).filter((op: Accesorio) => grupoIds.has(op.grupo_id) && (op.precio_adicional ?? 0) > 0)
        setAccesorios(opcionesAcc)
      }
      setLoading(false)
    }
    init()
  }, [params, token])

  const agregarAlCarrito = useCallback((item: Omit<ItemCarrito, 'id'>) => {
    setCarrito(prev => [...prev, { ...item, id: generarId() }])
  }, [])

  function handleConfirmarCarrito(extras: { accesorio: Accesorio; cantidad: number }[]) {
    if (extras.length > 0) {
      setCarrito(prev => [
        ...prev,
        ...extras.map(({ accesorio, cantidad }) => ({
          id: generarId(),
          presentacion_id: '',
          nombre_producto: accesorio.nombre,
          nombre_presentacion: accesorio.nombre,
          precio: accesorio.precio_adicional,
          cantidad,
          opciones: [],
        }))
      ])
    }
    setPaso('confirmacion')
  }

  function nuevoPedido() {
    setCarrito([]); setPedidoCreado(null); setPaso('inicio'); setCategoriaInicial(undefined)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
    </div>
  )

  if (!horarioActivo) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center" style={{ backgroundColor: '#faf8f5' }}>
      {config.logo_url
        ? <img src={config.logo_url} alt="Logo" className="w-32 h-32 object-contain mb-6" />
        : <div className="text-6xl mb-6">🍦</div>
      }
      <h2 className="text-2xl font-bold text-neutral-800 mb-3">Delivery cerrado</h2>
      <p className="text-neutral-500 text-base max-w-xs">{mensajeFueraHorario}</p>
    </div>
  )

  if (error || !dispositivo) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-neutral-400 text-center">{error ?? 'Error al cargar el delivery'}</p>
    </div>
  )

  return (
    <div className="min-h-screen">
      {paso === 'inicio' && (
        <div className="relative">
          <KioskInicio config={config} dispositivo={dispositivo}
            onComenzar={(catId) => { setCategoriaInicial(catId); setPaso('catalogo') }} />
          {mostrarInstall && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
              <button onClick={async () => {
                if (!installPrompt) return
                ;(installPrompt as any).prompt()
                const { outcome } = await (installPrompt as any).userChoice
                if (outcome === 'accepted') setMostrarInstall(false)
              }}
                className="flex items-center gap-2 bg-white/90 backdrop-blur-sm shadow-lg rounded-full px-5 py-2.5 text-sm font-semibold text-neutral-700 border border-neutral-200 active:scale-95 transition-all">
                <span>📲</span> Agregar al inicio
                <span onClick={(e) => { e.stopPropagation(); setMostrarInstall(false) }} className="ml-1 text-neutral-400 text-xs cursor-pointer">✕</span>
              </button>
            </div>
          )}
          {!mostrarInstall && !installPrompt && typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/standalone/i.test(navigator.userAgent) && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-72">
              <div className="bg-white/90 backdrop-blur-sm shadow-lg rounded-2xl px-4 py-3 text-center border border-neutral-200">
                <p className="text-xs text-neutral-500">Para instalar como app en iPhone:</p>
                <p className="text-xs font-semibold text-neutral-700 mt-0.5">Tocá <span className="text-blue-500">Compartir</span> → "Agregar a inicio" en Safari</p>
              </div>
            </div>
          )}
        </div>
      )}
      {paso === 'catalogo' && (
        <KioskCatalogo
          config={config}
          dispositivo={dispositivo}
          carrito={carrito}
          categoriaIdInicial={categoriaInicial}
          onAgregar={agregarAlCarrito}
          onVerCarrito={() => setPaso('carrito')}
          onVolver={() => { setCategoriaInicial(undefined); setPaso('inicio') }}
        />
      )}
      {paso === 'carrito' && (
        <KioskCarritoDelivery
          config={config} dispositivo={dispositivo}
          carrito={carrito} setCarrito={setCarrito}
          accesorios={accesorios}
          costoEnvio={costoEnvio}
          onConfirmar={handleConfirmarCarrito}
          onSeguirComprando={() => setPaso('catalogo')}
          onVolver={() => setPaso('catalogo')} />
      )}
      {paso === 'confirmacion' && (
        <KioskConfirmacionDelivery
          config={config} dispositivo={dispositivo}
          carrito={carrito} costoEnvio={costoEnvio}
          pedidoCreado={pedidoCreado}
          onPedidoCreado={(num, cod) => setPedidoCreado({ numero: num, codigo: cod })}
          onNuevoPedido={nuevoPedido}
          onVolver={() => setPaso('carrito')} />
      )}
    </div>
  )
}
