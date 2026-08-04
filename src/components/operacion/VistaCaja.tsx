'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, ShoppingBag, Loader2, RefreshCw, CheckCircle } from 'lucide-react'
import NuevoPedido from './NuevoPedido'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador { session_id: string; operador: { id: string; nombre: string; puede_cobrar: boolean; puede_preparar: boolean; sucursal_id: string | null } }
interface OpcionItem { nombre_snap: string; emoji_snap: string | null }
interface PedidoItem { id: string; nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones: OpcionItem[] }
interface Pedido { id: string; numero_pedido: number; codigo_retiro: string; estado: string; total: number; metodo_pago: string | null; notas: string | null; created_at: string; sucursales?: { nombre: string }; pedido_items: PedidoItem[] }

const ESTADO_LABEL: Record<string, string> = { PENDING_PAYMENT: 'Pendiente', PAID: 'Pagado', PREPARING: 'Preparando', READY: 'Listo' }
const ESTADO_DOT: Record<string, string> = { PENDING_PAYMENT: 'bg-red-400', PAID: 'bg-blue-400', PREPARING: 'bg-amber-400', READY: 'bg-green-400' }
const ESTADO_BADGE: Record<string, string> = { PENDING_PAYMENT: 'bg-red-50 text-red-700', PAID: 'bg-blue-50 text-blue-700', PREPARING: 'bg-amber-50 text-amber-700', READY: 'bg-green-50 text-green-700' }
const ESTADO_LEFT: Record<string, string> = { PENDING_PAYMENT: 'border-l-red-300', PAID: 'border-l-blue-300', PREPARING: 'border-l-amber-300', READY: 'border-l-green-300' }

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
  const [tab, setTab] = useState<'activos' | 'nuevo'>('activos')
  const [seleccionado, setSeleccionado] = useState<Pedido | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [entregado, setEntregado] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null)
  const verTodas = sesion.operador.sucursal_id === null

  const cargarPedidos = useCallback(async () => {
    const supabase = createClient()
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    let query = supabase
      .from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, total, metodo_pago, notas, created_at,
        sucursales(nombre),
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY'])
      .order('numero_pedido', { ascending: false })
    if (!verTodas) query = query.eq('sucursal_id', dispositivo.sucursal_id)
    const { data } = await query
    setPedidos((data ?? []) as Pedido[])
    setLoading(false)
  }, [dispositivo, verTodas])

  useEffect(() => {
    cargarPedidos()
    const supabase = createClient()
    const channel = supabase.channel(`caja-${dispositivo.sucursal_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `empresa_id=eq.${dispositivo.empresa_id}` }, cargarPedidos)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [cargarPedidos, dispositivo])

  useEffect(() => {
    if (seleccionado) {
      const actualizado = pedidos.find(p => p.id === seleccionado.id)
      if (actualizado) setSeleccionado(actualizado)
    }
  }, [pedidos, seleccionado])

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
        <button onClick={() => setTab('nuevo')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'nuevo' ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-neutral-400'}`}>
          <Plus className="h-4 w-4" />
          Nuevo
        </button>
      </div>

      {tab === 'nuevo' ? (
        <NuevoPedido dispositivo={dispositivo} sesion={sesion} onPedidoCreado={() => setTab('activos')} />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r border-neutral-100 flex flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-50">
              <p className="text-xs font-semibold text-neutral-400">{pedidosFiltrados.length} pedido{pedidosFiltrados.length !== 1 ? 's' : ''}</p>
              <button onClick={cargarPedidos} className="p-1 text-neutral-300 hover:text-neutral-500 transition-colors"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-neutral-200" /></div>
              ) : pedidosFiltrados.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-neutral-200">
                  <ShoppingBag className="h-8 w-8 mb-2" /><p className="text-xs">Sin pedidos</p>
                </div>
              ) : pedidosFiltrados.map(pedido => (
                <button key={pedido.id} onClick={() => { setSeleccionado(pedido); setEntregado(false) }}
                  className={`w-full text-left px-4 py-3 border-b border-neutral-50 border-l-4 transition-colors ${seleccionado?.id === pedido.id ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50/50'} ${ESTADO_LEFT[pedido.estado]}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-neutral-800 text-base">#{pedido.numero_pedido}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ESTADO_BADGE[pedido.estado]}`}>{ESTADO_LABEL[pedido.estado]}</span>
                  </div>
                  <p className="text-neutral-400 text-xs truncate mb-1">{pedido.pedido_items.map(i => i.nombre_producto_snap).join(', ')}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-300 text-xs">{tiempoRelativo(pedido.created_at)}</span>
                    <span className="text-neutral-600 text-xs font-bold">{formatPrecio(pedido.total)}</span>
                  </div>
                </button>
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
                  {seleccionado.pedido_items.map((item, i) => (
                    <div key={item.id} className={`p-4 ${i < seleccionado.pedido_items.length - 1 ? 'border-b border-neutral-50' : ''}`}>
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
                  <div className="px-4 py-3 bg-neutral-50 border-t border-neutral-100 flex justify-between">
                    <span className="text-neutral-500 font-medium">Total</span>
                    <span className="text-neutral-900 font-black text-lg">{formatPrecio(seleccionado.total)}</span>
                  </div>
                </div>

                {seleccionado.notas && (
                  <div className="mb-4 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <p className="text-amber-700 text-sm">📝 {seleccionado.notas}</p>
                  </div>
                )}

                <div className="space-y-2">
                  {seleccionado.estado === 'PENDING_PAYMENT' && (<>
                    <button onClick={() => cambiarEstado(seleccionado.id, 'PAID')} disabled={procesando}
                      className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
                      {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : '✓ Cobrar efectivo'}
                    </button>
                    <button onClick={() => cambiarEstado(seleccionado.id, 'PAID')} disabled={procesando}
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
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
