'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, ShoppingBag, Loader2, RefreshCw, CheckCircle, Bike, Printer, History, ChevronLeft, ChevronRight, CloudRain } from 'lucide-react'
import NuevoPedido from './NuevoPedido'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador { session_id: string; operador: { id: string; nombre: string; puede_cobrar: boolean; puede_preparar: boolean; sucursal_id: string | null } }
interface OpcionItem { nombre_snap: string; emoji_snap: string | null }
interface PedidoItem { id: string; nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones: OpcionItem[] }
interface DatosDelivery { nombre: string; telefono: string; direccion: string; entre_calles?: string }
interface Colaborador { id: string; nombre: string }
interface Pedido { id: string; numero_pedido: number; codigo_retiro: string; estado: string; total: number; metodo_pago: string | null; notas: string | null; created_at: string; sucursales?: { nombre: string }; pedido_items: PedidoItem[]; tipo_pedido?: string | null; costo_envio?: number; datos_delivery?: DatosDelivery | null; captura_transferencia_url?: string | null; colaborador_id?: string | null; colaborador_nombre?: string | null }

const ESTADO_LABEL: Record<string, string> = { PENDING_PAYMENT: 'Pendiente', PAID: 'Pagado', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado' }
const ESTADO_DOT: Record<string, string> = { PENDING_PAYMENT: 'bg-red-400', PAID: 'bg-blue-400', PREPARING: 'bg-amber-400', READY: 'bg-green-400', DELIVERED: 'bg-neutral-300' }
const ESTADO_BADGE: Record<string, string> = { PENDING_PAYMENT: 'bg-red-50 text-red-700', PAID: 'bg-blue-50 text-blue-700', PREPARING: 'bg-amber-50 text-amber-700', READY: 'bg-green-50 text-green-700', DELIVERED: 'bg-neutral-100 text-neutral-500' }
const ESTADO_LEFT: Record<string, string> = { PENDING_PAYMENT: 'border-l-red-300', PAID: 'border-l-blue-300', PREPARING: 'border-l-amber-300', READY: 'border-l-green-300', DELIVERED: 'border-l-neutral-200' }

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function tiempoRelativo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (diff < 1) return 'Ahora'
  if (diff === 1) return '1 min'
  return `${diff} min`
}

