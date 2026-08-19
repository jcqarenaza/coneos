'use client'

import { useState } from 'react'
import { ArrowLeft, Plus, Minus } from 'lucide-react'
import type { EmpresaConfig, ItemCarrito } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Accesorio { id: string; nombre: string; emoji: string | null; imagen_url: string | null; precio_adicional: number; grupo_id: string }

interface Props {
  config: EmpresaConfig
  accesorios: Accesorio[]
  carrito: ItemCarrito[]
  onConfirmar: (extras: { accesorio: Accesorio; cantidad: number }[]) => void
  onVolver: () => void
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function KioskAccesorios({ config, accesorios, carrito, onConfirmar, onVolver }: Props) {
  const [cantidades, setCantidades] = useState<Record<string, number>>({})

  const subtotalCarrito = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const subtotalExtras = accesorios.reduce((acc, a) => acc + (cantidades[a.id] ?? 0) * a.precio_adicional, 0)
  const total = subtotalCarrito + subtotalExtras

  function cambiar(id: string, delta: number) {
    setCantidades(prev => {
      const nueva = Math.max(0, (prev[id] ?? 0) + delta)
      return { ...prev, [id]: nueva }
    })
  }

  function confirmar() {
    const extras = accesorios
      .filter(a => (cantidades[a.id] ?? 0) > 0)
      .map(a => ({ accesorio: a, cantidad: cantidades[a.id] }))
    onConfirmar(extras)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-100 shadow-sm">
        <button onClick={onVolver} className="flex items-center gap-2 px-4 py-2 rounded-xl text-neutral-500 hover:bg-neutral-50 transition-colors">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium">Volver</span>
        </button>
        <h1 className="font-bold text-lg" style={{ color: config.primary_color }}>¿Agregás algo más?</h1>
        <div className="w-32" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 pb-36">
        <p className="text-center text-neutral-400 text-sm mb-6">Accesorios opcionales para tu pedido</p>
        <div className="max-w-lg mx-auto grid grid-cols-2 gap-4">
          {accesorios.map(acc => {
            const cant = cantidades[acc.id] ?? 0
            return (
              <div key={acc.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
                {acc.imagen_url ? (
                  <img src={acc.imagen_url} alt={acc.nombre} className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center bg-neutral-50">
                    <span className="text-5xl">{acc.emoji ?? '🍦'}</span>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-bold text-neutral-800 text-sm">{acc.nombre}</p>
                  <p className="text-xs font-semibold mt-0.5" style={{ color: config.primary_color }}>+{formatPrecio(acc.precio_adicional)} c/u</p>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2 bg-neutral-100 rounded-xl overflow-hidden">
                      <button onClick={() => cambiar(acc.id, -1)} disabled={cant === 0}
                        className="w-9 h-9 flex items-center justify-center text-neutral-500 active:bg-neutral-200 disabled:opacity-30">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-6 text-center font-bold text-neutral-800 text-sm">{cant}</span>
                      <button onClick={() => cambiar(acc.id, 1)}
                        className="w-9 h-9 flex items-center justify-center text-white active:opacity-80"
                        style={{ backgroundColor: config.primary_color }}>
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    {cant > 0 && <span className="text-xs font-bold" style={{ color: config.primary_color }}>{formatPrecio(cant * acc.precio_adicional)}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 p-5 shadow-lg">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <span className="text-neutral-500 font-medium">Total</span>
            <span className="text-3xl font-black" style={{ color: config.primary_color }}>{formatPrecio(total)}</span>
          </div>
          <div className="flex gap-3">
            <button onClick={() => onConfirmar([])}
              className="flex-1 py-4 rounded-2xl border-2 border-neutral-200 text-neutral-500 font-bold text-base transition-all active:scale-98">
              Sin accesorios
            </button>
            <button onClick={confirmar}
              className="flex-1 py-4 rounded-2xl text-white font-bold text-base shadow-lg active:scale-98 transition-all"
              style={{ backgroundColor: config.primary_color }}>
              Confirmar →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
