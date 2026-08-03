'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, ShoppingBag, Loader2, CheckCircle, Clock, ChefHat } from 'lucide-react'
import NuevoPedido from './NuevoPedido'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador { session_id: string; operador: { id: string; nombre: string } }

interface Pedido {
  id: string
  numero_pedido: number
  codigo_retiro: string
  estado: string
  total: number
  metodo_pago: string | null
  origen: string
  created_at: string
  notas: string | null
  pedido_items: {
    id: string
    nombre_producto_snap: string
    nombre_presentacion_snap: string
    precio_snap: number
    cantidad: number
    pedido_item_opciones: { nombre_snap: string; emoji_snap: string | null }[]
  }[]
}

const ESTADO_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING_PAYMENT: { label: 'Pendiente de pago', color: 'bg-amber-500', icon: <Clock className="h-4 w-4" /> },
  PAID:           { label: 'Pagado',             color: 'bg-blue-500',  icon: <CheckCircle className="h-4 w-4" /> },
  PREPARING:      { label: 'En preparación',     color: 'bg-purple-500',icon: <ChefHat className="h-4 w-4" /> },
  READY:          { label: 'Listo',              color: 'bg-green-500', icon: <CheckCircle className="h-4 w-4" /> },
}

const SIGUIENTE_ESTADO: Record<string, string> = {
  PENDING_PAYMENT: 'PAID',
  PAID: 'PREPARING',
  PREPARING: 'READY',
  READY: 'DELIVERED',
}

const LABEL_ACCION: Record<string, string> = {
  PENDING_PAYMENT: 'Confirmar pago',
  PAID: 'Enviar a preparación',
  PREPARING: 'Marcar listo',
  READY: 'Entregado',
}

export default function VistaCaja({ dispositivo, sesion }: { dispositivo: Dispositivo; sesion: SesionOperador }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'activos' | 'nuevo'>('activos')
  const [procesando, setProcesando] = useState<string | null>(null)

  const cargarPedidos = useCallback(async () => {
    const supabase = createClient()
    const hoy = new Date().toISOString().split('T')[0]

    const { data } = await supabase
      .from('pedidos')
      .select(`
        id, numero_pedido, codigo_retiro, estado, total, metodo_pago, origen, created_at, notas,
        pedido_items(id, nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))
      `)
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('sucursal_id', dispositivo.sucursal_id)
      .eq('fecha_pedido', hoy)
      .in('estado', ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY'])
      .order('numero_pedido', { ascending: true })

    setPedidos((data ?? []) as Pedido[])
    setLoading(false)
  }, [dispositivo])

  useEffect(() => {
    cargarPedidos()
    // Polling cada 15 segundos hasta implementar Realtime
    const interval = setInterval(cargarPedidos, 15000)
    return () => clearInterval(interval)
  }, [cargarPedidos])

  async function cambiarEstado(pedidoId: string, estadoActual: string) {
    const siguiente = SIGUIENTE_ESTADO[estadoActual]
    if (!siguiente) return
    setProcesando(pedidoId)

    await fetch('/api/pedidos/estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pedido_id: pedidoId,
        estado_nuevo: siguiente,
        operador_id: sesion.operador.id,
      }),
    })

    await cargarPedidos()
    setProcesando(null)
  }

  const formatPrecio = (n: number) => `$${Number(n).toLocaleString('es-AR')}`

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex bg-neutral-900 border-b border-neutral-800 px-4">
        <button
          onClick={() => setTab('activos')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'activos' ? 'border-white text-white' : 'border-transparent text-neutral-400 hover:text-white'
          }`}
        >
          <ShoppingBag className="h-4 w-4" />
          Pedidos activos
          {pedidos.length > 0 && (
            <span className="bg-white text-neutral-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
              {pedidos.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('nuevo')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'nuevo' ? 'border-white text-white' : 'border-transparent text-neutral-400 hover:text-white'
          }`}
        >
          <Plus className="h-4 w-4" />
          Nuevo pedido
        </button>
      </div>

      {/* Contenido */}
      {tab === 'activos' ? (
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          ) : pedidos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
              <ShoppingBag className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">Sin pedidos activos</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pedidos.map(pedido => {
                const config = ESTADO_CONFIG[pedido.estado]
                return (
                  <div key={pedido.id} className="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden">
                    {/* Header pedido */}
                    <div className={`px-4 py-3 flex items-center justify-between ${config?.color ?? 'bg-neutral-700'}`}>
                      <div className="flex items-center gap-2 text-white">
                        {config?.icon}
                        <span className="font-bold text-lg">#{pedido.numero_pedido}</span>
                        <span className="text-sm opacity-80">— {pedido.codigo_retiro}</span>
                      </div>
                      <span className="text-white text-xs opacity-80">{pedido.origen}</span>
                    </div>

                    {/* Items */}
                    <div className="p-4 space-y-3">
                      {pedido.pedido_items.map(item => (
                        <div key={item.id}>
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-white text-sm font-medium">{item.nombre_producto_snap}</p>
                              <p className="text-neutral-400 text-xs">{item.nombre_presentacion_snap}</p>
                            </div>
                            <p className="text-white text-sm font-medium">{formatPrecio(item.precio_snap)}</p>
                          </div>
                          {item.pedido_item_opciones.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.pedido_item_opciones.map((op, i) => (
                                <span key={i} className="text-xs bg-neutral-800 text-neutral-300 px-2 py-0.5 rounded">
                                  {op.emoji_snap} {op.nombre_snap}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {pedido.notas && (
                        <p className="text-amber-400 text-xs border-t border-neutral-800 pt-2">
                          📝 {pedido.notas}
                        </p>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 pb-4 flex items-center justify-between">
                      <p className="text-white font-bold">{formatPrecio(pedido.total)}</p>
                      {SIGUIENTE_ESTADO[pedido.estado] && (
                        <button
                          onClick={() => cambiarEstado(pedido.id, pedido.estado)}
                          disabled={procesando === pedido.id}
                          className="flex items-center gap-1.5 px-3 py-2 bg-white text-neutral-900 rounded-lg text-sm font-medium hover:bg-neutral-100 transition-colors disabled:opacity-50"
                        >
                          {procesando === pedido.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : LABEL_ACCION[pedido.estado]}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <NuevoPedido
          dispositivo={dispositivo}
          sesion={sesion}
          onPedidoCreado={() => { setTab('activos'); cargarPedidos() }}
        />
      )}
    </div>
  )
}
