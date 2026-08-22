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

function estaEnHorario(horarios: { desde: string; hasta: string }[], horaArgentina: string, toleranciaMin = 0): boolean {
  if (!horarios || horarios.length === 0) return true
  const [hh, mm] = horaArgentina.split(':').map(Number)
  const minActual = hh * 60 + mm
  return horarios.some(({ desde, hasta }) => {
    const [dh, dm] = desde.split(':').map(Number)
    const [hah, ham] = hasta.split(':').map(Number)
    const minDesde = dh * 60 + dm
    const minHasta = (hah * 60 + ham + toleranciaMin) % 1440
    const cruzaMedianoche = (hah * 60 + ham) < minDesde || minHasta < minDesde
    if (cruzaMedianoche) {
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

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [horarioActivo, setHorarioActivo] = useState(true)
  const [mensajeFueraHorario, setMensajeFueraHorario] = useState('El delivery no está disponible en este momento. ¡Volvemos pronto!')
  const [mensajePausa, setMensajePausa] = useState('🌧️ Por el mal tiempo el delivery está pausado. ¡Ni bien mejore volvemos a repartir!')
  const [pausado, setPausado] = useState(false)
  const [horariosConfig, setHorariosConfig] = useState<{ desde: string; hasta: string }[]>([])
  const [toleranciaCierre, setToleranciaCierre] = useState(5)

  // La lluvia no se negocia: chequeo cada 60s aunque el cliente esté en medio del pedido
  useEffect(() => {
    if (!dispositivo) return
    const int = setInterval(async () => {
      try {
        const r = await fetch(`/api/hora-argentina?sucursal_id=${dispositivo.sucursal_id}`)
        if (!r.ok) return
        const d = await r.json()
        if (d.delivery_config) {
          setPausado(!!d.delivery_config.pausado)
          if (d.delivery_config.mensaje_pausa) setMensajePausa(d.delivery_config.mensaje_pausa)
        }
      } catch {}
    }, 60000)
    return () => clearInterval(int)
  }, [dispositivo])

  useEffect(() => {
    async function init() {
      // Con token: flujo normal. Sin token (PWA Android/iOS con start_url sin query):
      // fallback por slugs leídos del pathname — /{empresa}/delivery/{sucursal}
      // (No usar params.empresa: en Next 16 los params de client pages son Promise)
      let body: Record<string, string>
      if (token) {
        body = { device_token: token }
      } else {
        const partes = window.location.pathname.split('/').filter(Boolean)
        const empresaSlug = partes[0]
        const sucursalSlug = partes[2]
        if (!empresaSlug || !sucursalSlug) { setError('Dispositivo no configurado'); setLoading(false); return }
        body = { empresa_slug: empresaSlug, sucursal_slug: sucursalSlug, tipo: 'DELIVERY' }
      }

      const res = await fetch('/api/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          setHorariosConfig(horarios)
          setToleranciaCierre(Number(dc.tolerancia_cierre ?? 5))
          if (dc.mensaje_fuera_horario) setMensajeFueraHorario(dc.mensaje_fuera_horario)
          setPausado(!!dc.pausado)
          if (dc.mensaje_pausa) setMensajePausa(dc.mensaje_pausa)
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
          nombre_producto: 'Accesorios',
          nombre_presentacion: accesorio.nombre.replace(/^Toppings?\s+/i, ''),
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

  if (pausado) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center" style={{ backgroundColor: '#faf8f5' }}>
      {config.logo_url
        ? <img src={config.logo_url} alt="Logo" className="w-32 h-32 object-contain mb-6" />
        : <div className="text-6xl mb-6">🌧️</div>
      }
      <h2 className="text-2xl font-bold text-neutral-800 mb-3">Delivery pausado</h2>
      <p className="text-neutral-500 text-base max-w-xs">{mensajePausa}</p>
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
        <KioskInicio config={config} dispositivo={dispositivo}
            onComenzar={(catId) => { setCategoriaInicial(catId); setPaso('catalogo') }} />
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
