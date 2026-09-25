'use client'

// TAKE AWAY — cuarto canal de venta. Pedido online para retirar en el local.
// Patrón de entrada: MESA-CONTEXTO (slugs públicos, sin dispositivo), gated
// server-side por modulos.takeaway + takeaway_config.activo. Composición:
// componentes de kiosk/delivery reutilizados (KioskCatalogo + carrito y
// confirmación en modo canal='takeaway'). Checkout: SOLO NOMBRE + método.
// CICLO COSTO TA: costo_servicio del contexto pasa como costoEnvio a los
// componentes compartidos (espejo exacto de delivery; 0 = inercia total).

import { useEffect, useState, useCallback } from 'react'
import KioskCatalogo from '@/components/kiosk/KioskCatalogo'
import KioskCarritoDelivery from '@/components/delivery/KioskCarritoDelivery'
import KioskConfirmacionDelivery from '@/components/delivery/KioskConfirmacionDelivery'
import RegistroVisita from '@/components/RegistroVisita'
import type { EmpresaConfig, Accesorio, ItemCarrito } from '@/app/[empresa]/delivery/[sucursal]/page'

interface Contexto {
  empresa_id: string; sucursal_id: string; nombre: string; sucursal_nombre: string; direccion_retiro?: string | null
  config: EmpresaConfig
  takeaway: { abierto: boolean; anticipado?: boolean; abre_a_las?: string | null; horarios: { desde: string; hasta: string }[]; mensaje_fuera_horario: string; tolerancia_cierre: number; costo_servicio?: number; slots_retiro?: { iso: string; label: string }[] }
  pagos: { acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean; cbu_transferencia: string | null; titular_transferencia: string | null }
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
  const [verificandoMp, setVerificandoMp] = useState(false)
  // Vuelta al selector: solo si el cliente LLEGÓ desde la App (anti-loop ya existente)
  const [vinoDeApp, setVinoDeApp] = useState(false)
  useEffect(() => { try { setVinoDeApp(new URLSearchParams(window.location.search).get('desde') === 'app') } catch {} }, [])

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
    let pendiente: { id: string; ts: number; tipo?: string } | null = null
    try {
      const spMp = new URLSearchParams(window.location.search)
      const extRef = spMp.get('external_reference')
      if (extRef) {
        pendiente = { id: extRef, ts: Date.now() }
        const url = new URL(window.location.href)
        for (const k of ['collection_id', 'collection_status', 'payment_id', 'status', 'external_reference', 'payment_type', 'merchant_order_id', 'preference_id', 'site_id', 'processing_mode', 'merchant_account_id']) url.searchParams.delete(k)
        window.history.replaceState({}, '', url.toString())
      }
    } catch {}
    if (!pendiente) {
      const raw = (() => { try { return (localStorage.getItem('coneos_mp_pedido') ?? sessionStorage.getItem('coneos_mp_pedido')) } catch { return null } })()
      if (!raw) return
      try { pendiente = JSON.parse(raw) } catch {}
      if (pendiente?.tipo && pendiente.tipo !== 'takeaway') return // pendiente de otra vidriera
    }
    if (!pendiente?.id || Date.now() - (pendiente.ts ?? 0) > 3600000) {
      try { localStorage.removeItem('coneos_mp_pedido'); sessionStorage.removeItem('coneos_mp_pedido') } catch {}
      return
    }
    setVerificandoMp(true)
    let intentos = 0
    let cancelado = false
    async function verificar() {
      if (cancelado || !pendiente) return
      try {
        const r = await fetch(`/api/pedidos/estado?pedido_id=${pendiente.id}`)
        if (r.ok) {
          const d = await r.json()
          if (d.estado === 'PAID' || d.estado === 'PREPARING' || d.estado === 'READY' || d.estado === 'DELIVERED') {
            try { localStorage.removeItem('coneos_mp_pedido'); sessionStorage.removeItem('coneos_mp_pedido') } catch {}
            setPedidoCreado({ numero: d.numero_pedido, codigo: d.codigo_retiro })
            setCarrito([])
            setPaso('confirmacion')
            setVerificandoMp(false)
            return
          }
        }
      } catch {}
      intentos++
      if (intentos < 15) setTimeout(verificar, 2000)
      else { setVerificandoMp(false); try { localStorage.removeItem('coneos_mp_pedido'); sessionStorage.removeItem('coneos_mp_pedido') } catch {} }
    }
    verificar()
    return () => { cancelado = true }
  }, [])


  // Despertar de pestaña (pago hecho en la APP de MP y vuelta con "atrás"):
  // el bfcache revive la página sin recargar — verificamos el pendiente
  // cada vez que la vidriera vuelve a estar visible.
  useEffect(() => {
    const despertar = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      let pend: { id?: string; ts?: number; tipo?: string } | null = null
      try { pend = JSON.parse(localStorage.getItem('coneos_mp_pedido') ?? 'null') } catch {}
      if (!pend?.id || (pend.tipo && pend.tipo !== 'takeaway')) return
      if (Date.now() - (pend.ts ?? 0) > 3600000) return
      fetch(`/api/pedidos/estado?pedido_id=${pend.id}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (d && (d.estado === 'PAID' || d.estado === 'PREPARING' || d.estado === 'READY' || d.estado === 'DELIVERED')) {
            try { localStorage.removeItem('coneos_mp_pedido'); sessionStorage.removeItem('coneos_mp_pedido') } catch {}
            setPedidoCreado({ numero: d.numero_pedido, codigo: d.codigo_retiro })
            setCarrito([])
            setPaso('confirmacion')
          }
        })
        .catch(() => {})
    }
    window.addEventListener('pageshow', despertar)
    document.addEventListener('visibilitychange', despertar)
    return () => { window.removeEventListener('pageshow', despertar); document.removeEventListener('visibilitychange', despertar) }
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


  // ══ 9d — RE-PRECIO DEL CARRITO (orden CTO: el server ya manda; el front
  // se pone al día). Contra el catálogo FRESCO: presentación + adicionales;
  // lo que ya no existe se quita con aviso. Cero server tocado.
  const [avisoPrecios, setAvisoPrecios] = useState(false)
  const [itemsQuitados, setItemsQuitados] = useState(0)
  async function repreciarCarrito() {
    try {
      const r = await fetch(`/api/kiosk/catalogo?empresa_id=${ctx!.empresa_id}&sucursal_id=${ctx!.sucursal_id}`)
      if (!r.ok) throw new Error('catalogo')
      const cat = await r.json()
      const precioPres = new Map<string, number>(((cat.presentaciones ?? []) as { id: string; precio: number }[]).map(p => [p.id, Number(p.precio)]))
      const precioOp = new Map<string, number>(((cat.opciones ?? []) as { id: string; precio_adicional: number | null }[]).map(o => [o.id, Number(o.precio_adicional ?? 0)]))
      const opcionesFrescas = (cat.opciones ?? []) as { nombre: string; precio_adicional: number | null }[]
      let quitados = 0
      const nuevo: ItemCarrito[] = []
      for (const item of carrito) {
        if (!item.presentacion_id) {
          // accesorio (sin presentación): matchear por nombre contra las opciones frescas
          const acc = opcionesFrescas.find(o => o.nombre.replace(/^Toppings?\s+/i, '') === item.nombre_presentacion)
          if (!acc || !(Number(acc.precio_adicional ?? 0) > 0)) { quitados++; continue }
          nuevo.push({ ...item, precio: Number(acc.precio_adicional) })
          continue
        }
        const base = precioPres.get(item.presentacion_id)
        if (base === undefined) { quitados++; continue } // la presentación ya no está a la venta
        const adicionales = item.opciones.reduce((s, op) => s + (precioOp.get(op.opcion_id) ?? 0), 0)
        nuevo.push({ ...item, precio: base + adicionales })
      }
      setCarrito(nuevo)
      setItemsQuitados(quitados)
    } catch {
      setItemsQuitados(0) // sin catálogo: igual volvemos al carrito con el aviso
    }
    setAvisoPrecios(true)
    setPaso('carrito')
  }

  function nuevoPedido() {
    setCarrito([]); setPedidoCreado(null); setPaso('catalogo'); setAvisoPrecios(false); setItemsQuitados(0)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
    </div>
  )

  if (verificandoMp && !pedidoCreado) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4 text-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-10 h-10 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin" />
      <p className="text-lg font-black text-neutral-800">Verificando tu pago…</p>
      <p className="text-sm text-neutral-400 max-w-xs">Estamos confirmando con Mercado Pago. Esto tarda unos segundos.</p>
    </div>
  )


  if (error || !ctx) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4 text-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="text-5xl">🥡</div>
      <p className="text-neutral-500">{error ?? 'No se pudo cargar el take away'}</p>
    </div>
  )

  // Fuera de horario: horarios AUTOMÁTICOS desde la config (ordenados) + mensaje
  // ANTICIPADO: cerrado pero con slots de hoy → la vidriera sigue (banner abajo)
  if (!ctx.takeaway.abierto && !ctx.takeaway.anticipado) {
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
  // Espejo del costo de envío: el servicio de retiro del contexto (0 = como siempre)
  const costoServicio = Number(ctx.takeaway.costo_servicio ?? 0)

  return (
    <div className="min-h-screen">
      <RegistroVisita empresaId={ctx.empresa_id} sucursalId={ctx.sucursal_id} canal="TAKEAWAY" />
      {vinoDeApp && paso === 'catalogo' && carrito.length === 0 && (
        <a href={`/${window.location.pathname.split('/').filter(Boolean)[0]}/pedidos/${window.location.pathname.split('/').filter(Boolean)[2]}`}
          className="fixed bottom-4 left-4 z-30 bg-white/95 backdrop-blur border border-neutral-200 shadow-md rounded-full px-3.5 py-2 text-xs font-bold text-neutral-500 active:scale-95 transition-transform">
          ← Ver otras opciones
        </a>
      )}

      {ctx.takeaway.anticipado && (
        <div className="sticky top-0 z-20 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center">
          <p className="text-xs font-bold text-amber-700">🕗 Abrimos a las {ctx.takeaway.abre_a_las} — pedí ahora y tu pedido será de los primeros. Retiro desde las {ctx.takeaway.abre_a_las}.</p>
        </div>
      )}
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
      {paso === 'carrito' && (<>
        {avisoPrecios && (
          <div className="max-w-lg mx-auto mt-4 px-4">
            <div className="bg-amber-50 border border-amber-300 text-amber-800 text-sm font-semibold rounded-2xl px-4 py-3 text-center shadow-sm">
              ⚠️ Los precios se actualizaron — revisá tu pedido antes de confirmar.
              {itemsQuitados > 0 ? ` ${itemsQuitados === 1 ? 'Un artículo ya no está disponible y se quitó.' : `${itemsQuitados} artículos ya no están disponibles y se quitaron.`}` : ''}
            </div>
          </div>
        )}
        <KioskCarritoDelivery
          config={ctx.config} dispositivo={pseudoDispositivo}
          carrito={carrito} setCarrito={setCarrito}
          accesorios={accesorios}
          costoEnvio={costoServicio}
          canal="takeaway"
          onConfirmar={extras => { setAvisoPrecios(false); handleConfirmarCarrito(extras) }}
          onSeguirComprando={() => setPaso('catalogo')}
          onVolver={() => setPaso('catalogo')} />
      </>)}
      {paso === 'confirmacion' && (
        <KioskConfirmacionDelivery
          config={ctx.config} dispositivo={pseudoDispositivo}
          carrito={carrito} costoEnvio={costoServicio}
          canal="takeaway"
          mpPermitido={ctx.pagos.acepta_mp}
          // F-C: pagosIniciales ya NO se inyecta del contexto (venía sin canal
          // y resucitaba medios apagados) — el checkout consulta
          // /api/kiosk/pagos?canal=TAKEAWAY, que resuelve por canal (Capa 1)
          pagosIniciales={null}
          horarioTexto={horarioTexto}
          direccionRetiro={ctx.direccion_retiro ?? null}
          slotsRetiro={ctx.takeaway.slots_retiro ?? []}
          pedidoCreado={pedidoCreado}
          onPedidoCreado={(num, cod) => { setPedidoCreado({ numero: num, codigo: cod }); try { if (claveCarrito) localStorage.removeItem(claveCarrito) } catch {} }}
          onNuevoPedido={nuevoPedido}
          onPreciosDesactualizados={repreciarCarrito}
          onVolver={() => setPaso('carrito')} />
      )}
    </div>
  )
}
