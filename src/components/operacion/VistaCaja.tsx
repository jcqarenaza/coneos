'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, ShoppingBag, Loader2, RefreshCw } from 'lucide-react'
import NuevoPedido from './NuevoPedido'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador {
  session_id: string
  operador: { id: string; nombre: string; puede_cobrar: boolean; puede_preparar: boolean; sucursal_id: string | null }
}

interface OpcionItem { nombre_snap: string; emoji_snap: string | null }
interface PedidoItem {
  id: string
  nombre_producto_snap: string
  nombre_presentacion_snap: string
  precio_snap: number
  cantidad: number
  pedido_item_opciones: OpcionItem[]
}

interface Pedido {
  id: string
  numero_pedido: number
  codigo_retiro: string
  estado: string
  total: number
  metodo_pago: string | null
  origen: string
  notas: string | null
  created_at: string
  sucursales?: { nombre: string }
  pedido_items: PedidoItem[]
}

const ESTADO_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'PENDIENTE PAGO',
  PAID: 'PAGADO',
  PREPARING: 'EN PREPARACIÓN',
  READY: 'LISTO',
}

const ESTADO_COLOR: Record<string, string> = {
  PENDING_PAYMENT: 'bg-red-100 text-red-700',
  PAID: 'bg-blue-100 text-blue-700',
  PREPARING: 'bg-amber-100 text-amber-700',
  READY: 'bg-green-100 text-green-700',
}

const ESTADO_BORDER: Record<string, string> = {
  PENDING_PAYMENT: 'border-l-red-400',
  PAID: 'border-l-blue-400',
  PREPARING: 'border-l-amber-400',
  READY: 'border-l-green-400',
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function tiempoRelativo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (diff < 1) return 'Hace un momento'
  if (diff === 1) return 'Hace 1 min'
  return `Hace ${diff} min`
}

