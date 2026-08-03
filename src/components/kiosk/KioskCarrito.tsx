'use client'

import { ArrowLeft, Trash2, ShoppingBag, Plus } from 'lucide-react'
import type { EmpresaConfig, ItemCarrito } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Props {
  config: EmpresaConfig
  carrito: ItemCarrito[]
  onQuitar: (id: string) => void
  onConfirmar: () => void
  onSeguirComprando: () => void
  onVaciar: () => void
}

function formatPrecio(n: number) {
  return `$${Number(n).toLocaleString('es-AR')}`
}

export default function KioskCarrito({ config, carrito, onQuitar, onConfirmar, onSeguirComprando, onVaciar }: Props) {
  const total = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)

  return (
    <div className="min-h-screen flex flex-col bg-[#fdf8f4]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: config.primary_color }}>
        <button onClick={onSeguirComprando} className="flex items-center gap-2 text-white/80 hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium">Seguir comprando</span>
        </button>
        <span className="text-white font-bold text-lg">Tu pedido</span>
        <div className="w-24" />
      </div>

      <div className="flex-1 px-6 py-6 overflow-y-auto">
        {carrito.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <ShoppingBag className="h-16 w-16 text-neutral-200" />
            <p className="text-neutral-400 text-lg">Tu carrito está vacío</p>
            <button onClick={onSeguirComprando}
              className="px-6 py-3 rounded-xl text-white font-medium"
              style={{ backgroundColor: config.primary_color }}>
              Ver productos
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-w-lg mx-auto">
            {carrito.map(item => (
              <div key={item.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-semibold text-neutral-800">{item.nombre_producto}</p>
                  <p className="text-neutral-500 text-sm">{item.nombre_presentacion}</p>
                  {item.opciones.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.opciones.map((op, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: config.secondary_color, color: '#5a3a1a' }}>
                          {op.emoji} {op.nombre}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="font-bold text-lg" style={{ color: config.primary_color }}>{formatPrecio(item.precio)}</p>
                  <button onClick={() => onQuitar(item.id)} className="p-1.5 text-neutral-300 hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}

            {/* Agregar más */}
            <button onClick={onSeguirComprando}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-300 hover:text-neutral-500 transition-colors">
              <Plus className="h-4 w-4" />
              Agregar más productos
            </button>
          </div>
        )}
      </div>

      {/* Footer con total */}
      {carrito.length > 0 && (
        <div className="p-6 bg-white border-t border-neutral-100">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="text-neutral-600 font-medium">Total</span>
              <span className="text-3xl font-bold" style={{ color: config.primary_color }}>{formatPrecio(total)}</span>
            </div>
            <button
              onClick={onConfirmar}
              className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all"
              style={{ backgroundColor: config.primary_color }}
            >
              Confirmar pedido
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
