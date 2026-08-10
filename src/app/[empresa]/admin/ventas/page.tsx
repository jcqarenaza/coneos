'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeModal } from '@/components/admin/ConeComponents'
import { Loader2, TrendingUp, ShoppingBag, BarChart3, CreditCard, ChevronDown, ChevronRight, XCircle } from 'lucide-react'

interface Sucursal { id: string; nombre: string }
interface PedidoItem { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones?: { nombre_snap: string; emoji_snap: string | null }[] }
interface PedidoVenta {
  id: string; numero_pedido: number; total: number; metodo_pago: string | null; estado: string
  created_at: string; fecha_pedido: string; sucursal_id: string; codigo_retiro: string
  notas: string | null; motivo_cancelacion: string | null
  pedido_items: PedidoItem[]
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function formatFecha(f: string) {
  const d = new Date(f + 'T00:00:00-03:00')
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatHora(ts: string) {
  return new Date(ts).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
}

const METODO_LABEL: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', mp: 'Mercado Pago' }
const ESTADO_LABEL: Record<string, string> = { PENDING_PAYMENT: 'Pendiente', PAID: 'Pagado', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' }
const ESTADO_BADGE: Record<string, string> = {
  PENDING_PAYMENT: 'bg-red-50 text-red-700', PAID: 'bg-blue-50 text-blue-700',
  PREPARING: 'bg-amber-50 text-amber-700', READY: 'bg-green-50 text-green-700',
  DELIVERED: 'bg-neutral-100 text-neutral-500', CANCELLED: 'bg-red-100 text-red-500'
}

const MOTIVOS_CANCELACION = [
  'Cliente desistió',
  'Error de pago',
  'Error de carga',
  'Producto no disponible',
  'Otro',
]

const RANGOS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'ayer', label: 'Ayer' },
  { key: '7dias', label: '7 días' },
  { key: '30dias', label: '30 días' },
  { key: 'custom', label: 'Personalizado' },
]

export default function VentasPage() {
  const { ctx } = useEmpresa()
  const [tab, setTab] = useState<'resumen' | 'historial'>('resumen')
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [pedidos, setPedidos] = useState<PedidoVenta[]>([])
  const [loading, setLoading] = useState(true)
  const [sucursalFiltro, setSucursalFiltro] = useState<string>('todas')
  const [metodoPagoFiltro, setMetodoPagoFiltro] = useState<string>('todos')
  const [estadoFiltro, setEstadoFiltro] = useState<string>('todos')
  const [rango, setRango] = useState<'hoy' | 'ayer' | '7dias' | '30dias' | 'custom'>('hoy')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [modalCancelar, setModalCancelar] = useState(false)
  const [pedidoCancelar, setPedidoCancelar] = useState<PedidoVenta | null>(null)
  const [motivoCancelacion, setMotivoCancelacion] = useState('Cliente desistió')
  const [motivoCustom, setMotivoCustom] = useState('')
  const [cancelando, setCancelando] = useState(false)

  function getFechas() {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const hace7 = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    const hace30 = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    if (rango === 'hoy') return { desde: hoy, hasta: hoy }
    if (rango === 'ayer') return { desde: ayer, hasta: ayer }
    if (rango === '7dias') return { desde: hace7, hasta: hoy }
    if (rango === '30dias') return { desde: hace30, hasta: hoy }
    return { desde: fechaDesde || hoy, hasta: fechaHasta || hoy }
  }

  async function cargar() {
    if (!ctx) return
    setLoading(true)
    const supabase = createClient()
    const { desde, hasta } = getFechas()

    const estados = tab === 'resumen'
      ? ['PAID', 'PREPARING', 'READY', 'DELIVERED']
      : estadoFiltro === 'todos'
        ? ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED']
        : [estadoFiltro]

    let query = supabase
      .from('pedidos')
      .select(`id, numero_pedido, total, metodo_pago, estado, created_at, fecha_pedido, sucursal_id, codigo_retiro, notas, motivo_cancelacion,
        pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', ctx.empresaId)
      .in('estado', estados)
      .gte('fecha_pedido', desde)
      .lte('fecha_pedido', hasta)
      .order('created_at', { ascending: false })

    if (sucursalFiltro !== 'todas') query = query.eq('sucursal_id', sucursalFiltro)
    if (metodoPagoFiltro !== 'todos') query = query.eq('metodo_pago', metodoPagoFiltro)

    const { data } = await query
    setPedidos((data ?? []) as PedidoVenta[])
    setLoading(false)
  }

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    supabase.from('sucursales').select('id, nombre').eq('empresa_id', ctx.empresaId).order('nombre')
      .then(({ data }) => setSucursales((data ?? []) as Sucursal[]))
  }, [ctx])

  useEffect(() => { cargar() }, [ctx, tab, rango, sucursalFiltro, metodoPagoFiltro, estadoFiltro, fechaDesde, fechaHasta])

  async function cancelarPedido() {
    if (!pedidoCancelar) return
    setCancelando(true)
    const supabase = createClient()
    const motivo = motivoCancelacion === 'Otro' ? motivoCustom : motivoCancelacion
    await supabase.from('pedidos').update({ estado: 'CANCELLED', motivo_cancelacion: motivo }).eq('id', pedidoCancelar.id)
    setCancelando(false)
    setModalCancelar(false)
    setPedidoCancelar(null)
    cargar()
  }

  function toggleExpandido(id: string) {
    setExpandidos(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  // Stats para resumen
  const pedidosResumen = pedidos.filter(p => p.estado !== 'CANCELLED')
  const totalFacturacion = pedidosResumen.reduce((acc, p) => acc + Number(p.total), 0)
  const ticketPromedio = pedidosResumen.length > 0 ? totalFacturacion / pedidosResumen.length : 0
  const porProducto: Record<string, { nombre: string; cantidad: number; total: number }> = {}
  pedidosResumen.forEach(p => {
    p.pedido_items?.forEach(item => {
      const key = item.nombre_producto_snap
      if (!porProducto[key]) porProducto[key] = { nombre: key, cantidad: 0, total: 0 }
      porProducto[key].cantidad += item.cantidad
      porProducto[key].total += Number(item.precio_snap) * item.cantidad
    })
  })
  const rankingProductos = Object.values(porProducto).sort((a, b) => b.total - a.total).slice(0, 8)
  const porMetodo: Record<string, number> = {}
  pedidosResumen.forEach(p => { const m = p.metodo_pago ?? 'otro'; porMetodo[m] = (porMetodo[m] ?? 0) + Number(p.total) })

  const Filtros = () => (
    <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-6 shadow-sm">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Período</p>
          <div className="flex gap-1.5 flex-wrap">
            {RANGOS.map(r => (
              <button key={r.key} onClick={() => setRango(r.key as typeof rango)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${rango === r.key ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {rango === 'custom' && (
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-neutral-400">Desde</p>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400" />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-neutral-400">Hasta</p>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400" />
            </div>
          </div>
        )}
        {sucursales.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Sucursal</p>
            <select value={sucursalFiltro} onChange={e => setSucursalFiltro(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400 bg-white">
              <option value="todas">Todas</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Método</p>
          <select value={metodoPagoFiltro} onChange={e => setMetodoPagoFiltro(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400 bg-white">
            <option value="todos">Todos</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="mp">Mercado Pago</option>
          </select>
        </div>
        {tab === 'historial' && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Estado</p>
            <select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400 bg-white">
              <option value="todos">Todos</option>
              <option value="DELIVERED">Entregados</option>
              <option value="CANCELLED">Cancelados</option>
              <option value="PENDING_PAYMENT">Pendientes</option>
            </select>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div>
      <ConePageHeader title="Ventas" description="Reportes, historial y gestión de pedidos" />

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl mb-6 w-fit">
        <button onClick={() => setTab('resumen')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === 'resumen' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
          Resumen
        </button>
        <button onClick={() => setTab('historial')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === 'historial' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
          Historial
        </button>
      </div>

      <Filtros />

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
      ) : tab === 'resumen' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-neutral-400 text-sm font-medium">Facturación</p>
                <div className="w-8 h-8 bg-green-50 rounded-xl flex items-center justify-center"><TrendingUp className="h-4 w-4 text-green-600" /></div>
              </div>
              <p className="text-2xl font-black text-neutral-800">{formatPrecio(totalFacturacion)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-neutral-400 text-sm font-medium">Pedidos</p>
                <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center"><ShoppingBag className="h-4 w-4 text-blue-600" /></div>
              </div>
              <p className="text-2xl font-black text-neutral-800">{pedidosResumen.length}</p>
            </div>
            <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-neutral-400 text-sm font-medium">Ticket promedio</p>
                <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center"><BarChart3 className="h-4 w-4 text-amber-600" /></div>
              </div>
              <p className="text-2xl font-black text-neutral-800">{formatPrecio(ticketPromedio)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-neutral-400 text-sm font-medium">Métodos de pago</p>
                <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center"><CreditCard className="h-4 w-4 text-purple-600" /></div>
              </div>
              <div className="space-y-1">
                {Object.entries(porMetodo).map(([m, v]) => (
                  <div key={m} className="flex justify-between items-center">
                    <span className="text-neutral-500 text-xs">{METODO_LABEL[m] ?? m}</span>
                    <span className="text-neutral-700 text-xs font-bold">{formatPrecio(v)}</span>
                  </div>
                ))}
                {Object.keys(porMetodo).length === 0 && <p className="text-neutral-300 text-xs">Sin datos</p>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-50"><h3 className="font-bold text-neutral-700">Productos más vendidos</h3></div>
              {rankingProductos.length === 0 ? (
                <div className="px-5 py-10 text-center text-neutral-300 text-sm">Sin datos</div>
              ) : (
                <div className="divide-y divide-neutral-50">
                  {rankingProductos.map((p, i) => (
                    <div key={p.nombre} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-300 text-xs font-bold w-4">{i + 1}</span>
                        <span className="text-neutral-700 text-sm font-medium">{p.nombre}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-neutral-800 text-sm font-bold">{formatPrecio(p.total)}</p>
                        <p className="text-neutral-400 text-xs">{p.cantidad} unidades</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-50"><h3 className="font-bold text-neutral-700">Últimos pedidos</h3></div>
              {pedidosResumen.length === 0 ? (
                <div className="px-5 py-10 text-center text-neutral-300 text-sm">Sin pedidos en el período</div>
              ) : (
                <div className="divide-y divide-neutral-50 max-h-80 overflow-y-auto">
                  {pedidosResumen.slice(0, 20).map(p => (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-neutral-800 text-sm font-bold">#{p.numero_pedido}</p>
                        <p className="text-neutral-400 text-xs">{formatFecha(p.fecha_pedido)} {formatHora(p.created_at)} · {METODO_LABEL[p.metodo_pago ?? ''] ?? '—'}</p>
                      </div>
                      <p className="text-neutral-700 font-bold text-sm">{formatPrecio(Number(p.total))}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Historial */
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-50 flex items-center justify-between">
            <h3 className="font-bold text-neutral-700">{pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''}</h3>
          </div>
          {pedidos.length === 0 ? (
            <div className="px-5 py-16 text-center text-neutral-300 text-sm">Sin pedidos en el período seleccionado</div>
          ) : (
            <div className="divide-y divide-neutral-50">
              {pedidos.map(p => {
                const expandido = expandidos.has(p.id)
                const cancelable = ['PENDING_PAYMENT', 'PAID', 'PREPARING'].includes(p.estado)
                return (
                  <div key={p.id}>
                    <div className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50/50 transition-colors cursor-pointer"
                      onClick={() => toggleExpandido(p.id)}>
                      <button className="text-neutral-300">
                        {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 grid grid-cols-5 gap-3 items-center">
                        <div>
                          <p className="text-neutral-800 font-bold text-sm">#{p.numero_pedido}</p>
                          <p className="text-neutral-400 text-xs">{formatHora(p.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-neutral-600 text-xs truncate">{p.pedido_items.map(i => i.nombre_producto_snap).join(', ')}</p>
                        </div>
                        <div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ESTADO_BADGE[p.estado]}`}>{ESTADO_LABEL[p.estado]}</span>
                        </div>
                        <div>
                          <p className="text-neutral-500 text-xs">{METODO_LABEL[p.metodo_pago ?? ''] ?? '—'}</p>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-neutral-800 font-bold text-sm">{formatPrecio(Number(p.total))}</p>
                          {cancelable && (
                            <button onClick={e => { e.stopPropagation(); setPedidoCancelar(p); setModalCancelar(true) }}
                              className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {expandido && (
                      <div className="px-14 pb-4 bg-neutral-50/50">
                        <div className="bg-white rounded-xl border border-neutral-100 overflow-hidden">
                          {p.pedido_items.map((item, i) => (
                            <div key={i} className={`px-4 py-3 ${i < p.pedido_items.length - 1 ? 'border-b border-neutral-50' : ''}`}>
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="text-neutral-700 text-sm font-semibold">{item.nombre_producto_snap}</p>
                                  <p className="text-neutral-400 text-xs">{item.nombre_presentacion_snap}</p>
                                  {item.pedido_item_opciones && item.pedido_item_opciones.length > 0 && (
                                    <p className="text-neutral-400 text-xs mt-0.5">
                                      {item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(' · ')}
                                    </p>
                                  )}
                                </div>
                                <p className="text-neutral-700 text-sm font-bold">{formatPrecio(item.precio_snap)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {p.notas && <p className="text-amber-600 text-xs mt-2">📝 {p.notas}</p>}
                        {p.motivo_cancelacion && <p className="text-red-500 text-xs mt-2">❌ Cancelado: {p.motivo_cancelacion}</p>}
                        <p className="text-neutral-400 text-xs mt-2">Código: {p.codigo_retiro} · {formatFecha(p.fecha_pedido)}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal cancelar */}
      <ConeModal open={modalCancelar} onClose={() => setModalCancelar(false)} title="Cancelar pedido"
        footer={<>
          <ConeButton variant="outline" onClick={() => setModalCancelar(false)}>Volver</ConeButton>
          <ConeButton onClick={cancelarPedido} loading={cancelando}>
            <span className="text-red-500">Confirmar cancelación</span>
          </ConeButton>
        </>}>
        {pedidoCancelar && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <p className="text-red-700 text-sm font-semibold">Pedido #{pedidoCancelar.numero_pedido} — {formatPrecio(pedidoCancelar.total)}</p>
              <p className="text-red-500 text-xs mt-0.5">Esta acción no se puede deshacer</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-neutral-700">Motivo de cancelación</p>
              <div className="space-y-2">
                {MOTIVOS_CANCELACION.map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="motivo" value={m} checked={motivoCancelacion === m}
                      onChange={() => setMotivoCancelacion(m)} className="w-4 h-4" />
                    <span className="text-sm text-neutral-700">{m}</span>
                  </label>
                ))}
              </div>
              {motivoCancelacion === 'Otro' && (
                <input value={motivoCustom} onChange={e => setMotivoCustom(e.target.value)}
                  placeholder="Describí el motivo..."
                  className="w-full mt-2 px-3 py-2 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400" />
              )}
            </div>
          </div>
        )}
      </ConeModal>
    </div>
  )
}
