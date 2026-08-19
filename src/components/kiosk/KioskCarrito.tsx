'use client'

import { useState } from 'react'
import { ArrowLeft, Trash2, ShoppingBag, Plus, Minus } from 'lucide-react'
import type { EmpresaConfig, ItemCarrito, Accesorio } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface AccesorioExtra { accesorio: Accesorio; cantidad: number }

interface Props {
  config: EmpresaConfig
  carrito: ItemCarrito[]
  accesorios: Accesorio[]
  onQuitar: (id: string) => void
  onConfirmar: (extras: AccesorioExtra[]) => void
  onSeguirComprando: () => void
  onVaciar: () => void
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function KioskCarrito({ config, carrito, accesorios, onQuitar, onConfirmar, onSeguirComprando }: Props) {
  const [cantAccesorios, setCantAccesorios] = useState<Record<string, number>>({})
  const subtotal = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const subtotalAcc = accesorios.reduce((acc, a) => acc + (cantAccesorios[a.id] ?? 0) * a.precio_adicional, 0)
  const total = subtotal + subtotalAcc

  function cambiar(id: string, delta: number) {
    setCantAccesorios(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))
  }

  function handleConfirmar() {
    onConfirmar(accesorios.filter(a => (cantAccesorios[a.id] ?? 0) > 0).map(a => ({ accesorio: a, cantidad: cantAccesorios[a.id] ?? 0 })))
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-100 shadow-sm">
        <button onClick={onSeguirComprando} className="flex items-center gap-2 px-4 py-2 rounded-xl text-neutral-500 hover:bg-neutral-50 transition-colors">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium">Seguir comprando</span>
        </button>
        <h1 className="font-bold text-lg" style={{ color: config.primary_color }}>Tu pedido</h1>
        <div className="w-32" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 pb-36">
        {carrito.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <ShoppingBag className="h-16 w-16 text-neutral-200" />
            <p className="text-neutral-400 text-lg">Tu carrito está vacío</p>
            <button onClick={onSeguirComprando} className="px-8 py-3 rounded-2xl text-white font-semibold" style={{ backgroundColor: config.primary_color }}>
              Ver productos
            </button>
          </div>
        ) : (
          <div className="max-w-lg mx-auto space-y-3">
            {carrito.map(item => (
              <div key={item.id} className="bg-white rounded-2xl p-4 shadow-sm border border-neutral-100 flex items-start gap-4">
                <div className="flex-1">
                  <p className="font-bold text-neutral-800 text-base">{item.nombre_producto}</p>
                  <p className="text-neutral-500 text-sm">{item.nombre_presentacion}</p>
                  {item.opciones.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {item.opciones.map((op, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full font-medium text-white" style={{ backgroundColor: config.primary_color }}>
                          {op.emoji} {op.nombre}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="font-bold text-lg" style={{ color: config.primary_color }}>{formatPrecio(item.precio)}</p>
                  <button onClick={() => onQuitar(item.id)} className="p-1.5 text-neutral-200 hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}

            <button onClick={onSeguirComprando}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-300 hover:text-neutral-500 transition-colors">
              <Plus className="h-4 w-4" />
              Agregar más productos
            </button>

            {/* Accesorios */}
            {accesorios.length > 0 && (
              <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
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
                        <div className="flex items-center gap-2 bg-neutral-100 rounded-xl overflow-hidden">
                          <button onClick={() => cambiar(acc.id, -1)} disabled={cant === 0}
                            className="w-9 h-9 flex items-center justify-center text-neutral-500 active:bg-neutral-200 disabled:opacity-30">
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-5 text-center font-bold text-neutral-800 text-sm">{cant}</span>
                          <button onClick={() => cambiar(acc.id, 1)}
                            className="w-9 h-9 flex items-center justify-center text-white active:opacity-80"
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
        )}
      </div>

      {carrito.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 p-5 shadow-lg">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="text-neutral-500 font-medium">Total</span>
              <span className="text-3xl font-black" style={{ color: config.primary_color }}>{formatPrecio(total)}</span>
            </div>
            <button onClick={handleConfirmar}
              className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-98 transition-all"
              style={{ backgroundColor: config.primary_color }}>
              Continuar →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
