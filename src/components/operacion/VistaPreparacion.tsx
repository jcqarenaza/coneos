'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ChefHat, CheckCircle } from 'lucide-react'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador { session_id: string; operador: { id: string } }

interface Pedido {
  id: string
  numero_pedido: number
  codigo_retiro: string
  estado: string
  notas: string | null
  pedido_items: {
    id: string
    nombre_producto_snap: string
    nombre_presentacion_snap: string
    cantidad: number
    pedido_item_opciones: { nombre_snap: string; emoji_snap: string | null }[]
  }[]
}

export default function VistaPreparacion({ dispositivo, sesion }: { dispositivo: Dispositivo; sesion: SesionOperador }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)

  const cargarPedidos = useCallback(async () => {
    const supabase = createClient()
    const hoy = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, notas,
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('sucursal_id', dispositivo.sucursal_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PAID', 'PREPARING'])
      .order('numero_pedido', { ascending: true })
    setPedidos((data ?? []) as Pedido[])
    setLoading(false)
  }, [dispositivo])

  useEffect(() => {
    cargarPedidos()
    const interval = setInterval(cargarPedidos, 10000)
    return () => clearInterval(interval)
  }, [cargarPedidos])

  async function cambiarEstado(pedidoId: string, estadoNuevo: string) {
    setProcesando(pedidoId)
    await fetch('/api/pedidos/estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido_id: pedidoId, estado_nuevo: estadoNuevo, operador_id: sesion.operador.id }),
    })
    await cargarPedidos()
    setProcesando(null)
  }

  const pagados = pedidos.filter(p => p.estado === 'PAID')
  const preparando = pedidos.filter(p => p.estado === 'PREPARING')

  return (
    <div className="h-full overflow-y-auto p-4">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
      ) : pedidos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-neutral-300">
          <ChefHat className="h-12 w-12 mb-3" />
          <p className="text-sm">Sin pedidos para preparar</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pagados.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">Por preparar ({pagados.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pagados.map(pedido => (
                  <div key={pedido.id} className="bg-white rounded-xl border-2 border-blue-200 shadow-sm overflow-hidden">
                    <div className="bg-blue-50 px-4 py-2.5 flex items-center justify-between border-b border-blue-200">
                      <span className="text-blue-700 font-bold text-lg">#{pedido.numero_pedido}</span>
                      <span className="text-blue-500 text-sm">Código: {pedido.codigo_retiro}</span>
                    </div>
                    <div className="p-4 space-y-2">
                      {pedido.pedido_items.map(item => (
                        <div key={item.id}>
                          <p className="text-neutral-800 text-sm font-medium">{item.cantidad}x {item.nombre_producto_snap} — {item.nombre_presentacion_snap}</p>
                          {item.pedido_item_opciones.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.pedido_item_opciones.map((op, i) => (
                                <span key={i} className="text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded">
                                  {op.emoji_snap} {op.nombre_snap}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {pedido.notas && <p className="text-amber-600 text-xs">📝 {pedido.notas}</p>}
                    </div>
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => cambiarEstado(pedido.id, 'PREPARING')}
                        disabled={procesando === pedido.id}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {procesando === pedido.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '🍦 Tomar pedido'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preparando.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">En preparación ({preparando.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {preparando.map(pedido => (
                  <div key={pedido.id} className="bg-white rounded-xl border-2 border-amber-200 shadow-sm overflow-hidden">
                    <div className="bg-amber-50 px-4 py-2.5 flex items-center justify-between border-b border-amber-200">
                      <span className="text-amber-700 font-bold text-lg">#{pedido.numero_pedido}</span>
                      <span className="text-amber-500 text-sm">Código: {pedido.codigo_retiro}</span>
                    </div>
                    <div className="p-4 space-y-2">
                      {pedido.pedido_items.map(item => (
                        <div key={item.id}>
                          <p className="text-neutral-800 text-sm font-medium">{item.cantidad}x {item.nombre_producto_snap} — {item.nombre_presentacion_snap}</p>
                          {item.pedido_item_opciones.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.pedido_item_opciones.map((op, i) => (
                                <span key={i} className="text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded">
                                  {op.emoji_snap} {op.nombre_snap}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {pedido.notas && <p className="text-amber-600 text-xs">📝 {pedido.notas}</p>}
                    </div>
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => cambiarEstado(pedido.id, 'READY')}
                        disabled={procesando === pedido.id}
                        className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
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
  )
}
