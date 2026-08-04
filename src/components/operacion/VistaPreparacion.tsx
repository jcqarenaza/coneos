'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ChefHat, CheckCircle, Clock } from 'lucide-react'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador { session_id: string; operador: { id: string; sucursal_id: string | null } }
interface OpcionItem { nombre_snap: string; emoji_snap: string | null }
interface PedidoItem { id: string; nombre_producto_snap: string; nombre_presentacion_snap: string; cantidad: number; pedido_item_opciones: OpcionItem[] }
interface Pedido { id: string; numero_pedido: number; codigo_retiro: string; estado: string; notas: string | null; created_at: string; sucursales?: { nombre: string }; pedido_items: PedidoItem[] }

function tiempoRelativo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (diff < 1) return 'Ahora'
  if (diff === 1) return '1 min'
  return `${diff} min`
}

export default function VistaPreparacion({ dispositivo, sesion }: { dispositivo: Dispositivo; sesion: SesionOperador }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [seleccionado, setSeleccionado] = useState<Pedido | null>(null)
  const verTodas = sesion.operador.sucursal_id === null

  const cargarPedidos = useCallback(async () => {
    const supabase = createClient()
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    let query = supabase
      .from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, notas, created_at,
        sucursales(nombre),
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PAID', 'PREPARING'])
      .order('numero_pedido', { ascending: true })
    if (!verTodas) query = query.eq('sucursal_id', dispositivo.sucursal_id)
    const { data } = await query
    const nuevos = (data ?? []) as Pedido[]
    setPedidos(nuevos)
    if (seleccionado) {
      const act = nuevos.find(p => p.id === seleccionado.id)
      if (act) setSeleccionado(act); else setSeleccionado(null)
    }
    setLoading(false)
  }, [dispositivo, verTodas, seleccionado])

  useEffect(() => {
    cargarPedidos()
    const supabase = createClient()
    const channel = supabase.channel(`prep-${dispositivo.sucursal_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `empresa_id=eq.${dispositivo.empresa_id}` }, cargarPedidos)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [cargarPedidos, dispositivo])

  async function cambiarEstado(pedidoId: string, estadoNuevo: string) {
    setProcesando(pedidoId)
    await fetch('/api/pedidos/estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: pedidoId, estado_nuevo: estadoNuevo, operador_id: sesion.operador.id }),
    })
    setProcesando(null)
  }

  const nuevos = pedidos.filter(p => p.estado === 'PAID')
  const preparando = pedidos.filter(p => p.estado === 'PREPARING')

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-200" /></div>

  return (
    <div className="h-full flex overflow-hidden bg-neutral-50">
      <div className="flex-1 overflow-y-auto p-5">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-2xl border border-neutral-100 p-4 text-center shadow-sm">
            <p className="text-3xl font-black text-neutral-800">{pedidos.length}</p>
            <p className="text-xs text-neutral-400 mt-0.5 font-medium">Total activos</p>
          </div>
          <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 text-center shadow-sm">
            <p className="text-3xl font-black text-blue-600">{nuevos.length}</p>
            <p className="text-xs text-blue-400 mt-0.5 font-medium">Por preparar</p>
          </div>
          <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4 text-center shadow-sm">
            <p className="text-3xl font-black text-amber-600">{preparando.length}</p>
            <p className="text-xs text-amber-400 mt-0.5 font-medium">Preparando</p>
          </div>
        </div>

        {pedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-neutral-200">
            <ChefHat className="h-14 w-14 mb-3" />
            <p className="text-sm font-medium">Sin pedidos para preparar</p>
          </div>
        ) : (
          <div className="space-y-6">
            {nuevos.length > 0 && (
              <div>
                <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3">Por preparar</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {nuevos.map(pedido => (
                    <div key={pedido.id} onClick={() => setSeleccionado(s => s?.id === pedido.id ? null : pedido)}
                      className={`bg-white rounded-2xl border-2 border-blue-100 shadow-sm overflow-hidden cursor-pointer transition-all hover:shadow-md ${seleccionado?.id === pedido.id ? 'ring-2 ring-blue-300' : ''}`}>
                      <div className="bg-blue-50 px-4 py-3 flex items-center justify-between border-b border-blue-100">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-700 font-black text-xl">#{pedido.numero_pedido}</span>
                          <span className="text-xs bg-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-bold">NUEVO</span>
                        </div>
                        <div className="flex items-center gap-1 text-blue-400 text-xs font-medium">
                          <Clock className="h-3 w-3" />{tiempoRelativo(pedido.created_at)}
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        {pedido.pedido_items.map(item => (
                          <div key={item.id}>
                            <p className="text-neutral-800 text-sm font-bold">{item.cantidad > 1 ? `${item.cantidad}× ` : ''}{item.nombre_producto_snap} <span className="font-normal text-neutral-500">— {item.nombre_presentacion_snap}</span></p>
                            {item.pedido_item_opciones.length > 0 && (
                              <p className="text-neutral-400 text-xs mt-0.5 ml-0.5">{item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(' · ')}</p>
                            )}
                          </div>
                        ))}
                        {pedido.notas && <p className="text-amber-600 text-xs font-medium">📝 {pedido.notas}</p>}
                      </div>
                      {verTodas && pedido.sucursales?.nombre && <div className="px-4 pb-1"><span className="text-xs text-neutral-300">📍 {pedido.sucursales.nombre}</span></div>}
                      <div className="px-4 pb-4">
                        <button onClick={e => { e.stopPropagation(); cambiarEstado(pedido.id, 'PREPARING') }} disabled={procesando === pedido.id}
                          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                          {procesando === pedido.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '🍦 Empezar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preparando.length > 0 && (
              <div>
                <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3">En preparación</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {preparando.map(pedido => (
                    <div key={pedido.id} onClick={() => setSeleccionado(s => s?.id === pedido.id ? null : pedido)}
                      className={`bg-white rounded-2xl border-2 border-amber-100 shadow-sm overflow-hidden cursor-pointer transition-all hover:shadow-md ${seleccionado?.id === pedido.id ? 'ring-2 ring-amber-300' : ''}`}>
                      <div className="bg-amber-50 px-4 py-3 flex items-center justify-between border-b border-amber-100">
                        <span className="text-amber-700 font-black text-xl">#{pedido.numero_pedido}</span>
                        <div className="flex items-center gap-2">
                          {verTodas && pedido.sucursales?.nombre && <span className="text-xs bg-white px-2 py-0.5 rounded-full text-neutral-400 font-medium">{pedido.sucursales.nombre}</span>}
                          <span className="text-amber-500 text-sm font-mono font-bold">{pedido.codigo_retiro}</span>
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        {pedido.pedido_items.map(item => (
                          <div key={item.id}>
                            <p className="text-neutral-800 text-sm font-bold">{item.cantidad > 1 ? `${item.cantidad}× ` : ''}{item.nombre_producto_snap} <span className="font-normal text-neutral-500">— {item.nombre_presentacion_snap}</span></p>
                            {item.pedido_item_opciones.length > 0 && (
                              <p className="text-neutral-400 text-xs mt-0.5">{item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(' · ')}</p>
                            )}
                          </div>
                        ))}
                        {pedido.notas && <p className="text-amber-600 text-xs font-medium">📝 {pedido.notas}</p>}
                      </div>
                      <div className="px-4 pb-4">
                        <button onClick={e => { e.stopPropagation(); cambiarEstado(pedido.id, 'READY') }} disabled={procesando === pedido.id}
                          className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                          {procesando === pedido.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle className="h-4 w-4" /> Marcar listo</>}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Panel detalle */}
      {seleccionado && (
        <div className="w-72 border-l border-neutral-100 bg-white overflow-y-auto p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black text-neutral-800 text-lg">#{seleccionado.numero_pedido}</h3>
            <button onClick={() => setSeleccionado(null)} className="text-neutral-300 hover:text-neutral-500 transition-colors text-xl">✕</button>
          </div>
          <p className="text-neutral-400 text-xs mb-0.5">Código: <span className="font-mono font-bold text-neutral-700">{seleccionado.codigo_retiro}</span></p>
          <p className="text-neutral-300 text-xs mb-5">{tiempoRelativo(seleccionado.created_at)}</p>
          <div className="space-y-3">
            {seleccionado.pedido_items.map(item => (
              <div key={item.id} className="bg-neutral-50 rounded-xl p-3">
                <p className="text-neutral-800 text-sm font-bold">{item.nombre_producto_snap}</p>
                <p className="text-neutral-400 text-xs">{item.nombre_presentacion_snap}</p>
                {item.pedido_item_opciones.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {item.pedido_item_opciones.map((op, i) => (
                      <li key={i} className="text-xs text-neutral-500">• {op.emoji_snap} {op.nombre_snap}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {seleccionado.notas && <div className="mt-3 bg-amber-50 rounded-xl p-3"><p className="text-amber-700 text-sm">📝 {seleccionado.notas}</p></div>}
          <div className="mt-4 space-y-2">
            {seleccionado.estado === 'PAID' && (
              <button onClick={() => cambiarEstado(seleccionado.id, 'PREPARING')} disabled={procesando === seleccionado.id}
                className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">🍦 Empezar</button>
            )}
            {seleccionado.estado === 'PREPARING' && (
              <button onClick={() => cambiarEstado(seleccionado.id, 'READY')} disabled={procesando === seleccionado.id}
                className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">✓ Marcar listo</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
