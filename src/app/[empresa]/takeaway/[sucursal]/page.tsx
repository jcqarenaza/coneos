'use client'

// TAKE AWAY — cuarto canal de venta. Pedido online para retirar en el local.
// Patrón de entrada: MESA-CONTEXTO (slugs públicos, sin dispositivo), gated
// server-side por modulos.takeaway + takeaway_config.activo. Composición:
// componentes de kiosk/delivery reutilizados (KioskCatalogo + carrito y
// confirmación en modo canal='takeaway'). Checkout: SOLO NOMBRE + método.

import { useEffect, useState, useCallback } from 'react'
import KioskCatalogo from '@/components/kiosk/KioskCatalogo'
import KioskCarritoDelivery from '@/components/delivery/KioskCarritoDelivery'
import KioskConfirmacionDelivery from '@/components/delivery/KioskConfirmacionDelivery'
import RegistroVisita from '@/components/RegistroVisita'
import type { EmpresaConfig, Accesorio, ItemCarrito } from '@/app/[empresa]/delivery/[sucursal]/page'

interface Contexto {
  empresa_id: string; sucursal_id: string; nombre: string; sucursal_nombre: string
  config: EmpresaConfig
  takeaway: { abierto: boolean; horarios: { desde: string; hasta: string }[]; mensaje_fuera_horario: string; tolerancia_cierre: number }
  pagos: { acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean }
}

type Paso = 'catalogo' | 'carrito' | 'confirmacion'

function generarId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

