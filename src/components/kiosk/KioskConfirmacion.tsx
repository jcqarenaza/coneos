'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Loader2, CheckCircle } from 'lucide-react'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Props {
  config: EmpresaConfig
  dispositivo: DispositivoKiosk
  carrito: ItemCarrito[]
  pedidoCreado: { numero: number; codigo: string } | null
  onPedidoCreado: (numero: number, codigo: string) => void
  onNuevoPedido: () => void
}

interface MetodoPago { id: string; label: string; emoji: string; descripcion: string }

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function KioskConfirmacion({ config, dispositivo, carrito, pedidoCreado, onPedidoCreado, onNuevoPedido }: Props) {
  const [metodosDisponibles, setMetodosDisponibles] = useState<MetodoPago[]>([])
  const [metodoPago, setMetodoPago] = useState<string>('')
  const [creando, setCreando] = useState(false)
  const [countdown, setCountdown] = useState(15)

  const total = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)

  useEffect(() => {
    fetch(`/api/kiosk/pagos?sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json())
      .then(data => {
        const metodos: MetodoPago[] = []
        if (data.acepta_efectivo) metodos.push({ id: 'efectivo', label: 'Efectivo', emoji: '💵', descripcion: 'Pagás en caja al retirar' })
        if (data.acepta_transferencia) metodos.push({ id: 'transferencia', label: 'Transferencia', emoji: '📱', descripcion: 'Transferencia bancaria' })
        if (data.acepta_mp) metodos.push({ id: 'mp', label: 'Mercado Pago', emoji: '💳', descripcion: 'Pago con QR' })
        setMetodosDisponibles(metodos)
        if (metodos.length > 0) setMetodoPago(metodos[0].id)
      })
      .catch(() => {
        setMetodosDisponibles([{ id: 'efectivo', label: 'Efectivo', emoji: '💵', descripcion: 'Pagás en caja al retirar' }])
        setMetodoPago('efectivo')
      })
  }, [dispositivo])

  useEffect(() => {
    if (!pedidoCreado) return
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { onNuevoPedido(); return 15 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [pedidoCreado, onNuevoPedido])

  async function confirmarPedido() {
    if (!metodoPago) return
    setCreando(true)
    const items = carrito.map(item => ({
      presentacion_id: item.presentacion_id,
      nombre_producto_snap: item.nombre_producto,
      nombre_presentacion_snap: item.nombre_presentacion,
      precio_snap: item.precio,
      cantidad: item.cantidad,
      opciones: item.opciones.map(op => ({ opcion_id: op.opcion_id, nombre_snap: op.nombre, emoji_snap: op.emoji, color_snap: op.color })),
    }))
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: dispositivo.empresa_id, sucursal_id: dispositivo.sucursal_id, dispositivo_id: dispositivo.id, items, metodo_pago: metodoPago, origen: 'KIOSK' }),
    })
    const data = await res.json()
    setCreando(false)
    if (res.ok && data.pedido) onPedidoCreado(data.pedido.numero_pedido, data.pedido.codigo_retiro)
  }

  // Pantalla de éxito
  if (pedidoCreado) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#faf8f5' }}>
        <div className="text-center max-w-sm w-full">
          {config.logo_url && (
            <Image src={config.logo_url} alt="Logo" width={160} height={64} className="object-contain mx-auto mb-8" />
          )}

          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg" style={{ backgroundColor: config.primary_color }}>
            <CheckCircle className="h-10 w-10 text-white" />
          </div>

          <h1 className="text-3xl font-black mb-2" style={{ color: config.primary_color }}>¡Pedido recibido!</h1>
          <p className="text-neutral-500 mb-8">Presentá tu código al retirar</p>

          <div className="bg-white rounded-3xl p-8 shadow-md mb-8 border border-neutral-100">
            <p className="text-neutral-400 text-sm mb-1 uppercase tracking-wide font-medium">Número de pedido</p>
            <p className="font-black mb-5" style={{ fontSize: '6rem', lineHeight: 1, color: config.primary_color }}>
              #{pedidoCreado.numero}
            </p>
            <div className="h-px bg-neutral-100 mb-5" />
            <p className="text-neutral-400 text-sm mb-2 uppercase tracking-wide font-medium">Código de retiro</p>
            <p className="text-4xl font-black tracking-[0.3em] font-mono" style={{ color: config.primary_color }}>
              {pedidoCreado.codigo}
            </p>
          </div>

          <p className="text-neutral-300 text-sm mb-4">Volviendo al inicio en {countdown}s...</p>
          <button onClick={onNuevoPedido}
            className="px-8 py-3 rounded-2xl text-white font-semibold active:scale-95 transition-all"
            style={{ backgroundColor: config.primary_color }}>
            Volver al inicio
          </button>

          {/* Gracias */}
          <p className="mt-8 text-neutral-300 text-sm italic">¡Gracias por tu pedido! 🍦</p>
        </div>
      </div>
    )
  }

  // Pantalla de pago
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <div className="flex items-center justify-center px-6 py-5 bg-white border-b border-neutral-100">
        {config.logo_url
          ? <Image src={config.logo_url} alt="Logo" width={140} height={56} className="object-contain" style={{ maxHeight: 52 }} />
          : <span className="font-bold text-xl" style={{ color: config.primary_color }}>{dispositivo.empresas?.nombre}</span>}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-black mb-2 text-center" style={{ color: config.primary_color }}>¿Cómo querés pagar?</h2>
          <p className="text-neutral-400 text-center mb-8">Elegí tu método de pago</p>

          {/* Resumen */}
          <div className="bg-white rounded-2xl border border-neutral-100 mb-6 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-neutral-50">
              <p className="text-neutral-400 text-xs font-semibold uppercase tracking-wide">Resumen del pedido</p>
            </div>
            {carrito.map(item => (
              <div key={item.id} className="px-5 py-3 border-b border-neutral-50 last:border-0">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-neutral-700 text-sm font-semibold">{item.nombre_producto} — {item.nombre_presentacion}</p>
                    {item.opciones.length > 0 && (
                      <p className="text-neutral-400 text-xs mt-0.5">{item.opciones.map(o => o.nombre).join(', ')}</p>
                    )}
                  </div>
                  <p className="text-neutral-700 font-bold text-sm ml-4">{formatPrecio(item.precio)}</p>
                </div>
              </div>
            ))}
            <div className="px-5 py-3 bg-neutral-50 flex justify-between items-center">
              <span className="font-bold text-neutral-700">Total</span>
              <span className="font-black text-2xl" style={{ color: config.primary_color }}>{formatPrecio(total)}</span>
            </div>
          </div>

          {/* Métodos */}
          <div className="space-y-3 mb-8">
            {metodosDisponibles.map(m => (
              <button key={m.id} onClick={() => setMetodoPago(m.id)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${metodoPago === m.id ? 'bg-white shadow-md' : 'bg-white/60 border-neutral-100'}`}
                style={metodoPago === m.id ? { borderColor: config.primary_color } : {}}>
                <span className="text-3xl">{m.emoji}</span>
                <div className="text-left flex-1">
                  <p className="font-bold text-neutral-800">{m.label}</p>
                  <p className="text-neutral-400 text-sm">{m.descripcion}</p>
                </div>
                {metodoPago === m.id && (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
                    <CheckCircle className="h-4 w-4 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>

          <button onClick={confirmarPedido} disabled={!metodoPago || creando}
            className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-98 transition-all disabled:opacity-40 flex items-center justify-center gap-3"
            style={{ backgroundColor: config.primary_color }}>
            {creando ? <><Loader2 className="h-5 w-5 animate-spin" /> Creando pedido...</> : 'Confirmar pedido →'}
          </button>
        </div>
      </div>
    </div>
  )
}
