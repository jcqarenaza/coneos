'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import KioskInicio from '@/components/kiosk/KioskInicio'
import KioskCatalogo from '@/components/kiosk/KioskCatalogo'
import KioskCarrito from '@/components/kiosk/KioskCarrito'
import KioskConfirmacion from '@/components/kiosk/KioskConfirmacion'
import LatidoDispositivo from '@/components/LatidoDispositivo'

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

export interface Accesorio {
  id: string
  nombre: string
  emoji: string | null
  imagen_url: string | null
  precio_adicional: number
  grupo_id: string
}

export type PasoKiosk = 'inicio' | 'catalogo' | 'carrito' | 'confirmacion'

export default function KioskPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [dispositivo, setDispositivo] = useState<DispositivoKiosk | null>(null)
  const [config, setConfig] = useState<EmpresaConfig | null>(null)
  const [paso, setPaso] = useState<PasoKiosk>('inicio')
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [accesorios, setAccesorios] = useState<Accesorio[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pedidoCreado, setPedidoCreado] = useState<{ numero: number; codigo: string } | null>(null)
  const [categoriaInicial, setCategoriaInicial] = useState<string | undefined>(undefined)
  // Ciclo 3: gate por horario del negocio (server-side; re-chequeo por minuto
  // para que el tótem cierre y reviva solo, sin manos)
  const [horarioNegocio, setHorarioNegocio] = useState<{ abierto: boolean; horarios: { desde: string; hasta: string }[]; mensaje: string } | null>(null)
  const [catalogoKey, setCatalogoKey] = useState(0)

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
        const [cfgRes, catRes] = await Promise.all([
          fetch(`/api/kiosk/config?empresa_id=${data.dispositivo.empresa_id}`),
          fetch(`/api/kiosk/catalogo?empresa_id=${data.dispositivo.empresa_id}&sucursal_id=${data.dispositivo.sucursal_id}`)
        ])
        const cfg = await cfgRes.json()
        const cat = await catRes.json()
        setConfig(cfg)
        // Filtrar solo opciones de grupos de accesorios
        const grupos = (cat.grupos ?? []) as { id: string; nombre: string }[]
        const gruposAccesorios = grupos.filter((g: { id: string; nombre: string }) => g.nombre.toLowerCase().includes('accesorio'))
        const grupoIds = new Set(gruposAccesorios.map((g: { id: string }) => g.id))
        const opcionesAcc = (cat.opciones ?? []).filter((op: Accesorio) => grupoIds.has(op.grupo_id) && (op.precio_adicional ?? 0) > 0)
        setAccesorios(opcionesAcc)
      })
      .catch(() => setError('Error de conexión'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!dispositivo) return
    let vivo = true
    async function chequear() {
      try {
        const r = await fetch(`/api/kiosk/horario?sucursal_id=${dispositivo!.sucursal_id}`)
        if (r.ok && vivo) setHorarioNegocio(await r.json())
      } catch {}
    }
    chequear()
    const int = setInterval(chequear, 60000)
    return () => { vivo = false; clearInterval(int) }
  }, [dispositivo])

  useEffect(() => {
    if (!config) return
    document.documentElement.style.setProperty('--brand-primary', config.primary_color)
    document.documentElement.style.setProperty('--brand-secondary', config.secondary_color)
  }, [config])

  function agregarItem(item: Omit<ItemCarrito, 'id'>) {
    setCarrito(prev => [...prev, { ...item, id: Math.random().toString(36).substring(2) + Date.now().toString(36) }])
  }

  function quitarItem(id: string) {
    setCarrito(prev => prev.filter(i => i.id !== id))
  }

  function limpiarCarrito() {
    setCarrito([])
    setPedidoCreado(null)
    setCategoriaInicial(undefined)
    setCatalogoKey(k => k + 1)
    setPaso('inicio')
  }

  function handleComenzar(categoriaId?: string) {
    setCategoriaInicial(categoriaId)
    setPaso('catalogo')
  }

  function handleConfirmarAccesorios(extras: { accesorio: Accesorio; cantidad: number }[]) {
    if (extras.length > 0) {
      setCarrito(prev => [
        ...prev,
        ...extras.map(({ accesorio, cantidad }) => ({
          id: Math.random().toString(36).substring(2) + Date.now().toString(36),
          presentacion_id: '', // null-safe — la FK acepta null tras el alter
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

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1a2744 0%, #2d3f6b 100%)' }}>
      <div className="text-center">
        <Loader2 className="h-10 w-10 animate-spin text-white/60 mx-auto mb-3" />
        <p className="text-white/40 text-sm">Cargando...</p>
      </div>
    </div>
  )

  if (error || !dispositivo || !config) return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-center bg-white rounded-2xl p-8 shadow-sm max-w-sm mx-4">
        <p className="text-2xl mb-3">😔</p>
        <p className="text-neutral-700 font-medium mb-1">No pudimos conectar</p>
        <p className="text-neutral-400 text-sm">{error ?? 'Error de configuración'}</p>
      </div>
    </div>
  )

  // Gate del negocio: fuera de horario, el tótem muestra el cerrado con la
  // marca y los horarios — y revive solo cuando el reloj lo habilita
  if (horarioNegocio && !horarioNegocio.abierto) {
    const horariosTexto = [...horarioNegocio.horarios].sort((a, b) => a.desde.localeCompare(b.desde)).map(h => `${h.desde} a ${h.hasta}`).join(' y ')
    return (
      <div className="min-h-screen select-none flex flex-col items-center justify-center px-8 text-center gap-4" style={{ backgroundColor: '#faf8f5' }}>
        <LatidoDispositivo empresaId={dispositivo.empresa_id} sucursalId={dispositivo.sucursal_id} dispositivoId={dispositivo.id} tipo="KIOSK" />
        {config.logo_url
          ? <img src={config.logo_url} alt="Logo" className="w-36 h-36 object-contain" />
          : null}
        <h2 className="text-3xl font-black text-neutral-800">Estamos cerrados</h2>
        {horariosTexto && (
          <p className="text-neutral-700 text-base font-semibold bg-white border border-neutral-100 rounded-2xl px-6 py-4 shadow-sm">🕗 Nuestro horario: {horariosTexto}</p>
        )}
        <p className="text-neutral-500 text-lg max-w-sm">{horarioNegocio.mensaje}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen select-none" style={{ backgroundColor: '#faf8f5' }}>
      <LatidoDispositivo empresaId={dispositivo.empresa_id} sucursalId={dispositivo.sucursal_id} dispositivoId={dispositivo.id} tipo="KIOSK" />
      {paso === 'inicio' && (
        <KioskInicio config={config} dispositivo={dispositivo} onComenzar={handleComenzar} />
      )}
      {paso === 'catalogo' && (
        <KioskCatalogo
          key={`${categoriaInicial ?? 'all'}-${catalogoKey}`}
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
          dispositivo={dispositivo}
          carrito={carrito}
          accesorios={accesorios}
          onQuitar={quitarItem}
          onConfirmar={handleConfirmarAccesorios}
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
          onVolver={() => setPaso('carrito')}
        />
      )}
    </div>
  )
}