export default function TakeawayPage() {
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paso, setPaso] = useState<Paso>('catalogo')
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [accesorios, setAccesorios] = useState<Accesorio[]>([])
  const [pedidoCreado, setPedidoCreado] = useState<{ numero: number; codigo: string } | null>(null)

  useEffect(() => {
    async function init() {
      // Slugs desde el pathname: /{empresa}/takeaway/{sucursal}
      // (mismo criterio que delivery/mesa: los params de client pages son Promise en Next 16)
      const partes = window.location.pathname.split('/').filter(Boolean)
      const empresaSlug = partes[0]
      const sucursalSlug = partes[2]
      if (!empresaSlug || !sucursalSlug) { setError('Link inválido'); setLoading(false); return }

      const res = await fetch(`/api/takeaway/contexto?empresa=${empresaSlug}&sucursal=${sucursalSlug}`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.empresa_id) { setError(data?.error ?? 'No se pudo cargar el take away'); setLoading(false); return }
      setCtx(data)

      // Accesorios: mismo criterio que delivery (grupos "accesorio" con precio)
      const catRes = await fetch(`/api/kiosk/catalogo?empresa_id=${data.empresa_id}&sucursal_id=${data.sucursal_id}`)
      if (catRes.ok) {
        const cat = await catRes.json()
        const grupos = (cat.grupos ?? []) as { id: string; nombre: string }[]
        const grupoIds = new Set(grupos.filter(g => g.nombre.toLowerCase().includes('accesorio')).map(g => g.id))
        setAccesorios(((cat.opciones ?? []) as Accesorio[]).filter(op => grupoIds.has(op.grupo_id) && (op.precio_adicional ?? 0) > 0))
      }
      setLoading(false)
    }
    init()

    // Retorno del checkout de MP: retomar el pedido pendiente (mismo mecanismo que delivery)
    const raw = (() => { try { return sessionStorage.getItem('coneos_mp_pedido') } catch { return null } })()
    if (!raw) return
    let pendiente: { id: string; ts: number } | null = null
    try { pendiente = JSON.parse(raw) } catch {}
    if (!pendiente?.id || Date.now() - (pendiente.ts ?? 0) > 3600000) {
      try { sessionStorage.removeItem('coneos_mp_pedido') } catch {}
      return
    }
    let intentos = 0
    let cancelado = false
    async function verificar() {
      if (cancelado || !pendiente) return
      try {
        const r = await fetch(`/api/pedidos/estado?pedido_id=${pendiente.id}`)
        if (r.ok) {
          const d = await r.json()
          if (d.estado === 'PAID' || d.estado === 'PREPARING' || d.estado === 'READY' || d.estado === 'DELIVERED') {
            try { sessionStorage.removeItem('coneos_mp_pedido') } catch {}
            setPedidoCreado({ numero: d.numero_pedido, codigo: d.codigo_retiro })
            setPaso('confirmacion')
            return
          }
        }
      } catch {}
      intentos++
      if (intentos < 15) setTimeout(verificar, 2000)
      else { try { sessionStorage.removeItem('coneos_mp_pedido') } catch {} }
    }
    verificar()
    return () => { cancelado = true }
  }, [])

  // Carrito persistente CON CLAVE PROPIA DEL CANAL (identidad por canal — orden CTO §5)
  const claveCarrito = ctx ? `coneos_carrito_takeaway_${ctx.sucursal_id}` : null
  const [carritoRestaurado, setCarritoRestaurado] = useState(false)
  useEffect(() => {
    if (!claveCarrito || carritoRestaurado) return
    try {
      const raw = localStorage.getItem(claveCarrito)
      if (raw) {
        const d = JSON.parse(raw)
        if (Array.isArray(d.items) && d.items.length > 0 && Date.now() - (d.ts ?? 0) < 7200000) {
          setCarrito(d.items)
          setPaso('carrito')
        } else localStorage.removeItem(claveCarrito)
      }
    } catch {}
    setCarritoRestaurado(true)
  }, [claveCarrito, carritoRestaurado])
  useEffect(() => {
    if (!claveCarrito || !carritoRestaurado) return
    try {
      if (carrito.length > 0) localStorage.setItem(claveCarrito, JSON.stringify({ items: carrito, ts: Date.now() }))
      else localStorage.removeItem(claveCarrito)
    } catch {}
  }, [carrito, claveCarrito, carritoRestaurado])

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
    setCarrito([]); setPedidoCreado(null); setPaso('catalogo')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
    </div>
  )

  if (error || !ctx) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4 text-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="text-5xl">🥡</div>
      <p className="text-neutral-500">{error ?? 'No se pudo cargar el take away'}</p>
    </div>
  )

  // Fuera de horario: horarios AUTOMÁTICOS desde la config (ordenados) + mensaje
  if (!ctx.takeaway.abierto) {
    const horariosTexto = [...ctx.takeaway.horarios]
      .sort((a, b) => a.desde.localeCompare(b.desde))
      .map(h => `${h.desde} a ${h.hasta}`)
      .join(' y ')
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center gap-3" style={{ backgroundColor: '#faf8f5' }}>
        {ctx.config.logo_url
          ? <img src={ctx.config.logo_url} alt="Logo" className="w-32 h-32 object-contain mb-3" />
          : <div className="text-6xl mb-3">🥡</div>
        }
        <h2 className="text-2xl font-bold text-neutral-800">Take away cerrado</h2>
        {horariosTexto && (
          <p className="text-neutral-700 text-sm font-semibold bg-white border border-neutral-100 rounded-2xl px-5 py-3 shadow-sm">🕗 Nuestro horario: {horariosTexto}</p>
        )}
        <p className="text-neutral-500 text-base max-w-xs">{ctx.takeaway.mensaje_fuera_horario}</p>
      </div>
    )
  }

  const horarioTexto = [...ctx.takeaway.horarios]
    .sort((a, b) => a.desde.localeCompare(b.desde))
    .map(h => `${h.desde} a ${h.hasta}`)
    .join(' y ')
  const pseudoDispositivo = { id: 'takeaway', empresa_id: ctx.empresa_id, sucursal_id: ctx.sucursal_id, empresas: { nombre: ctx.nombre } }

  return (
    <div className="min-h-screen">
      <RegistroVisita empresaId={ctx.empresa_id} sucursalId={ctx.sucursal_id} canal="TAKEAWAY" />
      {paso === 'catalogo' && (
        <KioskCatalogo
          config={ctx.config}
          dispositivo={pseudoDispositivo}
          carrito={carrito}
          onAgregar={agregarAlCarrito}
          onVerCarrito={() => setPaso('carrito')}
          onVolver={() => {}}
        />
      )}
      {paso === 'carrito' && (
        <KioskCarritoDelivery
          config={ctx.config} dispositivo={pseudoDispositivo}
          carrito={carrito} setCarrito={setCarrito}
          accesorios={accesorios}
          costoEnvio={0}
          canal="takeaway"
          onConfirmar={handleConfirmarCarrito}
          onSeguirComprando={() => setPaso('catalogo')}
          onVolver={() => setPaso('catalogo')} />
      )}
      {paso === 'confirmacion' && (
        <KioskConfirmacionDelivery
          config={ctx.config} dispositivo={pseudoDispositivo}
          carrito={carrito} costoEnvio={0}
          canal="takeaway"
          mpPermitido={ctx.pagos.acepta_mp}
          horarioTexto={horarioTexto}
          pedidoCreado={pedidoCreado}
          onPedidoCreado={(num, cod) => { setPedidoCreado({ numero: num, codigo: cod }); try { if (claveCarrito) localStorage.removeItem(claveCarrito) } catch {} }}
          onNuevoPedido={nuevoPedido}
          onVolver={() => setPaso('carrito')} />
      )}
    </div>
  )
}
