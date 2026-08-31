'use client'

import { useEffect, useState } from 'react'
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

export default function KioskCarritoDelivery({ config, dispositivo, carrito, setCarrito, accesorios, costoEnvio, onConfirmar, onSeguirComprando }: Props) {
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


  // ── Canje de puntos ──
  const [benefActivo, setBenefActivo] = useState(false)
  const [benefTel, setBenefTel] = useState('')
  const [benefCargando, setBenefCargando] = useState(false)
  const [benefInfo, setBenefInfo] = useState<{ puntos: number; canjeables: { id: string; nombre: string; emoji: string | null; puntos_canje: number }[] } | null>(null)
  const [canjePuntosUsados, setCanjePuntosUsados] = useState(0)

  useEffect(() => {
    fetch(`/api/beneficios?empresa_id=${dispositivo.empresa_id}`)
      .then(r => r.json()).then(d => setBenefActivo(!!d.activo)).catch(() => {})
    try {
      const prev = sessionStorage.getItem('coneos_canje')
      if (prev) { const p = JSON.parse(prev); setCanjePuntosUsados(p.puntos ?? 0) }
    } catch {}
  }, [dispositivo])

  async function consultarPuntos() {
    setBenefCargando(true)
    try {
      const r = await fetch(`/api/beneficios?empresa_id=${dispositivo.empresa_id}&telefono=${benefTel}`)
      const d = await r.json()
      if (d.activo) setBenefInfo({ puntos: d.puntos ?? 0, canjeables: d.canjeables ?? [] })
    } catch {}
    setBenefCargando(false)
  }

  const [canjes, setCanjes] = useState<{ id: string; nombre: string; emoji: string | null; puntos_canje: number }[]>([])
  function agregarCanje(cj: { id: string; nombre: string; emoji: string | null; puntos_canje: number }) {
    setCanjes(prev => [...prev, cj])
    const usados = canjePuntosUsados + cj.puntos_canje
    setCanjePuntosUsados(usados)
    try {
      const prev = sessionStorage.getItem('coneos_canje')
      const p = prev ? JSON.parse(prev) : { telefono: benefTel, opciones: [], puntos: 0 }
      p.telefono = p.telefono || benefTel
      p.opciones.push(cj.id); p.puntos = usados
      sessionStorage.setItem('coneos_canje', JSON.stringify(p))
    } catch {}
  }

  function handleConfirmar() {
    const extrasCanje = canjes.map(cj => ({ accesorio: { ...cj, imagen_url: null, precio_adicional: 0, grupo_id: '', nombre: `🎁 ${cj.nombre.replace(/^Toppings?\s+/i, '')} (canje)` } as Accesorio, cantidad: 1 }))
    onConfirmar([...accesorios.filter(a => (cantAccesorios[a.id] ?? 0) > 0).map(a => ({ accesorio: a, cantidad: cantAccesorios[a.id] ?? 0 })), ...extrasCanje])
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


            {/* ── Canje de puntos ── */}
            {benefActivo && (
              <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-neutral-50">
                  <p className="font-bold text-neutral-700 text-sm">🎁 ¿Tenés puntos?</p>
                  <p className="text-xs text-neutral-400">Ingresá tu celular y canjealos</p>
                </div>
                <div className="px-4 py-3">
                  {benefInfo ? (
                    <>
                      <p className="text-sm font-bold text-neutral-700 mb-2">Tenés <span style={{ color: config.primary_color }}>{benefInfo.puntos - canjePuntosUsados}</span> puntos</p>
                      {canjes.length > 0 && <p className="text-xs text-green-600 font-semibold mb-2">🎁 {canjes.length} canje{canjes.length > 1 ? 's' : ''} agregado{canjes.length > 1 ? 's' : ''} al pedido</p>}
                      {benefInfo.canjeables.length === 0
                        ? <p className="text-xs text-neutral-400">No hay premios canjeables por ahora</p>
                        : <div className="space-y-1.5">
                            {benefInfo.canjeables.map(cj => {
                              const alcanza = benefInfo.puntos - canjePuntosUsados >= cj.puntos_canje
                              return (
                                <button key={cj.id} disabled={!alcanza} onClick={() => agregarCanje(cj)}
                                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-100 text-left disabled:opacity-40 active:bg-neutral-50">
                                  <span className="text-lg">{cj.emoji ?? '🎁'}</span>
                                  <span className="flex-1 text-sm font-semibold text-neutral-700">{cj.nombre.replace(/^Toppings?\s+/i, '')}</span>
                                  <span className="text-xs font-bold" style={{ color: config.primary_color }}>{cj.puntos_canje} pts</span>
                                </button>
                              )
                            })}
                          </div>
                      }
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <input value={benefTel} inputMode="numeric" placeholder="2302123456"
                        onChange={e => setBenefTel(e.target.value.replace(/\D/g, '').slice(0, 13))}
                        className="flex-1 px-3 py-2.5 rounded-xl border border-neutral-200 text-base font-mono font-bold text-center focus:outline-none focus:border-neutral-400" />
                      <button onClick={consultarPuntos} disabled={benefCargando || benefTel.length < 8}
                        className="px-4 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-40"
                        style={{ backgroundColor: config.primary_color }}>
                        {benefCargando ? '...' : 'Ver'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

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
