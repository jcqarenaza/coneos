'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Loader2, CheckCircle, Clock, ChefHat, Package, Truck } from 'lucide-react'
import MapaCliente from '@/components/reparto/MapaCliente'
import { marcaDeRuta } from '@/lib/brand'

interface DatosDelivery { nombre: string; telefono: string; direccion: string; entre_calles?: string }
interface PedidoItem { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones: { nombre_snap: string; emoji_snap: string | null }[] }
interface Pedido {
  id: string; numero_pedido: number; codigo_retiro: string; estado: string
  total: number; metodo_pago: string | null; created_at: string
  tipo_pedido: string | null; costo_envio: number; datos_delivery: DatosDelivery | null
  colaborador_id: string | null; colaborador_nombre: string | null  // REPARTO V1
  colaborador_emoji?: string | null  // identidad visual (GO CTO 29/09)
  pedido_items: PedidoItem[]
}

interface EmpresaConfig { primary_color: string; secondary_color: string; logo_url: string | null; nombre: string; empresa_id: string; reparto: boolean }

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function formatHora(ts: string) {
  return new Date(ts).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
}

const ESTADOS = [
  { key: 'PENDING_PAYMENT', label: 'Pendiente de pago', icon: Clock, color: '#EF4444', desc: 'Tu pedido está esperando confirmación de pago.' },
  { key: 'PAID', label: 'Pago confirmado', icon: CheckCircle, color: '#3B82F6', desc: 'El pago fue confirmado. En breve empieza la preparación.' },
  { key: 'PREPARING', label: 'En preparación', icon: ChefHat, color: '#F59E0B', desc: 'Estamos preparando tu pedido con todo el cariño.' },
  { key: 'READY', label: 'Listo', icon: Package, color: '#10B981', desc: 'Tu pedido está listo.' },
  { key: 'DELIVERED', label: 'Entregado', icon: CheckCircle, color: '#6B7280', desc: 'Tu pedido fue entregado. ¡Buen provecho!' },
  { key: 'CANCELLED', label: 'Cancelado', icon: Clock, color: '#EF4444', desc: 'Tu pedido fue cancelado. Contactanos si tenés dudas.' },
]

// REPARTO V1: los textos de delivery se vuelven honestos — la asignación
// es el discriminador (una sola máquina de estados, sello CTO):
// READY sin cadete = listo en el local · READY + cadete = EN REPARTO (mapa).
function estadoDeliveryLabel(estado: string, cadete: string | null, emoji?: string | null): string {
  const em = emoji ?? '🛵'
  switch (estado) {
    case 'PENDING_PAYMENT': return 'Esperando confirmación'
    case 'PAID': return 'Confirmado — preparando pronto'
    case 'PREPARING': return cadete ? `Preparando 🍦 — ${em} ${cadete} va a llevar tu pedido` : 'Preparando tu pedido 🍦'
    case 'READY': return cadete ? `¡${em} ${cadete} va en camino!` : 'Listo — preparando la salida 📦'
    case 'DELIVERED': return '¡Entregado! Buen provecho 🎉'
    case 'CANCELLED': return 'Cancelado'
    default: return estado
  }
}

// Next 16 (regla del repo): los params de client pages son Promise — la ruta
// se lee del pathname, como kiosk/TA/mesa/reparto. Con el estilo viejo,
// params.empresa llegaba undefined y TODO pedido daba "no encontrado".
function rutaDesdeURL() {
  const partes = window.location.pathname.split('/').filter(Boolean)
  return { empresa: partes[0] ?? '', numero: partes[2] ?? '' }
}

