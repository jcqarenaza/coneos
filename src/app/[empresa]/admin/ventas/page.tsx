'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader } from '@/components/admin/ConeComponents'
import { Loader2, TrendingUp, ShoppingBag, BarChart3, CreditCard } from 'lucide-react'

interface Sucursal { id: string; nombre: string }
interface PedidoVenta {
  id: string; total: number; metodo_pago: string | null; estado: string
  created_at: string; fecha_pedido: string; sucursal_id: string
  pedido_items: { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number }[]
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function formatFecha(f: string) {
  const d = new Date(f + 'T00:00:00-03:00')
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const METODO_LABEL: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', mp: 'Mercado Pago' }

export default function VentasPage() {
  const { ctx } = useEmpresa()
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [pedidos, setPedidos] = useState<PedidoVenta[]>([])
  const [loading, setLoading] = useState(true)
  const [sucursalFiltro, setSucursalFiltro] = useState<string>('todas')
  const [metodoPagoFiltro, setMetodoPagoFiltro] = useState<string>('todos')
  const [rango, setRango] = useState<'hoy' | 'ayer' | '7dias' | '30dias' | 'custom'>('hoy')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

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

    let query = supabase
      .from('pedidos')
      .select(`id, total, metodo_pago, estado, created_at, fecha_pedido, sucursal_id,
        pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad)`)
      .eq('empresa_id', ctx.empresaId)
      .in('estado', ['PAID', 'PREPARING', 'READY', 'DELIVERED'])
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

  useEffect(() => { cargar() }, [ctx, rango, sucursalFiltro, metodoPagoFiltro, fechaDesde, fechaHasta])

  const totalFacturacion = pedidos.reduce((acc, p) => acc + Number(p.total), 0)
  const ticketPromedio = pedidos.length > 0 ? totalFacturacion / pedidos.length : 0

  // Agrupado por producto
  const porProducto: Record<string, { nombre: string; cantidad: number; total: number }> = {}
  pedidos.forEach(p => {
    p.pedido_items?.forEach(item => {
      const key = item.nombre_producto_snap
      if (!porProducto[key]) porProducto[key] = { nombre: key, cantidad: 0, total: 0 }
      porProducto[key].cantidad += item.cantidad
      porProducto[key].total += Number(item.precio_snap) * item.cantidad
    })
  })
  const rankingProductos = Object.values(porProducto).sort((a, b) => b.total - a.total).slice(0, 8)

  // Por método de pago
  const porMetodo: Record<string, number> = {}
  pedidos.forEach(p => {
    const m = p.metodo_pago ?? 'otro'
    porMetodo[m] = (porMetodo[m] ?? 0) + Number(p.total)
  })

  const RANGOS = [
    { key: 'hoy', label: 'Hoy' },
    { key: 'ayer', label: 'Ayer' },
    { key: '7dias', label: '7 días' },
    { key: '30dias', label: '30 días' },
    { key: 'custom', label: 'Personalizado' },
  ]

  return (
    <div>
      <ConePageHeader title="Ventas" description="Reportes y estadísticas de ventas" />

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Rango */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Período</p>
            <div className="flex gap-1.5">
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

          {/* Sucursal */}
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

          {/* Método de pago */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Método de pago</p>
            <select value={metodoPagoFiltro} onChange={e => setMetodoPagoFiltro(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400 bg-white">
              <option value="todos">Todos</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="mp">Mercado Pago</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
      ) : (
        <>
          {/* Stats */}
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
              <p className="text-2xl font-black text-neutral-800">{pedidos.length}</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Ranking productos */}
            <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-50">
                <h3 className="font-bold text-neutral-700">Productos más vendidos</h3>
              </div>
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

            {/* Últimos pedidos */}
            <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-50">
                <h3 className="font-bold text-neutral-700">Últimos pedidos</h3>
              </div>
              {pedidos.length === 0 ? (
                <div className="px-5 py-10 text-center text-neutral-300 text-sm">Sin pedidos en el período</div>
              ) : (
                <div className="divide-y divide-neutral-50 max-h-80 overflow-y-auto">
                  {pedidos.slice(0, 20).map(p => (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-neutral-800 text-sm font-bold">#{p.id.slice(-4).toUpperCase()}</p>
                        <p className="text-neutral-400 text-xs">{formatFecha(p.fecha_pedido)} · {METODO_LABEL[p.metodo_pago ?? ''] ?? p.metodo_pago ?? '—'}</p>
                      </div>
                      <p className="text-neutral-700 font-bold text-sm">{formatPrecio(Number(p.total))}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
