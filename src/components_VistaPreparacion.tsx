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
  if (diff < 1) return 'Hace un momento'
  if (diff === 1) return 'Hace 1 min'
  return `Hace ${diff} min`
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
    setLoading(false)
  }, [dispositivo, verTodas])

  useEffect(() => {
    cargarPedidos()
    const supabase = createClient()
    const channel = supabase
      .channel(`prep-${dispositivo.sucursal_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pedidos',
        filter: `empresa_id=eq.${dispositivo.empresa_id}`,
      }, () => cargarPedidos())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [cargarPedidos, dispositivo])

  useEffect(() => {
    if (seleccionado) {
      const actualizado = pedidos.find(p => p.id === seleccionado.id)
      if (actualizado) setSeleccionado(actualizado)
      else setSeleccionado(null)
    }
  }, [pedidos, seleccionado])

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
  const enPreparacion = pedidos.filter(p => p.estado === 'PREPARING')

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex gap-3 mb-5">
          <div className="flex-1 bg-white rounded-xl border border-neutral-200 p-3 text-center">
            <p className="text-2xl font-bold text-neutral-800">{pedidos.length}</p>
            <p className="text-xs text-neutral-400 mt-0.5">Total activos</p>
          </div>
          <div className="flex-1 bg-blue-50 rounded-xl border border-blue-200 p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{nuevos.length}</p>
            <p className="text-xs text-blue-500 mt-0.5">Por preparar</p>
          </div>
          <div className="flex-1 bg-amber-50 rounded-xl border border-amber-200 p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">{enPreparacion.length}</p>
            <p className="text-xs text-amber-500 mt-0.5">Preparando</p>
          </div>
        </div>

        {pedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-300">
            <ChefHat className="h-12 w-12 mb-3" />
            <p className="text-sm">Sin pedidos para preparar</p>
          </div>
        ) : (
          <div className="space-y-6">
            {nuevos.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">Por preparar ({nuevos.length})</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {nuevos.map(pedido => (
                    <div key={pedido.id} onClick={() => setSeleccionado(seleccionado?.id === pedido.id ? null : pedido)}
                      className={`bg-white rounded-xl border-2 border-blue-200 shadow-sm overflow-hidden cursor-pointer transition-all ${seleccionado?.id === pedido.id ? 'ring-2 ring-blue-400' : 'hover:shadow-md'}`}>
                      <div className="bg-blue-50 px-4 py-2.5 flex items-center justify-between border-b border-blue-100">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-700 font-bold text-lg">#{pedido.numero_pedido}</span>
                          <span className="text-xs bg-blue-200 text-blue-700 px-1.5 py-0.5 rounded font-medium">NUEVO</span>
                        </div>
                        <div className="flex items-center gap-1 text-blue-400 text-xs">
                          <Clock className="h-3 w-3" />{tiempoRelativo(pedido.created_at)}
                        </div>
                      </div>
                      <div className="p-3 space-y-1.5">
                        {pedido.pedido_items.map(item => (
                          <div key={item.id}>
                            <p className="text-neutral-800 text-sm font-medium">{item.cantidad > 1 ? `${item.cantidad}x ` : ''}{item.nombre_producto_snap} — {item.nombre_presentacion_snap}</p>
                            {item.pedido_item_opciones.length > 0 && (
                              <p className="text-neutral-400 text-xs ml-2">{item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(', ')}</p>
                            )}
                          </div>
                        ))}
                        {pedido.notas && <p className="text-amber-600 text-xs">📝 {pedido.notas}</p>}
                      </div>
                      {verTodas && pedido.sucursales?.nombre && <div className="px-3 pb-1"><span className="text-xs text-neutral-400">📍 {pedido.sucursales.nombre}</span></div>}
                      <div className="px-3 pb-3">
                        <button onClick={e => { e.stopPropagation(); cambiarEstado(pedido.id, 'PREPARING') }} disabled={procesando === pedido.id}
                          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                          {procesando === pedido.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '🍦 Empezar preparación'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {enPreparacion.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">En preparación ({enPreparacion.length})</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {enPreparacion.map(pedido => (
                    <div key={pedido.id} onClick={() => setSeleccionado(seleccionado?.id === pedido.id ? null : pedido)}
                      className={`bg-white rounded-xl border-2 border-amber-200 shadow-sm overflow-hidden cursor-pointer transition-all ${seleccionado?.id === pedido.id ? 'ring-2 ring-amber-400' : 'hover:shadow-md'}`}>
                      <div className="bg-amber-50 px-4 py-2.5 flex items-center justify-between border-b border-amber-100">
                        <span className="text-amber-700 font-bold text-lg">#{pedido.numero_pedido}</span>
                        <div className="flex items-center gap-2">
                          {verTodas && pedido.sucursales?.nombre && <span className="text-xs bg-white px-1.5 py-0.5 rounded text-neutral-500">{pedido.sucursales.nombre}</span>}
                          <span className="text-amber-500 text-sm font-mono">{pedido.codigo_retiro}</span>
                        </div>
                      </div>
                      <div className="p-3 space-y-1.5">
                        {pedido.pedido_items.map(item => (
                          <div key={item.id}>
                            <p className="text-neutral-800 text-sm font-medium">{item.cantidad > 1 ? `${item.cantidad}x ` : ''}{item.nombre_producto_snap} — {item.nombre_presentacion_snap}</p>
                            {item.pedido_item_opciones.length > 0 && (
                              <p className="text-neutral-400 text-xs ml-2">{item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(', ')}</p>
                            )}
                          </div>
                        ))}
                        {pedido.notas && <p className="text-amber-600 text-xs">📝 {pedido.notas}</p>}
                      </div>
                      <div className="px-3 pb-3">
                        <button onClick={e => { e.stopPropagation(); cambiarEstado(pedido.id, 'READY') }} disabled={procesando === pedido.id}
                          className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
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

      {seleccionado && (
        <div className="w-72 border-l border-neutral-200 bg-white overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-neutral-800">Pedido #{seleccionado.numero_pedido}</h3>
            <button onClick={() => setSeleccionado(null)} className="text-neutral-400 hover:text-neutral-600 text-lg">✕</button>
          </div>
          <p className="text-neutral-400 text-xs mb-1">Retiro: <span className="font-mono font-bold text-neutral-700">{seleccionado.codigo_retiro}</span></p>
          <p className="text-neutral-400 text-xs mb-4">{tiempoRelativo(seleccionado.created_at)}</p>
          <div className="space-y-3">
            {seleccionado.pedido_items.map(item => (
              <div key={item.id} className="bg-neutral-50 rounded-lg p-3">
                <p className="text-neutral-800 text-sm font-semibold">{item.nombre_producto_snap}</p>
                <p className="text-neutral-500 text-xs">{item.nombre_presentacion_snap}</p>
                {item.pedido_item_opciones.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {item.pedido_item_opciones.map((op, i) => (
                      <li key={i} className="text-xs text-neutral-500">• {op.emoji_snap} {op.nombre_snap}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {seleccionado.notas && <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3"><p className="text-amber-700 text-sm">📝 {seleccionado.notas}</p></div>}
          <div className="mt-4 space-y-2">
            {seleccionado.estado === 'PAID' && (
              <button onClick={() => cambiarEstado(seleccionado.id, 'PREPARING')} disabled={procesando === seleccionado.id}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                🍦 Empezar preparación
              </button>
            )}
            {seleccionado.estado === 'PREPARING' && (
              <button onClick={() => cambiarEstado(seleccionado.id, 'READY')} disabled={procesando === seleccionado.id}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                ✓ Marcar listo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
