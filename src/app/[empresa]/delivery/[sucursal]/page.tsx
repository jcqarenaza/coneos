'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import KioskInicio from '@/components/kiosk/KioskInicio'
import KioskCatalogo from '@/components/kiosk/KioskCatalogo'
import KioskCarritoDelivery from '@/components/delivery/KioskCarritoDelivery'
import KioskConfirmacionDelivery from '@/components/delivery/KioskConfirmacionDelivery'
import { generarSlots } from '@/lib/takeaway/slots'
import RegistroVisita from '@/components/RegistroVisita'

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
  const [envioAlCadete, setEnvioAlCadete] = useState(false)
  const [paso, setPaso] = useState<Paso>('catalogo')
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [categoriaInicial, setCategoriaInicial] = useState<string | undefined>()
  const [pedidoCreado, setPedidoCreado] = useState<{ numero: number; codigo: string } | null>(null)
  const [verificandoMp, setVerificandoMp] = useState(false)
  const [accesorios, setAccesorios] = useState<Accesorio[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [horarioActivo, setHorarioActivo] = useState(true)
  const [mensajeFueraHorario, setMensajeFueraHorario] = useState('El delivery no está disponible en este momento. ¡Volvemos pronto!')
  const [mensajePausa, setMensajePausa] = useState('🌧️ Por el mal tiempo el delivery está pausado. ¡Ni bien mejore volvemos a repartir!')
  const [pausado, setPausado] = useState(false)
  const [horariosConfig, setHorariosConfig] = useState<{ desde: string; hasta: string }[]>([])
  // DELIVERY PROGRAMADO V1: franjas de entrega (llave del comercio; misma
  // fuente de slots que TA — el server valida con esSlotValido igual)
  const [slotsEntrega, setSlotsEntrega] = useState<{ iso: string; label: string }[]>([])
  const [vinoDeApp, setVinoDeApp] = useState(false)
  useEffect(() => { try { setVinoDeApp(new URLSearchParams(window.location.search).get('desde') === 'app') } catch {} }, [])
  // Cartel de cierre: los horarios se muestran SOLOS desde la config —
  // nunca más tipearlos a mano en el mensaje.
  const horariosTexto = [...horariosConfig]
    .sort((a, b) => a.desde.localeCompare(b.desde))
    .map(h => `${h.desde} a ${h.hasta}`)
    .join(' y ')
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
      // ══ CICLO 2 — PUENTE A LA APP PÚBLICA (la ÚNICA edición del ciclo a este
      // flujo; contrato CTO). Doblemente gateado e INERTE por diseño:
      //   1. ?desde=app presente → jamás re-reenvía (SOLO anti-loop, no negocio)
      //   2. reanudación MP pendiente → jamás intercepta (el cliente que vuelve
      //      de pagar retoma su pedido; condición previa a todo)
      //   3. consulta al agregador de la App Pública: con toggle OFF responde
      //      404 → catch/return → este flujo sigue EXACTAMENTE como siempre
      //   4. solo si Take Away está disponible → replace a /pedidos/ con el
      //      token como PASSTHROUGH puro (el QR sigue identificando su
      //      dispositivo; la App Pública lo transporta sin interpretarlo)
      // Cualquier error = camino de siempre. Byte-idéntico con toggle apagado.
      if (searchParams.get('desde') !== 'app') {
        const rawMp = (() => { try { return (localStorage.getItem('coneos_mp_pedido') ?? sessionStorage.getItem('coneos_mp_pedido')) } catch { return null } })()
        let mpPendiente = false
        if (rawMp) { try { const pj = JSON.parse(rawMp); mpPendiente = !!pj?.id && Date.now() - (pj.ts ?? 0) <= 3600000 } catch {} }
        if (!mpPendiente) {
          try {
            const partesApp = window.location.pathname.split('/').filter(Boolean)
            const eSlug = partesApp[0]
            const sSlug = partesApp[2]
            if (eSlug && sSlug) {
              const rApp = await fetch(`/api/pedidos-entrada/contexto?empresa=${eSlug}&sucursal=${sSlug}`)
              if (rApp.ok) {
                const dApp = await rApp.json()
                if (dApp?.servicios?.takeaway?.disponible === true) {
                  window.location.replace(`/${eSlug}/pedidos/${sSlug}${token ? `?token=${encodeURIComponent(token)}` : ''}`)
                  return
                }
              }
            }
          } catch {}
        }
      }
      // ══ FIN DEL PUENTE — de acá en adelante, el flujo de siempre ══

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
          setEnvioAlCadete(dc.envio_al_cadete === true)
          const horarios = (dc.horarios as { desde: string; hasta: string }[]) ?? []
          // 📅 el techo con días manda (server): día cerrado = vidriera cerrada
          const techoOk = horaData.techo_abierto !== false
          setHorarioActivo(dc.activo && techoOk ? estaEnHorario(horarios, horaData.hora) : false)
          setHorariosConfig(horarios)
          if (dc.permitir_programado === true) setSlotsEntrega(generarSlots(horarios))
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

    // Retorno del checkout de MP: retomar el pedido pendiente y verificar el pago
    const raw = (() => { try { return (localStorage.getItem('coneos_mp_pedido') ?? sessionStorage.getItem('coneos_mp_pedido')) } catch { return null } })()
    let pendiente: { id: string; ts: number; tipo?: string } | null = null
    // URL PRIMERO (fix celu 24/09): la app de MP vuelve en su navegador
    // interno sin nuestro storage — pero pega external_reference en la URL.
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
    if (!pendiente && raw) { try { pendiente = JSON.parse(raw) } catch {} }
    // Descartar pendientes de más de 1 hora
    if (pendiente?.tipo && pendiente.tipo !== 'delivery') return // pendiente de otra vidriera
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
  }, [params, token])

  // Carrito persistente: si el cliente recarga o cambia de app (ej. va al home
  // banking a hacer la transferencia), el carrito lo espera. TTL 2 horas.

  // Despertar de pestaña (pago hecho en la APP de MP y vuelta con "atrás"):
  // el bfcache revive la página sin recargar — verificamos el pendiente
  // cada vez que la vidriera vuelve a estar visible.
  useEffect(() => {
    const despertar = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const alConfirmar = (numero: number, codigo: string) => {
        try { localStorage.removeItem('coneos_mp_pedido'); sessionStorage.removeItem('coneos_mp_pedido') } catch {}
        setPedidoCreado({ numero, codigo })
        setCarrito([])
        setPaso('confirmacion')
      }
      const PAGADOS = ['PAID', 'PREPARING', 'READY', 'DELIVERED']
      let pend: { id?: string; ts?: number; tipo?: string } | null = null
      try { pend = JSON.parse(localStorage.getItem('coneos_mp_pedido') ?? 'null') } catch {}
      if (pend?.id && (!pend.tipo || pend.tipo === 'delivery') && Date.now() - (pend.ts ?? 0) <= 3600000) {
        fetch(`/api/pedidos/estado?pedido_id=${pend.id}`)
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (d && PAGADOS.includes(d.estado)) alConfirmar(d.numero_pedido, d.codigo_retiro) })
          .catch(() => {})
        return
      }
      // Sin memoria local (pago hecho en la app de MP, navegador interno):
      // EL SERVER RECUERDA — visitante_id ancló el pedido (Tráfico B, hoy).
      let vid = ''
      try { vid = localStorage.getItem('coneos_visitante_id') ?? '' } catch {}
      if (!vid) return
      const partes = window.location.pathname.split('/').filter(Boolean)
      fetch(`/api/pedidos/pendiente-mp?empresa=${partes[0]}&sucursal=${partes[2]}&visitante=${encodeURIComponent(vid)}&tipo=delivery`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { const ped = d?.pedido; if (ped && PAGADOS.includes(ped.estado)) alConfirmar(ped.numero_pedido, ped.codigo_retiro) })
        .catch(() => {})
    }
    window.addEventListener('pageshow', despertar)
    document.addEventListener('visibilitychange', despertar)
    return () => { window.removeEventListener('pageshow', despertar); document.removeEventListener('visibilitychange', despertar) }
  }, [])

  const claveCarrito = dispositivo ? `coneos_carrito_delivery_${dispositivo.sucursal_id}` : null
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
      const r = await fetch(`/api/kiosk/catalogo?empresa_id=${dispositivo!.empresa_id}&sucursal_id=${dispositivo!.sucursal_id}`)
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
    setCarrito([]); setPedidoCreado(null); setPaso('catalogo'); setCategoriaInicial(undefined); setAvisoPrecios(false); setItemsQuitados(0)
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
      {horariosTexto && (
        <p className="text-neutral-700 text-sm font-semibold bg-white border border-neutral-100 rounded-2xl px-5 py-3 shadow-sm">🕗 Nuestro horario: {horariosTexto}</p>
      )}
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
      <RegistroVisita empresaId={dispositivo.empresa_id} sucursalId={dispositivo.sucursal_id} canal="DELIVERY" />
      {vinoDeApp && paso === 'catalogo' && carrito.length === 0 && (
        <a href={`/${window.location.pathname.split('/').filter(Boolean)[0]}/pedidos/${window.location.pathname.split('/').filter(Boolean)[2]}`}
          className="fixed bottom-4 left-4 z-30 bg-white/95 backdrop-blur border border-neutral-200 shadow-md rounded-full px-3.5 py-2 text-xs font-bold text-neutral-500 active:scale-95 transition-transform">
          ← Ver otras opciones
        </a>
      )}

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
          onVolver={() => setCategoriaInicial(undefined)}
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
          config={config} dispositivo={dispositivo}
          carrito={carrito} setCarrito={setCarrito}
          accesorios={accesorios}
          costoEnvio={costoEnvio} envioAlCadete={envioAlCadete}
          onConfirmar={extras => { setAvisoPrecios(false); handleConfirmarCarrito(extras) }}
          onSeguirComprando={() => setPaso('catalogo')}
          onVolver={() => setPaso('catalogo')} />
      </>)}
      {paso === 'confirmacion' && (
        <KioskConfirmacionDelivery
          config={config} dispositivo={dispositivo}
          carrito={carrito} costoEnvio={costoEnvio} envioAlCadete={envioAlCadete}
          slotsRetiro={slotsEntrega}
          pedidoCreado={pedidoCreado}
          onPedidoCreado={(num, cod) => { setPedidoCreado({ numero: num, codigo: cod }); try { if (claveCarrito) localStorage.removeItem(claveCarrito) } catch {} }}
          onNuevoPedido={nuevoPedido}
          onPreciosDesactualizados={repreciarCarrito}
          onVolver={() => setPaso('carrito')} />
      )}
    </div>
  )
}