export default function VistaCaja({ dispositivo, sesion }: { dispositivo: Dispositivo; sesion: SesionOperador }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'activos' | 'nuevo'>('activos')
  const [seleccionado, setSeleccionado] = useState<Pedido | null>(null)
  const [procesando, setProcesando] = useState(false)
  const verTodas = sesion.operador.sucursal_id === null

  const cargarPedidos = useCallback(async () => {
    const supabase = createClient()
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    let query = supabase
      .from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, total, metodo_pago, origen, notas, created_at,
        sucursales(nombre),
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY'])
      .order('numero_pedido', { ascending: false })
    if (!verTodas) query = query.eq('sucursal_id', dispositivo.sucursal_id)
    const { data } = await query
    const nuevos = (data ?? []) as Pedido[]
    setPedidos(nuevos)
    // Actualizar seleccionado si sigue existiendo
    if (seleccionado) {
      const actualizado = nuevos.find(p => p.id === seleccionado.id)
      if (actualizado) setSeleccionado(actualizado)
    }
    setLoading(false)
  }, [dispositivo, verTodas, seleccionado])

  useEffect(() => {
    cargarPedidos()
    const interval = setInterval(cargarPedidos, 15000)
    return () => clearInterval(interval)
  }, [cargarPedidos])

  async function cambiarEstado(pedidoId: string, estadoNuevo: string) {
    setProcesando(true)
    await fetch('/api/pedidos/estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: pedidoId, estado_nuevo: estadoNuevo, operador_id: sesion.operador.id }),
    })
    await cargarPedidos()
    setProcesando(false)
  }

  const tabs = [
    { key: 'PENDING_PAYMENT', label: 'Pendientes', color: 'text-red-600' },
    { key: 'PAID', label: 'Pagados', color: 'text-blue-600' },
    { key: 'PREPARING', label: 'Preparación', color: 'text-amber-600' },
    { key: 'READY', label: 'Listos', color: 'text-green-600' },
  ]

  const counts = tabs.reduce((acc, t) => ({ ...acc, [t.key]: pedidos.filter(p => p.estado === t.key).length }), {} as Record<string, number>)
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null)
  const pedidosFiltrados = filtroEstado ? pedidos.filter(p => p.estado === filtroEstado) : pedidos

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tabs superiores */}
      <div className="flex bg-white border-b border-neutral-200 px-4 gap-1">
        <button onClick={() => { setTab('activos'); setFiltroEstado(null) }}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === 'activos' && !filtroEstado ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}>
          <ShoppingBag className="h-4 w-4" />
          Todos
          {pedidos.length > 0 && <span className="bg-neutral-800 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{pedidos.length}</span>}
        </button>
        {tabs.map(t => counts[t.key] > 0 && (
          <button key={t.key} onClick={() => { setTab('activos'); setFiltroEstado(t.key) }}
            className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${filtroEstado === t.key ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}>
            {t.label}
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full bg-neutral-100 ${t.color}`}>{counts[t.key]}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setTab('nuevo')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === 'nuevo' ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}>
          <Plus className="h-4 w-4" /> Nuevo pedido
        </button>
      </div>

      {tab === 'nuevo' ? (
        <NuevoPedido dispositivo={dispositivo} sesion={sesion} onPedidoCreado={() => { setTab('activos'); cargarPedidos() }} />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Lista izquierda */}
          <div className="w-72 border-r border-neutral-200 flex flex-col overflow-hidden bg-neutral-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">{pedidosFiltrados.length} pedidos</p>
              <button onClick={cargarPedidos} className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-neutral-300" /></div>
              ) : pedidosFiltrados.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-neutral-300">
                  <ShoppingBag className="h-8 w-8 mb-2" />
                  <p className="text-xs">Sin pedidos</p>
                </div>
              ) : pedidosFiltrados.map(pedido => (
                <button key={pedido.id} onClick={() => setSeleccionado(pedido)}
                  className={`w-full text-left px-3 py-3 border-b border-neutral-100 border-l-4 hover:bg-white transition-colors ${seleccionado?.id === pedido.id ? 'bg-white shadow-sm' : 'bg-transparent'} ${ESTADO_BORDER[pedido.estado]}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-neutral-800">#{pedido.numero_pedido}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ESTADO_COLOR[pedido.estado]}`}>{ESTADO_LABEL[pedido.estado]}</span>
                  </div>
                  <p className="text-neutral-500 text-xs truncate">
                    {pedido.pedido_items.map(i => i.nombre_producto_snap).join(', ')}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-neutral-400 text-xs">{tiempoRelativo(pedido.created_at)}</span>
                    <span className="text-neutral-700 text-xs font-semibold">{formatPrecio(pedido.total)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Detalle derecho */}
          <div className="flex-1 overflow-y-auto p-6">
            {!seleccionado ? (
              <div className="flex flex-col items-center justify-center h-full text-neutral-300">
                <ShoppingBag className="h-12 w-12 mb-3" />
                <p className="text-sm">Seleccioná un pedido para ver el detalle</p>
              </div>
            ) : (
              <div className="max-w-lg">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-neutral-800">Pedido #{seleccionado.numero_pedido}</h2>
                    <p className="text-neutral-400 text-sm">{tiempoRelativo(seleccionado.created_at)} · Código: {seleccionado.codigo_retiro}</p>
                    {verTodas && seleccionado.sucursales?.nombre && (
                      <p className="text-neutral-400 text-xs mt-0.5">📍 {seleccionado.sucursales.nombre}</p>
                    )}
                  </div>
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-bold ${ESTADO_COLOR[seleccionado.estado]}`}>
                    {ESTADO_LABEL[seleccionado.estado]}
                  </span>
                </div>

                {/* Items */}
                <div className="bg-white rounded-xl border border-neutral-200 mb-4 overflow-hidden">
                  {seleccionado.pedido_items.map((item, i) => (
                    <div key={item.id} className={`p-4 ${i < seleccionado.pedido_items.length - 1 ? 'border-b border-neutral-100' : ''}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="text-neutral-800 font-semibold">{item.nombre_producto_snap}</p>
                          <p className="text-neutral-500 text-sm">{item.nombre_presentacion_snap}</p>
                          {item.pedido_item_opciones.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {item.pedido_item_opciones.map((op, j) => (
                                <span key={j} className="text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">
                                  {op.emoji_snap} {op.nombre_snap}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="text-neutral-700 font-bold ml-4">{formatPrecio(item.precio_snap)}</p>
                      </div>
                    </div>
                  ))}
                  <div className="px-4 py-3 bg-neutral-50 flex justify-between items-center border-t border-neutral-200">
                    <span className="text-neutral-600 font-medium">Total</span>
                    <span className="text-neutral-900 font-bold text-lg">{formatPrecio(seleccionado.total)}</span>
                  </div>
                </div>

                {/* Método de pago */}
                {seleccionado.metodo_pago && (
                  <div className="mb-4 flex items-center gap-2 text-neutral-500 text-sm">
                    <span>💳</span>
                    <span className="capitalize">{seleccionado.metodo_pago === 'efectivo' ? 'Efectivo' : seleccionado.metodo_pago === 'transferencia' ? 'Transferencia' : 'Mercado Pago'}</span>
                  </div>
                )}

                {seleccionado.notas && (
                  <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                    <p className="text-amber-700 text-sm">📝 {seleccionado.notas}</p>
                  </div>
                )}

                {/* Acciones */}
                <div className="space-y-2">
                  {seleccionado.estado === 'PENDING_PAYMENT' && (
                    <>
                      <button onClick={() => cambiarEstado(seleccionado.id, 'PAID')} disabled={procesando}
                        className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                        {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : '✓ Cobrar efectivo'}
                      </button>
                      <button onClick={() => cambiarEstado(seleccionado.id, 'PAID')} disabled={procesando}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50">
                        📱 Cobrar transferencia
                      </button>
                    </>
                  )}
                  {seleccionado.estado === 'PAID' && (
                    <button onClick={() => cambiarEstado(seleccionado.id, 'PREPARING')} disabled={procesando}
                      className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                      {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : '🍦 Enviar a preparación'}
                    </button>
                  )}
                  {seleccionado.estado === 'PREPARING' && (
                    <button onClick={() => cambiarEstado(seleccionado.id, 'READY')} disabled={procesando}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                      {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : '✓ Marcar listo'}
                    </button>
                  )}
                  {seleccionado.estado === 'READY' && (
                    <button onClick={() => cambiarEstado(seleccionado.id, 'DELIVERED')} disabled={procesando}
                      className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50">
                      ✓ Entregado
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
