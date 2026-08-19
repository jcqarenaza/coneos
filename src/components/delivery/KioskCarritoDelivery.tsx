'use client'

import { useState } from 'react'
import { Trash2, Plus, Minus, ShoppingBag, Truck, ArrowLeft } from 'lucide-react'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito, Accesorio } from '@/app/[empresa]/delivery/[sucursal]/page'

interface AccesorioExtra { accesorio: Accesorio; cantidad: number }

interface Props {
  config: EmpresaConfig
  dispositivo: DispositivoKiosk
  carrito: ItemCarrito[]
  setCarrito: (c: ItemCarrito[]) => void
  accesorios: Accesorio[]
  costoEnvio: number
  onConfirmar: (extras: AccesorioExtra[]) => void
  onSeguirComprando: () => void
  onVolver: () => void
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function KioskCarritoDelivery({ config, carrito, setCarrito, accesorios, costoEnvio, onConfirmar, onSeguirComprando }: Props) {
  const [cantAccesorios, setCantAccesorios] = useState<Record<string, number>>({})

  const subtotal = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const subtotalAcc = accesorios.reduce((acc, a) => acc + (cantAccesorios[a.id] ?? 0) * a.precio_adicional, 0)
  const total = subtotal + subtotalAcc + costoEnvio

  function cambiarCantidad(id: string, delta: number) {
    setCarrito(carrito.map(i => i.id === id ? { ...i, cantidad: Math.max(0, i.cantidad + delta) } : i).filter(i => i.cantidad > 0))
  }

  function cambiarAcc(id: string, delta: number) {
    setCantAccesorios(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))
  }

  function handleConfirmar() {
    onConfirmar(accesorios.filter(a => (cantAccesorios[a.id] ?? 0) > 0).map(a => ({ accesorio: a, cantidad: cantAccesorios[a.id] ?? 0 })))
  }

  if (carrito.length === 0) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6" style={{ backgroundColor: '#faf8f5' }}>
      <ShoppingBag className="h-14 w-14 text-neutral-200" />
      <p className="text-neutral-400 text-base">Tu carrito está vacío</p>
      <button onClick={onSeguirComprando}
        className="w-full max-w-xs py-4 rounded-2xl text-white font-bold text-base active:scale-95 transition-transform"
        style={{ backgroundColor: config.primary_color }}>
        Ver productos
      </button>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <div className="sticky top-0 z-10 bg-white border-b border-neutral-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onSeguirComprando} className="p-2 -ml-2 text-neutral-400">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-bold text-lg text-neutral-800 flex-1">Tu pedido</h1>
        <span className="text-xs font-semibold text-neutral-400">{carrito.reduce((a,i)=>a+i.cantidad,0)} items</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-48">
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden mb-4">
          {carrito.map((item, i) => (
            <div key={item.id} className={`px-4 py-4 ${i < carrito.length - 1 ? 'border-b border-neutral-50' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-neutral-800 text-sm leading-tight">{item.nombre_producto}</p>
                  <p className="text-neutral-400 text-xs mt-0.5">{item.nombre_presentacion}</p>
                  {item.opciones.length > 0 && (
                    <p className="text-neutral-400 text-xs mt-0.5 leading-tight">{item.opciones.map(o => o.nombre).join(', ')}</p>
                  )}
                  <p className="font-bold text-base mt-1.5" style={{ color: config.primary_color }}>{formatPrecio(item.precio)}</p>
                </div>
                <div className="flex items-center gap-0 bg-neutral-100 rounded-xl overflow-hidden flex-shrink-0">
                  <button onClick={() => cambiarCantidad(item.id, -1)}
                    className="w-10 h-10 flex items-center justify-center text-neutral-500 active:bg-neutral-200">
                    {item.cantidad === 1 ? <Trash2 className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4" />}
                  </button>
                  <span className="w-8 text-center font-bold text-neutral-800 text-sm">{item.cantidad}</span>
                  <button onClick={() => cambiarCantidad(item.id, 1)}
                    className="w-10 h-10 flex items-center justify-center text-white"
                    style={{ backgroundColor: config.primary_color }}>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={onSeguirComprando}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-neutral-200 text-neutral-400 text-sm font-semibold mb-4 active:bg-neutral-50">
          + Agregar más productos
        </button>

        {/* Accesorios */}
        {accesorios.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-neutral-50">
              <p className="font-bold text-neutral-700 text-sm">¿Agregás accesorios?</p>
              <p className="text-xs text-neutral-400">Opcional</p>
            </div>
            <div className="divide-y divide-neutral-50">
              {accesorios.map(acc => {
                const cant = cantAccesorios[acc.id] ?? 0
                return (
                  <div key={acc.id} className="flex items-center gap-3 px-4 py-3">
                    {acc.imagen_url
                      ? <img src={acc.imagen_url} alt={acc.nombre} className="w-12 h-12 object-cover rounded-xl" />
                      : <div className="w-12 h-12 rounded-xl bg-neutral-50 flex items-center justify-center text-2xl">{acc.emoji ?? '🍦'}</div>
                    }
                    <div className="flex-1">
                      <p className="font-semibold text-neutral-800 text-sm">{acc.nombre}</p>
                      <p className="text-xs font-bold" style={{ color: config.primary_color }}>+{formatPrecio(acc.precio_adicional)} c/u</p>
                    </div>
                    <div className="flex items-center gap-0 bg-neutral-100 rounded-xl overflow-hidden">
                      <button onClick={() => cambiarAcc(acc.id, -1)} disabled={cant === 0}
                        className="w-9 h-9 flex items-center justify-center text-neutral-500 disabled:opacity-30">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-5 text-center font-bold text-neutral-800 text-sm">{cant}</span>
                      <button onClick={() => cambiarAcc(acc.id, 1)}
                        className="w-9 h-9 flex items-center justify-center text-white"
                        style={{ backgroundColor: config.primary_color }}>
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 px-4 pt-3 pb-6 shadow-lg">
        <div className="flex justify-between items-center mb-1">
          <span className="text-neutral-400 text-sm">Subtotal</span>
          <span className="text-neutral-600 font-semibold text-sm">{formatPrecio(subtotal + subtotalAcc)}</span>
        </div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-neutral-400 text-sm flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Envío</span>
          <span className="text-neutral-600 font-semibold text-sm">{formatPrecio(costoEnvio)}</span>
        </div>
        <div className="flex justify-between items-center mb-3">
          <span className="font-bold text-neutral-800">Total</span>
          <span className="font-black text-xl" style={{ color: config.primary_color }}>{formatPrecio(total)}</span>
        </div>
        <button onClick={handleConfirmar}
          className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-md active:scale-98 transition-all"
          style={{ backgroundColor: config.primary_color }}>
          Continuar con el pedido →
        </button>
      </div>
    </div>
  )
}