export default function VistaCaja({ dispositivo, sesion }: { dispositivo: Dispositivo; sesion: SesionOperador }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'activos' | 'nuevo' | 'historial'>('activos')
  const [historialFecha, setHistorialFecha] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const [historialPedidos, setHistorialPedidos] = useState<Pedido[]>([])
  const [historialLoading, setHistorialLoading] = useState(false)
  const [historialSeleccionado, setHistorialSeleccionado] = useState<Pedido | null>(null)
  const [seleccionado, setSeleccionado] = useState<Pedido | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [entregado, setEntregado] = useState(false)
  const [modalComprobante, setModalComprobante] = useState(false)
  const [nombreCliente, setNombreCliente] = useState('')
  const [generandoTicket, setGenerandoTicket] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null)
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([])
  const [modalAsignar, setModalAsignar] = useState(false)
  const [pedidosSeleccionados, setPedidosSeleccionados] = useState<string[]>([])
  const [colaboradorSeleccionado, setColaboradorSeleccionado] = useState<string>('')
  const [asignando, setAsignando] = useState(false)
  const verTodas = sesion.operador.sucursal_id === null
  const [deliveryPausado, setDeliveryPausado] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('delivery_config').select('pausado').eq('sucursal_id', dispositivo.sucursal_id).maybeSingle()
      .then(({ data }) => setDeliveryPausado(data ? !!data.pausado : null))
  }, [dispositivo.sucursal_id])

  async function togglePausaDelivery() {
    if (deliveryPausado === null) return
    const nuevo = !deliveryPausado
    setDeliveryPausado(nuevo)
    const supabase = createClient()
    await supabase.from('delivery_config').update({ pausado: nuevo }).eq('sucursal_id', dispositivo.sucursal_id)
  }

  async function cargarHistorial(fecha: string) {
    setHistorialLoading(true)
    setHistorialSeleccionado(null)
    const supabase = createClient()
    let query = supabase
      .from('pedidos')
      .select('id, numero_pedido, codigo_retiro, estado, total, metodo_pago, notas, created_at, tipo_pedido, costo_envio, datos_delivery, colaborador_nombre, pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad, pedido_item_opciones(nombre_snap, emoji_snap))')
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('fecha_pedido', fecha)
      .order('numero_pedido', { ascending: true })
    if (!verTodas) query = query.eq('sucursal_id', dispositivo.sucursal_id)
    const { data } = await query
    setHistorialPedidos((data ?? []) as Pedido[])
    setHistorialLoading(false)
  }

  const cargarPedidos = useCallback(async () => {
    const supabase = createClient()
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    let query = supabase
      .from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, total, metodo_pago, notas, created_at, tipo_pedido, costo_envio, datos_delivery, captura_transferencia_url,
        sucursales(nombre),
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY', 'DELIVERED'])
      .order('numero_pedido', { ascending: false })
    if (!verTodas) query = query.eq('sucursal_id', dispositivo.sucursal_id)
    const { data } = await query
    setPedidos((data ?? []) as Pedido[])
    // Cargar colaboradores
    const { data: cols } = await supabase.from('colaboradores')
      .select('id, nombre').eq('empresa_id', dispositivo.empresa_id)
      .eq('activo', true).eq('rol', 'cadete').order('nombre')
    setColaboradores((cols ?? []) as Colaborador[])
    setLoading(false)
  }, [dispositivo, verTodas])

  // Ref para evitar closure stale en Realtime
  const cargarPedidosRef = useRef(cargarPedidos)
  useEffect(() => { cargarPedidosRef.current = cargarPedidos }, [cargarPedidos])

  const pedidosCountRef = useRef(0)

  function reproducirSonido() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    } catch {}
  }

  useEffect(() => {
    cargarPedidos()
    const supabase = createClient()
    const channel = supabase.channel(`caja-${dispositivo.sucursal_id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `empresa_id=eq.${dispositivo.empresa_id}` }, (payload) => {
        if (payload.eventType === 'INSERT') reproducirSonido()
        cargarPedidosRef.current()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [dispositivo])

  useEffect(() => {
    if (seleccionado) {
      const actualizado = pedidos.find(p => p.id === seleccionado.id)
      if (actualizado) setSeleccionado(actualizado)
    }
  }, [pedidos, seleccionado])

  async function asignarCadete() {
    if (!colaboradorSeleccionado || !pedidosSeleccionados.length) return
    setAsignando(true)
    const supabase = createClient()
    const col = colaboradores.find(c => c.id === colaboradorSeleccionado)
    await supabase.from('pedidos')
      .update({ colaborador_id: colaboradorSeleccionado, colaborador_nombre: col?.nombre ?? '' })
      .in('id', pedidosSeleccionados)
    // Imprimir comanda de cada pedido
    for (const pid of pedidosSeleccionados) {
      const res = await fetch('/api/comprobantes/comanda', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_id: pid }),
      })
      if (res.ok) {
        const html = await res.text()
        const win = window.open('', '_blank', 'width=400,height=700')
        if (win) { win.document.write(html); win.document.close() }
      }
    }
    setAsignando(false)
    setModalAsignar(false)
    setPedidosSeleccionados([])
    setColaboradorSeleccionado('')
    cargarPedidos()
  }

  async function imprimirComanda(pedidoId: string) {
    const res = await fetch('/api/comprobantes/comanda', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: pedidoId }),
    })
    if (res.ok) {
      const html = await res.text()
      const win = window.open('', '_blank', 'width=400,height=700')
      if (win) { win.document.write(html); win.document.close() }
    }
  }

  async function imprimirTicket(pedidoId: string, nombre?: string) {
    setGenerandoTicket(true)
    const res = await fetch('/api/comprobantes/ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: pedidoId, nombre_cliente: nombre || null }),
    })
    setGenerandoTicket(false)
    if (res.ok) {
      const html = await res.text()
      const win = window.open('', '_blank', 'width=400,height=700')
      if (win) { win.document.write(html); win.document.close() }
    }
    setModalComprobante(false)
    setNombreCliente('')
  }

  const [facturacionActiva, setFacturacionActiva] = useState(false)
  useEffect(() => {
    fetch(`/api/facturacion/emitir?empresa_id=${dispositivo.empresa_id}`)
      .then(r => r.json()).then(d => setFacturacionActiva(!!d.activa)).catch(() => {})
  }, [dispositivo])

  // Emisión silenciosa: si está desactivada por base no hace nada; si falla, no bloquea el cobro
  async function emitirFacturaSiCorresponde(pedidoId: string) {
    if (!facturacionActiva) return
    try {
      const r = await fetch('/api/facturacion/emitir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: dispositivo.empresa_id, pedido_id: pedidoId }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) console.error('[facturacion] no emitida:', d.error ?? r.status)
      else console.log('[facturacion] CAE:', d.cae, 'Nro:', d.nro_cbte)
    } catch (e) { console.error('[facturacion] error:', e) }
  }

  function handleTicketBtn(pedido: Pedido) {
    const metodo = pedido.metodo_pago ?? ''
    if (metodo === 'efectivo') {
      // Efectivo: ticket directo sin preguntar
      imprimirTicket(pedido.id)
    } else {
      // Transferencia / MP: preguntar si quiere comprobante
      setModalComprobante(true)
    }
  }

  async function cambiarEstado(pedidoId: string, estadoNuevo: string) {
    setProcesando(true)
    if (estadoNuevo === 'DELIVERED') setEntregado(false)
    await fetch('/api/pedidos/estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: pedidoId, estado_nuevo: estadoNuevo, operador_id: sesion.operador.id }),
    })
    setProcesando(false)
    if (estadoNuevo === 'DELIVERED') {
      setEntregado(true)
      setTimeout(() => {
        setEntregado(false)
        setSeleccionado(null)
      }, 1800)
    }
  }

  const tabs = [
    { key: 'PENDING_PAYMENT', label: 'Pendientes', short: 'Pend.' },
    { key: 'PAID', label: 'Pagados', short: 'Pag.' },
    { key: 'PREPARING', label: 'Preparando', short: 'Prep.' },
    { key: 'READY', label: 'Listos', short: 'List.' },
  ]
  const counts = tabs.reduce((acc, t) => ({ ...acc, [t.key]: pedidos.filter(p => p.estado === t.key).length }), {} as Record<string, number>)
  const pedidosFiltrados = filtroEstado ? pedidos.filter(p => p.estado === filtroEstado) : pedidos

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex bg-white border-b border-neutral-100 px-4 gap-0.5">
        <button onClick={() => { setTab('activos'); setFiltroEstado(null) }}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'activos' && !filtroEstado ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400'}`}>
          <ShoppingBag className="h-4 w-4" />
          Todos
          {pedidos.length > 0 && <span className="bg-neutral-800 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{pedidos.length}</span>}
        </button>
        {tabs.map(t => counts[t.key] > 0 && (
          <button key={t.key} onClick={() => { setTab('activos'); setFiltroEstado(t.key) }}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm font-semibold border-b-2 transition-colors ${filtroEstado === t.key ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400'}`}>
            <span className={`w-2 h-2 rounded-full ${ESTADO_DOT[t.key]}`} />
            <span className="hidden md:inline">{t.label}</span>
            <span className="md:hidden">{t.short}</span>
            <span className="text-xs font-bold">{counts[t.key]}</span>
          </button>
        ))}
        <div className="flex-1" />
        {deliveryPausado !== null && (
          <button onClick={togglePausaDelivery}
            title={deliveryPausado ? 'Reactivar delivery' : 'Pausar delivery (mal tiempo)'}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm font-semibold border-b-2 border-transparent transition-colors ${deliveryPausado ? 'text-blue-600' : 'text-neutral-300 hover:text-neutral-500'}`}>
            <CloudRain className="h-4 w-4" />
            <span className="hidden md:inline">{deliveryPausado ? 'Delivery pausado' : 'Pausar delivery'}</span>
          </button>
        )}
        <button onClick={() => { setTab('historial'); cargarHistorial(historialFecha) }}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'historial' ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400'}`}>
          <History className="h-4 w-4" />
          <span className="hidden md:inline">Historial</span>
        </button>
        <button onClick={() => setTab('nuevo')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'nuevo' ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400'}`}>
          <Plus className="h-4 w-4" />
          Nuevo
        </button>
      </div>

      {tab === 'historial' ? (
        <div className="flex-1 flex flex-col overflow-hidden bg-neutral-50">
          {/* Header historial con selector de fecha */}
          <div className="bg-white border-b border-neutral-100 px-4 py-3 flex items-center gap-3">
            <button onClick={() => { const d = new Date(historialFecha + 'T12:00:00'); d.setDate(d.getDate() - 1); const f = d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); setHistorialFecha(f); cargarHistorial(f) }}
              className="p-2 hover:bg-neutral-100 rounded-xl transition-colors">
              <ChevronLeft className="h-5 w-5 text-neutral-500" />
            </button>
            <input type="date" value={historialFecha}
              onChange={e => { setHistorialFecha(e.target.value); cargarHistorial(e.target.value) }}
              className="flex-1 text-center font-bold text-neutral-800 bg-transparent border-none outline-none text-sm" />
            <button onClick={() => { const d = new Date(historialFecha + 'T12:00:00'); d.setDate(d.getDate() + 1); const f = d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); setHistorialFecha(f); cargarHistorial(f) }}
              className="p-2 hover:bg-neutral-100 rounded-xl transition-colors">
              <ChevronRight className="h-5 w-5 text-neutral-500" />
            </button>
          </div>

          {historialLoading ? (
            <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
          ) : (
            <div className="flex-1 flex overflow-hidden">
              {/* Lista pedidos historial */}
              <div className="w-64 border-r border-neutral-100 flex flex-col overflow-hidden bg-white">
                {/* Resumen del día */}
                {historialPedidos.length > 0 && (() => {
                  const ef = historialPedidos.filter(p => p.metodo_pago === 'efectivo').reduce((a, p) => a + p.total, 0)
                  const tr = historialPedidos.filter(p => p.metodo_pago === 'transferencia').reduce((a, p) => a + p.total, 0)
                  const mp = historialPedidos.filter(p => p.metodo_pago === 'mp').reduce((a, p) => a + p.total, 0)
                  const total = ef + tr + mp
                  return (
                    <div className="px-3 py-3 border-b border-neutral-100 bg-neutral-50">
                      <p className="text-xs font-bold text-neutral-500 mb-2">{historialPedidos.length} pedidos — {formatPrecio(total)}</p>
                      <div className="space-y-1">
                        {ef > 0 && <div className="flex justify-between text-xs"><span className="text-green-600 font-semibold">💵 Efectivo</span><span className="font-bold">{formatPrecio(ef)}</span></div>}
                        {tr > 0 && <div className="flex justify-between text-xs"><span className="text-blue-600 font-semibold">📲 Transfer.</span><span className="font-bold">{formatPrecio(tr)}</span></div>}
                        {mp > 0 && <div className="flex justify-between text-xs"><span className="text-sky-600 font-semibold">📱 MP</span><span className="font-bold">{formatPrecio(mp)}</span></div>}
                      </div>
                    </div>
                  )
                })()}
                <div className="flex-1 overflow-y-auto">
                  {historialPedidos.length === 0 && <p className="text-center text-neutral-400 text-sm py-12">Sin pedidos este día</p>}
                  {historialPedidos.map(p => (
                    <button key={p.id} onClick={() => setHistorialSeleccionado(p)}
                      className={`w-full text-left px-4 py-3 border-b border-neutral-50 border-l-4 transition-colors ${historialSeleccionado?.id === p.id ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50/50'} ${ESTADO_LEFT[p.estado] ?? 'border-l-neutral-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-neutral-800">#{p.numero_pedido}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ESTADO_BADGE[p.estado]}`}>{ESTADO_LABEL[p.estado]}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-neutral-400">{p.metodo_pago ?? '—'}</span>
                        <span className="text-xs font-bold text-neutral-600">{formatPrecio(p.total)}</span>
                      </div>
                      {p.colaborador_nombre && <p className="text-xs text-neutral-400 mt-0.5">🛵 {p.colaborador_nombre}</p>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Detalle pedido historial */}
              <div className="flex-1 overflow-y-auto p-4">
                {!historialSeleccionado ? (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-300 gap-3">
                    <History className="h-12 w-12" />
                    <p className="text-sm">Seleccioná un pedido</p>
                  </div>
                ) : (
                  <div className="max-w-sm mx-auto">
                    <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-3">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="font-black text-2xl text-neutral-800">#{historialSeleccionado.numero_pedido}</h2>
                        <span className={`text-xs px-2 py-1 rounded-full font-semibold ${ESTADO_BADGE[historialSeleccionado.estado]}`}>{ESTADO_LABEL[historialSeleccionado.estado]}</span>
                      </div>
                      <div className="space-y-2 mb-3">
                        {historialSeleccionado.pedido_items.map((item, i) => (
                          <div key={i} className="border-b border-neutral-50 pb-2">
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold">{item.cantidad}× {item.nombre_presentacion_snap}</span>
                              <span className="font-bold">{formatPrecio(item.precio_snap)}</span>
                            </div>
                            {item.pedido_item_opciones.length > 0 && (
                              <p className="text-xs text-neutral-400 mt-0.5">{item.pedido_item_opciones.map(o => `${o.emoji_snap ?? ''} ${o.nombre_snap}`).join(' · ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Total</span><span>{formatPrecio(historialSeleccionado.total)}</span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">Pago: {historialSeleccionado.metodo_pago ?? '—'}</p>
                      {historialSeleccionado.colaborador_nombre && <p className="text-xs text-neutral-400">🛵 {historialSeleccionado.colaborador_nombre}</p>}
                      {historialSeleccionado.notas && <p className="text-xs text-amber-600 mt-1">{historialSeleccionado.notas}</p>}
                    </div>
                    {historialSeleccionado.datos_delivery && (() => {
                      const d = historialSeleccionado.datos_delivery as DatosDelivery
                      return (
                        <div className="bg-purple-50 rounded-2xl border border-purple-100 p-4 text-sm">
                          <p className="font-bold text-purple-700 mb-1">🛵 Datos delivery</p>
                          <p className="text-purple-700">{d.nombre}</p>
                          <p className="text-purple-600">{d.direccion}{d.entre_calles ? ` (entre ${d.entre_calles})` : ''}</p>
                          <p className="text-purple-600">{d.telefono}</p>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : tab === 'nuevo' ? (
        <NuevoPedido dispositivo={dispositivo} sesion={sesion} onPedidoCreado={() => setTab('activos')} />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r border-neutral-100 flex flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-50">
              <p className="text-xs font-semibold text-neutral-400">{pedidosFiltrados.length} pedido{pedidosFiltrados.length !== 1 ? 's' : ''}</p>
              <div className="flex items-center gap-1">
                {pedidosSeleccionados.length > 0 && (
                  <button onClick={() => setModalAsignar(true)}
                    className="flex items-center gap-1 px-2 py-1 bg-neutral-800 text-white text-xs font-semibold rounded-lg">
                    <Bike className="h-3 w-3" /> Asignar ({pedidosSeleccionados.length})
                  </button>
                )}
                <button onClick={cargarPedidos} className="p-1 text-neutral-300 hover:text-neutral-500 transition-colors"><RefreshCw className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-neutral-200" /></div>
              ) : pedidosFiltrados.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-neutral-200">
                  <ShoppingBag className="h-8 w-8 mb-2" /><p className="text-xs">Sin pedidos</p>
                </div>
              ) : pedidosFiltrados.map(pedido => (
                <div key={pedido.id} className={`w-full text-left border-b border-neutral-50 border-l-4 transition-colors ${seleccionado?.id === pedido.id ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50/50'} ${ESTADO_LEFT[pedido.estado]}`}>
                  {pedido.tipo_pedido === 'delivery' && (
                    <div className="flex items-center gap-2 px-4 pt-2">
                      <input type="checkbox" checked={pedidosSeleccionados.includes(pedido.id)}
                        onChange={e => { e.stopPropagation(); setPedidosSeleccionados(prev => e.target.checked ? [...prev, pedido.id] : prev.filter(id => id !== pedido.id)) }}
                        className="w-4 h-4 rounded accent-neutral-800 cursor-pointer" />
                      <span className="text-xs text-neutral-400 font-medium">Seleccionar para asignar</span>
                    </div>
                  )}
                  <button onClick={() => { setSeleccionado(pedido); setEntregado(false) }} className="w-full text-left px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-neutral-800 text-base">#{pedido.numero_pedido}</span>
                      {pedido.tipo_pedido === 'delivery' && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">Delivery</span>}
                      {pedido.colaborador_nombre && <span className="text-xs bg-neutral-800 text-white px-1.5 py-0.5 rounded-full font-semibold">🛵 {pedido.colaborador_nombre}</span>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ESTADO_BADGE[pedido.estado]}`}>{ESTADO_LABEL[pedido.estado]}</span>
                  </div>
                  <div className="mb-1 space-y-0.5">
                    {pedido.pedido_items.slice(0, 3).map((item, i) => (
                      <div key={i}>
                        <p className="text-neutral-600 text-xs font-medium truncate">{item.cantidad}× {item.nombre_presentacion_snap}</p>
                        {item.pedido_item_opciones.length > 0 && (
                          <p className="text-neutral-400 text-xs truncate">{item.pedido_item_opciones.map(o => `${o.emoji_snap ?? ''} ${o.nombre_snap}`).join(', ')}</p>
                        )}
                      </div>
                    ))}
                    {pedido.pedido_items.length > 3 && <p className="text-neutral-300 text-xs">+{pedido.pedido_items.length - 3} más</p>}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-300 text-xs">{tiempoRelativo(pedido.created_at)}</span>
                    <span className="text-neutral-600 text-xs font-bold">{formatPrecio(pedido.total)}</span>
                  </div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 bg-neutral-50">
            {!seleccionado ? (
              <div className="flex flex-col items-center justify-center h-full text-neutral-200">
                <ShoppingBag className="h-14 w-14 mb-3" />
                <p className="text-sm">Seleccioná un pedido</p>
              </div>
            ) : entregado ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-10 w-10 text-green-600" />
                </div>
                <p className="text-xl font-black text-neutral-800">¡Entregado!</p>
                <p className="text-neutral-400 text-sm">Pedido #{seleccionado.numero_pedido} entregado</p>
              </div>
            ) : (
              <div className="max-w-lg mx-auto">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <h2 className="text-2xl font-black text-neutral-800">Pedido #{seleccionado.numero_pedido}</h2>
                    <p className="text-neutral-400 text-sm mt-0.5">{tiempoRelativo(seleccionado.created_at)} · Código: <span className="font-mono font-bold text-neutral-600">{seleccionado.codigo_retiro}</span></p>
                    {verTodas && seleccionado.sucursales?.nombre && <p className="text-neutral-400 text-xs mt-0.5">📍 {seleccionado.sucursales.nombre}</p>}
                  </div>
                  <span className={`px-3 py-1.5 rounded-xl text-sm font-bold ${ESTADO_BADGE[seleccionado.estado]}`}>{ESTADO_LABEL[seleccionado.estado]}</span>
                </div>

                <div className="bg-white rounded-2xl border border-neutral-100 overflow-hidden shadow-sm mb-4">
                  {(() => {
                    const esAccesorio = (it: PedidoItem) => it.nombre_producto_snap === 'Accesorios' || it.nombre_producto_snap === it.nombre_presentacion_snap
                    const normales = seleccionado.pedido_items.filter(it => !esAccesorio(it))
                    const accs = seleccionado.pedido_items.filter(esAccesorio)
                    const totalAccs = accs.reduce((s, it) => s + Number(it.precio_snap) * it.cantidad, 0)
                    return (<>
                      {normales.map((item, i) => (
                        <div key={item.id} className={`p-4 ${i < normales.length - 1 || accs.length > 0 ? 'border-b border-neutral-50' : ''}`}>
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1">
                              <p className="text-neutral-800 font-bold">{item.nombre_producto_snap}</p>
                              <p className="text-neutral-400 text-sm">{item.nombre_presentacion_snap}</p>
                              {item.pedido_item_opciones.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {item.pedido_item_opciones.map((op, j) => (
                                    <span key={j} className="text-xs bg-neutral-100 text-neutral-600 px-2.5 py-1 rounded-full">{op.emoji_snap} {op.nombre_snap}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <p className="text-neutral-800 font-bold">{formatPrecio(item.precio_snap)}</p>
                          </div>
                        </div>
                      ))}
                      {accs.length > 0 && (
                        <div className="p-4">
                          <div className="flex justify-between items-start gap-4">
                            <p className="text-neutral-800 font-bold">Accesorios</p>
                            <p className="text-neutral-800 font-bold">{formatPrecio(totalAccs)}</p>
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {accs.map(item => (
                              <div key={item.id} className="flex justify-between items-center gap-4">
                                <p className="text-neutral-400 text-sm">{item.cantidad}× {item.nombre_presentacion_snap.replace(/^Toppings?\s+/i, '')}</p>
                                <p className="text-neutral-400 text-xs">{formatPrecio(Number(item.precio_snap) * item.cantidad)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>)
                  })()}
                  <div className="px-4 py-3 bg-neutral-50 border-t border-neutral-100 flex justify-between">
                    <span className="text-neutral-500 font-medium">Total</span>
                    <span className="text-neutral-900 font-black text-lg">{formatPrecio(seleccionado.total)}</span>
                  </div>
                </div>

                {seleccionado.notas && seleccionado.notas.startsWith('Comprobante:') ? (
                  <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-2xl">📲</span>
                    <div>
                      <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide">Últimos dígitos comprobante</p>
                      <p className="text-blue-800 font-black text-2xl tracking-widest">{seleccionado.notas.replace('Comprobante: ...', '')}</p>
                    </div>
                  </div>
                ) : seleccionado.notas ? (
                  <div className="mb-4 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <p className="text-amber-700 text-sm">📝 {seleccionado.notas}</p>
                  </div>
                ) : null}
                {seleccionado.tipo_pedido === 'delivery' && (
                  <button onClick={() => imprimirComanda(seleccionado.id)}
                    className="w-full mb-3 py-2.5 flex items-center justify-center gap-2 border border-neutral-200 rounded-xl text-neutral-600 text-sm font-semibold hover:bg-neutral-50 transition-colors">
                    <Printer className="h-4 w-4" /> Reimprimir comanda
                  </button>
                )}
                {seleccionado.tipo_pedido === 'delivery' && seleccionado.datos_delivery && (
                  <div className="mb-4 bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 space-y-1">
                    <p className="text-purple-700 text-sm font-bold mb-1">🛵 Datos de entrega</p>
                    <p className="text-purple-600 text-sm"><span className="font-semibold">Nombre:</span> {seleccionado.datos_delivery.nombre}</p>
                    <p className="text-purple-600 text-sm"><span className="font-semibold">Tel:</span> {seleccionado.datos_delivery.telefono}</p>
                    <p className="text-purple-600 text-sm"><span className="font-semibold">Dirección:</span> {seleccionado.datos_delivery.direccion}</p>
                    {seleccionado.datos_delivery.entre_calles && <p className="text-purple-600 text-sm"><span className="font-semibold">Entre:</span> {seleccionado.datos_delivery.entre_calles}</p>}
                    {seleccionado.costo_envio ? <p className="text-purple-600 text-sm"><span className="font-semibold">Envío:</span> ${Number(seleccionado.costo_envio).toLocaleString('es-AR')}</p> : null}
                    {seleccionado.captura_transferencia_url && (
                      <div className="mt-2">
                        <p className="text-xs text-purple-500 font-semibold mb-1">📎 Comprobante de transferencia</p>
                        <a href={seleccionado.captura_transferencia_url} target="_blank" rel="noopener noreferrer">
                          <img src={seleccionado.captura_transferencia_url} alt="Comprobante"
                            className="w-full max-h-64 object-contain rounded-xl border border-purple-100 bg-white cursor-zoom-in" />
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {seleccionado.estado === 'PENDING_PAYMENT' && (<>
                    {seleccionado.metodo_pago && (
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <span className="text-xs text-neutral-400">Cliente eligió:</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${seleccionado.metodo_pago === 'efectivo' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {seleccionado.metodo_pago === 'efectivo' ? '💵 Efectivo' : seleccionado.metodo_pago === 'transferencia' ? '📲 Transferencia' : '📱 Mercado Pago'}
                        </span>
                      </div>
                    )}
                    <button onClick={async () => {
                        await cambiarEstado(seleccionado.id, 'PAID')
                        await cambiarEstado(seleccionado.id, 'PREPARING')
                        imprimirTicket(seleccionado.id)
                      }} disabled={procesando}
                      className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
                      {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : '✓ Cobrar efectivo'}
                    </button>
                    <button onClick={async () => { await cambiarEstado(seleccionado.id, 'PAID'); emitirFacturaSiCorresponde(seleccionado.id); setModalComprobante(true) }} disabled={procesando}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-base transition-colors disabled:opacity-50 shadow-sm">
                      📱 Cobrar transferencia
                    </button>
                  </>)}
                  {seleccionado.estado === 'PAID' && (
                    <button onClick={() => cambiarEstado(seleccionado.id, 'PREPARING')} disabled={procesando}
                      className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
                      {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : '🍦 Enviar a preparación'}
                    </button>
                  )}
                  {seleccionado.estado === 'PREPARING' && (
                    <button onClick={() => cambiarEstado(seleccionado.id, 'READY')} disabled={procesando}
                      className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
                      {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : '✓ Marcar listo'}
                    </button>
                  )}
                  {seleccionado.estado === 'READY' && (
                    <button onClick={() => cambiarEstado(seleccionado.id, 'DELIVERED')} disabled={procesando}
                      className="w-full py-4 bg-neutral-800 hover:bg-neutral-700 text-white rounded-2xl font-bold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
                      {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle className="h-5 w-5" /> Entregado</>}
                    </button>
                  )}
                  {seleccionado.estado === 'DELIVERED' && (
                    <button onClick={() => imprimirTicket(seleccionado.id)}
                      className="w-full py-4 border-2 border-neutral-200 text-neutral-600 hover:bg-neutral-50 rounded-2xl font-bold text-base transition-colors flex items-center justify-center gap-2">
                      🖨️ Reimprimir ticket
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    {/* Modal asignar cadete */}
    {modalAsignar && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setModalAsignar(false)} />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
          <h3 className="font-bold text-neutral-900 text-lg mb-1">Asignar cadete</h3>
          <p className="text-neutral-400 text-sm mb-5">{pedidosSeleccionados.length} pedido{pedidosSeleccionados.length !== 1 ? 's' : ''} seleccionado{pedidosSeleccionados.length !== 1 ? 's' : ''}</p>
          <div className="space-y-2 mb-5">
            {colaboradores.map(c => (
              <button key={c.id} onClick={() => setColaboradorSeleccionado(c.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${colaboradorSeleccionado === c.id ? 'border-neutral-800 bg-neutral-50' : 'border-neutral-200'}`}>
                <span className="text-xl">🛵</span>
                <span className="font-semibold text-neutral-800">{c.nombre}</span>
              </button>
            ))}
            {colaboradores.length === 0 && <p className="text-neutral-400 text-sm text-center py-4">No hay cadetes activos. Cargalos en Admin → Operación → Colaboradores</p>}
          </div>
          <div className="space-y-2">
            <button onClick={asignarCadete} disabled={!colaboradorSeleccionado || asignando}
              className="w-full py-3 bg-neutral-800 text-white rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {asignando ? <><Loader2 className="h-4 w-4 animate-spin" /> Asignando...</> : '🛵 Asignar e imprimir comanda'}
            </button>
            <button onClick={() => { setModalAsignar(false); setColaboradorSeleccionado('') }}
              className="w-full py-3 text-neutral-500 rounded-xl text-sm">Cancelar</button>
          </div>
        </div>
      </div>
    )}
    {/* Modal comprobante */}
    {modalComprobante && seleccionado && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setModalComprobante(false)} />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
          <h3 className="font-bold text-neutral-900 text-lg mb-1">¿El cliente quiere comprobante?</h3>
          <p className="text-neutral-400 text-sm mb-5">Podés agregar el nombre del cliente al ticket.</p>
          <div className="space-y-3 mb-5">
            <label className="text-sm font-medium text-neutral-700">Nombre del cliente (opcional)</label>
            <input
              value={nombreCliente}
              onChange={e => setNombreCliente(e.target.value)}
              placeholder="Nombre y apellido"
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <button
              onClick={async () => { await imprimirTicket(seleccionado.id, nombreCliente); cambiarEstado(seleccionado.id, 'PREPARING') }}
              disabled={generandoTicket}
              className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              {generandoTicket ? <><Loader2 className="h-4 w-4 animate-spin" /> Generando...</> : '🖨️ Generar ticket'}
            </button>
            <button
              onClick={() => { setModalComprobante(false); setNombreCliente(''); cambiarEstado(seleccionado.id, 'PREPARING') }}
              className="w-full py-3 text-neutral-500 hover:text-neutral-700 rounded-xl text-sm transition-colors">
              No necesita comprobante → Preparación
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  )
}
