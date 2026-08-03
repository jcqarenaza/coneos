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

interface MetodoPago { id: string; label: string; emoji: string }

function formatPrecio(n: number) {
  return `$${Number(n).toLocaleString('es-AR')}`
}

export default function KioskConfirmacion({ config, dispositivo, carrito, pedidoCreado, onPedidoCreado, onNuevoPedido }: Props) {
  const [metodosDisponibles, setMetodosDisponibles] = useState<MetodoPago[]>([])
  const [metodoPago, setMetodoPago] = useState<string>('')
  const [creando, setCreando] = useState(false)
  const [countdown, setCountdown] = useState(15)

  const total = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)

  useEffect(() => {
    // Cargar métodos de pago disponibles
    fetch(`/api/kiosk/catalogo?empresa_id=${dispositivo.empresa_id}&sucursal_id=${dispositivo.sucursal_id}`)
    // En su lugar usamos la sucursal_pagos directamente
    fetch(`/api/kiosk/pagos?sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json())
      .then(data => {
        const metodos: MetodoPago[] = []
        if (data.acepta_efectivo) metodos.push({ id: 'efectivo', label: 'Efectivo', emoji: '💵' })
        if (data.acepta_transferencia) metodos.push({ id: 'transferencia', label: 'Transferencia', emoji: '📱' })
        if (data.acepta_mp) metodos.push({ id: 'mp', label: 'Mercado Pago', emoji: '💳' })
        setMetodosDisponibles(metodos)
        if (metodos.length > 0) setMetodoPago(metodos[0].id)
      })
      .catch(() => {
        setMetodosDisponibles([{ id: 'efectivo', label: 'Efectivo', emoji: '💵' }])
        setMetodoPago('efectivo')
      })
  }, [dispositivo])

  // Countdown para volver al inicio
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
      opciones: item.opciones.map(op => ({
        opcion_id: op.opcion_id,
        nombre_snap: op.nombre,
        emoji_snap: op.emoji,
        color_snap: op.color,
      })),
    }))

    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresa_id: dispositivo.empresa_id,
        sucursal_id: dispositivo.sucursal_id,
        dispositivo_id: dispositivo.id,
        items,
        metodo_pago: metodoPago,
        origen: 'KIOSK',
      }),
    })

    const data = await res.json()
    setCreando(false)

    if (res.ok && data.pedido) {
      onPedidoCreado(data.pedido.numero_pedido, data.pedido.codigo_retiro)
    }
  }

  // Pantalla de pedido creado
  if (pedidoCreado) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#fdf8f4' }}>
        <div className="text-center max-w-sm">
          {config.logo_url && (
            <Image src={config.logo_url} alt="Logo" width={160} height={70} className="object-contain mx-auto mb-8" />
          )}

          <CheckCircle className="h-16 w-16 mx-auto mb-4" style={{ color: config.primary_color }} />

          <h1 className="text-2xl font-bold text-neutral-800 mb-2">¡Pedido confirmado!</h1>
          <p className="text-neutral-500 mb-8">Acercate a caja con tu número</p>

          <div className="bg-white rounded-3xl p-8 shadow-md mb-8">
            <p className="text-neutral-400 text-sm mb-2">Tu número de pedido</p>
            <p className="font-black mb-4" style={{ fontSize: '5rem', lineHeight: 1, color: config.primary_color }}>
              #{pedidoCreado.numero}
            </p>
            <div className="h-px bg-neutral-100 mb-4" />
            <p className="text-neutral-400 text-sm mb-1">Código de retiro</p>
            <p className="text-3xl font-bold text-neutral-700 font-mono tracking-widest">{pedidoCreado.codigo}</p>
          </div>

          <p className="text-neutral-300 text-sm">Volviendo al inicio en {countdown}s...</p>

          <button onClick={onNuevoPedido}
            className="mt-4 px-8 py-3 rounded-xl text-white font-medium active:scale-95 transition-all"
            style={{ backgroundColor: config.primary_color }}>
            Nuevo pedido
          </button>
        </div>
      </div>
    )
  }

  // Pantalla de confirmación / selección de pago
  return (
    <div className="min-h-screen flex flex-col bg-[#fdf8f4]">
      <div className="flex items-center justify-center px-6 py-4" style={{ backgroundColor: config.primary_color }}>
        {config.logo_url
          ? <Image src={config.logo_url} alt="Logo" width={120} height={50} className="object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
          : <span className="text-white font-bold text-lg">{dispositivo.empresas?.nombre}</span>}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold text-neutral-800 mb-6 text-center">¿Cómo vas a pagar?</h2>

          {/* Resumen */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-6">
            <p className="text-neutral-400 text-sm mb-3">Resumen del pedido</p>
            {carrito.map(item => (
              <div key={item.id} className="flex justify-between items-center py-2 border-b border-neutral-50 last:border-0">
                <div>
                  <p className="text-neutral-700 text-sm font-medium">{item.nombre_producto} — {item.nombre_presentacion}</p>
                  {item.opciones.length > 0 && (
                    <p className="text-neutral-400 text-xs">{item.opciones.map(o => o.nombre).join(', ')}</p>
                  )}
                </div>
                <p className="text-neutral-700 font-medium text-sm">{formatPrecio(item.precio)}</p>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 mt-1">
              <p className="font-bold text-neutral-800">Total</p>
              <p className="font-black text-xl" style={{ color: config.primary_color }}>{formatPrecio(total)}</p>
            </div>
          </div>

          {/* Métodos de pago */}
          <div className="grid grid-cols-1 gap-3 mb-8">
            {metodosDisponibles.map(m => (
              <button key={m.id} onClick={() => setMetodoPago(m.id)}
                className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                  metodoPago === m.id ? 'bg-white shadow-md' : 'bg-white/60 border-transparent'
                }`}
                style={metodoPago === m.id ? { borderColor: config.primary_color } : {}}>
                <span className="text-3xl">{m.emoji}</span>
                <span className="font-semibold text-neutral-800">{m.label}</span>
                {metodoPago === m.id && (
                  <div className="ml-auto w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={confirmarPedido}
            disabled={!metodoPago || creando}
            className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-3"
            style={{ backgroundColor: config.primary_color }}
          >
            {creando ? <><Loader2 className="h-5 w-5 animate-spin" /> Creando pedido...</> : 'Confirmar y pagar en caja'}
          </button>
        </div>
      </div>
    </div>
  )
}