export default function PedidoPage() {
  const params = rutaDesdeURL()
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [volverUrl, setVolverUrl] = useState<string | null>(null)  // JC 29/09: la pantalla era un callejón sin salida en PWA
  const [config, setConfig] = useState<EmpresaConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  async function cargar() {
    // TODO server-side por la API (bug 29/09: el anon del browser no lee
    // pedidos/empresas — en el celu del cliente real daba "no encontrado")
    try {
      const res = await fetch('/api/reparto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'pedido_publico', empresa_slug: params.empresa, pedido_ref: params.numero }),
      })
      const d = await res.json().catch(() => null)
      if (!d?.encontrado) { setNotFound(true); setLoading(false); return }
      setConfig(d.marca as EmpresaConfig)
      setPedido(d.pedido as Pedido)
      setVolverUrl(d.volver_url ?? null)
      setLoading(false)
    } catch { setNotFound(true); setLoading(false) }
  }

  useEffect(() => {
    cargar()
    // Polling cada 15s para actualizar estado
    const interval = setInterval(cargar, 15000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <Loader2 className="h-8 w-8 animate-spin text-neutral-300" />
    </div>
  )

  if (notFound || !pedido || !config) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-5xl">🍦</p>
      <p className="font-bold text-neutral-700 text-lg text-center">Pedido no encontrado</p>
      <p className="text-neutral-400 text-sm text-center">Verificá el número de pedido e intentá de nuevo.</p>
    </div>
  )

  const estadoActual = ESTADOS.find(e => e.key === pedido.estado) ?? ESTADOS[0]
  const IconoEstado = estadoActual.icon
  const esDelivery = pedido.tipo_pedido === 'delivery'
  const subtotal = Number(pedido.total) - Number(pedido.costo_envio || 0)

  // Pasos del timeline según tipo
  const pasosTimeline = esDelivery
    ? ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY', 'DELIVERED']
    : ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY', 'DELIVERED']

  const idxActual = pasosTimeline.indexOf(pedido.estado)

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      {/* Header */}
      <div className="bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between">
        {config.logo_url
          ? <Image src={config.logo_url} alt="Logo" width={120} height={48} className="object-contain" style={{ maxHeight: 44 }} />
          : <span className="font-bold text-lg" style={{ color: config.primary_color }}>{config.nombre}</span>}
        <span className="text-xs text-neutral-400">{formatHora(pedido.created_at)}</span>
      </div>

      <div className="px-4 pt-5 pb-10 max-w-sm mx-auto">
        {/* Estado principal */}
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 mb-4 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm"
            style={{ backgroundColor: `${estadoActual.color}15` }}>
            <IconoEstado className="h-7 w-7" style={{ color: estadoActual.color }} />
          </div>
          <p className="text-xs text-neutral-400 uppercase tracking-widest mb-1">Pedido #{pedido.numero_pedido}</p>
          <h1 className="text-xl font-black mb-1" style={{ color: estadoActual.color }}>
            {esDelivery ? estadoDeliveryLabel(pedido.estado, pedido.colaborador_nombre, pedido.colaborador_emoji) : estadoActual.label}
          </h1>
          <p className="text-neutral-400 text-sm">{estadoActual.desc}</p>
        </div>

        {/* ═══ REPARTO V1 — mapa en vivo: SOLO delivery + READY + cadete + módulo ON ═══ */}
        {esDelivery && pedido.estado === 'READY' && pedido.colaborador_id && config.reparto && (
          <MapaCliente empresaId={config.empresa_id} pedidoId={pedido.id}
            nombreCadete={pedido.colaborador_emoji ? `${pedido.colaborador_emoji} ${pedido.colaborador_nombre ?? ''}`.trim() : pedido.colaborador_nombre} color={config.primary_color} />
        )}

        {/* Timeline */}
        {pedido.estado !== 'CANCELLED' && (
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4">
            <div className="flex items-center justify-between">
              {pasosTimeline.map((paso, idx) => {
                const done = idx <= idxActual
                const current = idx === idxActual
                const labels = esDelivery
                  ? ['Recibido', 'Confirmado', 'Preparando', 'En camino', 'Entregado']
                  : ['Recibido', 'Pagado', 'Preparando', 'Listo', 'Entregado']
                return (
                  <div key={paso} className="flex flex-col items-center flex-1">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center mb-1 transition-all ${
                      done ? 'shadow-sm' : 'bg-neutral-100'
                    }`} style={done ? { backgroundColor: current ? config.primary_color : `${config.primary_color}40` } : {}}>
                      {done ? <div className={`w-3 h-3 rounded-full bg-white`} /> : <div className="w-2 h-2 rounded-full bg-neutral-300" />}
                    </div>
                    {idx < pasosTimeline.length - 1 && (
                      <div className="absolute" /> // spacer handled by flex
                    )}
                    <span className="text-xs text-center leading-tight" style={{ color: done ? config.primary_color : '#9CA3AF', fontSize: '9px' }}>
                      {labels[idx]}
                    </span>
                  </div>
                )
              })}
            </div>
            {/* Línea de progreso */}
            <div className="mt-3 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(5, (idxActual / (pasosTimeline.length - 1)) * 100)}%`, backgroundColor: config.primary_color }} />
            </div>
          </div>
        )}

        {/* Datos delivery */}
        {esDelivery && pedido.datos_delivery && (
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="h-4 w-4" style={{ color: config.primary_color }} />
              <p className="font-bold text-neutral-700 text-sm">Datos de entrega</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-neutral-600"><span className="font-semibold">Nombre:</span> {pedido.datos_delivery.nombre}</p>
              <p className="text-sm text-neutral-600"><span className="font-semibold">Dirección:</span> {pedido.datos_delivery.direccion}</p>
              {pedido.datos_delivery.entre_calles && <p className="text-sm text-neutral-600"><span className="font-semibold">Entre:</span> {pedido.datos_delivery.entre_calles}</p>}
              <p className="text-sm text-neutral-600"><span className="font-semibold">Tel:</span> {pedido.datos_delivery.telefono}</p>
            </div>
          </div>
        )}

        {/* Items */}
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-neutral-50">
            <p className="font-bold text-neutral-700 text-sm">Tu pedido</p>
          </div>
          {pedido.pedido_items.map((item, i) => (
            <div key={i} className={`px-4 py-3 ${i < pedido.pedido_items.length - 1 ? 'border-b border-neutral-50' : ''}`}>
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1">
                  <p className="font-semibold text-neutral-800 text-sm">{item.cantidad}x {item.nombre_producto_snap}</p>
                  <p className="text-neutral-400 text-xs">{item.nombre_presentacion_snap}</p>
                  {item.pedido_item_opciones.length > 0 && (
                    <p className="text-neutral-400 text-xs mt-0.5">
                      {item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(' · ')}
                    </p>
                  )}
                </div>
                <p className="font-bold text-sm text-neutral-700">{formatPrecio(item.precio_snap)}</p>
              </div>
            </div>
          ))}
          {esDelivery && Number(pedido.costo_envio) > 0 && (
            <div className="px-4 py-3 border-t border-neutral-50 flex justify-between">
              <span className="text-neutral-400 text-sm flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Envío</span>
              <span className="font-semibold text-sm text-neutral-600">{formatPrecio(Number(pedido.costo_envio))}</span>
            </div>
          )}
          <div className="px-4 py-3 bg-neutral-50 border-t border-neutral-100 flex justify-between">
            <span className="font-bold text-neutral-700">Total</span>
            <span className="font-black text-lg" style={{ color: config.primary_color }}>{formatPrecio(Number(pedido.total))}</span>
          </div>
        </div>

        {volverUrl && (
          <a href={volverUrl}
            className={pedido?.estado === 'DELIVERED'
              ? 'block w-full text-center py-4 rounded-2xl text-white font-black text-lg shadow-sm'
              : 'block w-full text-center py-3 rounded-2xl border-2 border-neutral-200 bg-white text-neutral-600 font-semibold text-sm'}
            style={pedido?.estado === 'DELIVERED' ? { backgroundColor: config?.primary_color ?? '#1E3A5F' } : undefined}>
            🛒 {pedido?.estado === 'DELIVERED' ? 'Hacer otro pedido' : 'Volver a la tienda'}
          </a>
        )}
        <p className="text-center text-xs text-neutral-300">Esta página se actualiza automáticamente · {marcaDeRuta()}</p>
      </div>
    </div>
  )
}
