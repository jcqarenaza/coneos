'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import KioskCatalogo from '@/components/kiosk/KioskCatalogo'

// ═══════════════════════════════════════════════════════════════════
// MODO MESA — F1 (núcleo)
// URL: /[empresa]/mesa/[sucursal]           → QR GENERAL (pide nombre + mesa)
//      /[empresa]/mesa/[sucursal]?m=4       → QR POR MESA (pide solo nombre)
// El pedido NUNCA exige pago para ir a cocina: "Pagar al mozo" lo manda
// directo a preparación y queda POR COBRAR en caja; "Pagar con Mercado Pago"
// usa el circuito MP existente.
// ═══════════════════════════════════════════════════════════════════

interface EmpresaConfig { primary_color: string; secondary_color: string; logo_url: string | null }
interface Contexto { empresa_id: string; sucursal_id: string; nombre: string; sucursal_nombre: string; config: EmpresaConfig }
interface ItemCarrito {
  id: string; presentacion_id: string; nombre_producto: string
  nombre_presentacion: string; precio: number; cantidad: number
  opciones: { opcion_id: string; nombre: string; emoji: string | null; color: string | null }[]
}

type Paso = 'datos' | 'catalogo' | 'carrito' | 'exito'

function generarId() { return Math.random().toString(36).substring(2) + Date.now().toString(36) }
function fmt(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function MesaPage() {
  const searchParams = useSearchParams()
  const mesaQR = searchParams.get('m')

  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [paso, setPaso] = useState<Paso>('datos')
  const [nombre, setNombre] = useState('')
  const [mesa, setMesa] = useState(mesaQR ?? '')
  const [editandoMesa, setEditandoMesa] = useState(false)
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [pedidoCreado, setPedidoCreado] = useState<{ numero: number } | null>(null)

  useEffect(() => {
    // Next 16: los params de client pages son Promise — resolvemos por pathname
    const partes = window.location.pathname.split('/').filter(Boolean)
    const empresaSlug = partes[0]
    const sucursalSlug = partes[2]
    if (!empresaSlug || !sucursalSlug) { setError('Enlace inválido'); setLoading(false); return }
    fetch(`/api/mesa/contexto?empresa=${empresaSlug}&sucursal=${sucursalSlug}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setError(d.error ?? 'No disponible'); setLoading(false); return }
        setCtx(d); setLoading(false)
      })
      .catch(() => { setError('No se pudo cargar el local'); setLoading(false) })
  }, [])

  const total = carrito.reduce((a, i) => a + i.precio * i.cantidad, 0)

  async function enviarPedido(pagoMP: boolean) {
    if (!ctx || carrito.length === 0 || enviando) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const res = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa_id: ctx.empresa_id,
          sucursal_id: ctx.sucursal_id,
          items: carrito.map(i => ({
            presentacion_id: i.presentacion_id,
            nombre_producto_snap: i.nombre_producto,
            nombre_presentacion_snap: i.nombre_presentacion,
            precio_snap: i.precio,
            cantidad: i.cantidad,
            opciones: i.opciones.map(o => ({ opcion_id: o.opcion_id, nombre_snap: o.nombre, emoji_snap: o.emoji, color_snap: o.color })),
          })),
          metodo_pago: pagoMP ? 'mp' : null,
          origen: 'MESA',
          numero_mesa: Number(mesa),
          nombre_cliente: nombre.trim(),
          pago_mp: pagoMP,
        }),
      })
      const d = await res.json()
      if (!res.ok || !d.pedido) { setErrorEnvio(d.error ?? 'No pudimos enviar tu pedido'); setEnviando(false); return }

      if (pagoMP) {
        const rp = await fetch('/api/mp/preferencia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pedido_id: d.pedido.id }),
        })
        const dp = await rp.json()
        if (rp.ok && dp.init_point) { window.location.href = dp.init_point; return }
        // Sin MP disponible: el pedido quedó PENDING_PAYMENT — avisamos y ofrecemos mozo
        setErrorEnvio('El pago online no está disponible ahora. Llamá al mozo para pagar en la mesa.')
        setEnviando(false)
        return
      }

      setPedidoCreado({ numero: d.pedido.numero_pedido })
      setCarrito([])
      setPaso('exito')
      setEnviando(false)
    } catch {
      setErrorEnvio('Error de conexión. Probá de nuevo.')
      setEnviando(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="text-center"><span className="text-6xl block mb-4 animate-bounce">🪑</span><p className="text-neutral-400">Cargando...</p></div>
    </div>
  )

  if (error || !ctx) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: '#faf8f5' }}>
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4">😕</span>
        <p className="text-neutral-600 font-semibold">{error ?? 'No disponible'}</p>
      </div>
    </div>
  )

  const config = ctx.config

  // ── Paso 1: nombre (+ mesa si el QR es general) ──
  if (paso === 'datos') return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-sm text-center">
        {config.logo_url
          ? <img src={config.logo_url} alt={ctx.nombre} className="h-20 mx-auto mb-4 object-contain" />
          : <span className="text-6xl block mb-4">🍦</span>}
        <h1 className="text-2xl font-black mb-1" style={{ color: config.primary_color }}>{ctx.nombre}</h1>
        <p className="text-neutral-400 text-sm mb-8">Pedí desde tu mesa 📱</p>

        {mesaQR && !editandoMesa ? (
          <div className="mb-5">
            <div className="inline-flex items-center gap-2 bg-white border border-neutral-200 rounded-2xl px-5 py-3 shadow-sm">
              <span className="text-2xl">🪑</span>
              <span className="text-xl font-black text-neutral-800">Mesa {mesa}</span>
            </div>
            <button onClick={() => setEditandoMesa(true)} className="block mx-auto mt-2 text-xs text-neutral-400 underline">¿No es tu mesa?</button>
          </div>
        ) : (
          <div className="mb-5 text-left">
            <label className="text-sm font-semibold text-neutral-500 block mb-1.5">Número de mesa</label>
            <input type="number" inputMode="numeric" value={mesa} onChange={e => setMesa(e.target.value)}
              placeholder="Ej: 4"
              className="w-full text-center text-3xl font-black rounded-2xl border border-neutral-200 bg-white py-4 focus:outline-none focus:border-neutral-400" />
            <p className="text-xs text-neutral-400 mt-1.5">Está en el cartelito de tu mesa</p>
          </div>
        )}

        <div className="mb-8 text-left">
          <label className="text-sm font-semibold text-neutral-500 block mb-1.5">Tu nombre</label>
          <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
            placeholder="¿Cómo te llamás?"
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-lg focus:outline-none focus:border-neutral-400" />
        </div>

        <button onClick={() => setPaso('catalogo')}
          disabled={!nombre.trim() || !mesa || Number(mesa) < 1}
          className="w-full py-4 rounded-2xl text-white font-bold text-lg disabled:opacity-40 active:scale-95 transition-all"
          style={{ backgroundColor: config.primary_color }}>
          Ver el menú →
        </button>
      </div>
    </div>
  )

  // ── Paso éxito ──
  if (paso === 'exito' && pedidoCreado) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-sm text-center">
        <span className="text-6xl block mb-4">✅</span>
        <h1 className="text-2xl font-black mb-2" style={{ color: config.primary_color }}>¡Pedido enviado!</h1>
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 mb-6">
          <p className="text-4xl font-black text-neutral-800 mb-1">#{pedidoCreado.numero}</p>
          <p className="text-neutral-500 font-semibold">🪑 Mesa {mesa} — {nombre}</p>
          <p className="text-neutral-400 text-sm mt-2">Tu pedido ya está en la cocina. Te lo llevamos a la mesa.</p>
          <p className="text-neutral-400 text-xs mt-3 border-t border-neutral-50 pt-3">El pago es al mozo o en caja cuando quieras.</p>
        </div>
        <button onClick={() => { setPedidoCreado(null); setPaso('catalogo') }}
          className="w-full py-4 rounded-2xl text-white font-bold active:scale-95 transition-all"
          style={{ backgroundColor: config.primary_color }}>
          Pedir algo más
        </button>
      </div>
    </div>
  )

  // ── Paso carrito ──
  if (paso === 'carrito') return (
    <div className="min-h-screen flex flex-col p-5" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-md mx-auto flex-1">
        <div className="flex items-center justify-between mb-5 pt-2">
          <button onClick={() => setPaso('catalogo')} className="text-neutral-400 font-semibold text-sm">← Seguir pidiendo</button>
          <span className="text-sm font-bold text-neutral-500">🪑 Mesa {mesa} — {nombre}</span>
        </div>
        <h1 className="text-xl font-black mb-4" style={{ color: config.primary_color }}>Tu pedido</h1>

        {carrito.length === 0 ? (
          <p className="text-neutral-400 text-center py-12">El carrito está vacío</p>
        ) : (
          <div className="space-y-2.5 mb-5">
            {carrito.map(item => (
              <div key={item.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-neutral-800 text-sm">{item.nombre_producto}</p>
                  <p className="text-neutral-400 text-xs">{item.nombre_presentacion}{item.opciones.length > 0 ? ` · ${item.opciones.map(o => o.nombre).join(', ')}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => setCarrito(prev => prev.map(i => i.id === item.id ? { ...i, cantidad: i.cantidad - 1 } : i).filter(i => i.cantidad > 0))}
                    className="w-8 h-8 rounded-full border border-neutral-200 text-neutral-500 font-bold">−</button>
                  <span className="font-bold text-neutral-800 w-5 text-center">{item.cantidad}</span>
                  <button onClick={() => setCarrito(prev => prev.map(i => i.id === item.id ? { ...i, cantidad: i.cantidad + 1 } : i))}
                    className="w-8 h-8 rounded-full text-white font-bold" style={{ backgroundColor: config.primary_color }}>+</button>
                </div>
                <p className="font-bold text-neutral-800 text-sm w-20 text-right">{fmt(item.precio * item.cantidad)}</p>
              </div>
            ))}
          </div>
        )}

        {carrito.length > 0 && (
          <>
            <div className="flex justify-between items-center mb-5 px-1">
              <span className="font-black text-lg text-neutral-800">Total</span>
              <span className="font-black text-lg" style={{ color: config.primary_color }}>{fmt(total)}</span>
            </div>
            {errorEnvio && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
                <p className="text-red-600 text-sm">{errorEnvio}</p>
              </div>
            )}
            <div className="space-y-2.5 pb-6">
              <button onClick={() => enviarPedido(false)} disabled={enviando}
                className="w-full py-4 rounded-2xl text-white font-bold text-lg disabled:opacity-50 active:scale-95 transition-all"
                style={{ backgroundColor: config.primary_color }}>
                {enviando ? 'Enviando...' : '🤝 Pedir y pagar al mozo'}
              </button>
              <button onClick={() => enviarPedido(true)} disabled={enviando}
                className="w-full py-4 rounded-2xl font-bold text-lg border-2 disabled:opacity-50 active:scale-95 transition-all bg-white"
                style={{ borderColor: config.primary_color, color: config.primary_color }}>
                💳 Pagar ahora con Mercado Pago
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  // ── Paso catálogo (reutiliza el kiosk completo, novedades incluidas) ──
  return (
    <div className="relative">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-neutral-100 px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-bold text-neutral-600">🪑 Mesa {mesa} — {nombre}</span>
        <button onClick={() => setPaso('carrito')} className="text-sm font-bold px-3 py-1.5 rounded-xl text-white" style={{ backgroundColor: config.primary_color }}>
          🛒 {carrito.reduce((a, i) => a + i.cantidad, 0)} · {fmt(total)}
        </button>
      </div>
      <KioskCatalogo
        dispositivo={{ id: 'mesa', empresa_id: ctx.empresa_id, sucursal_id: ctx.sucursal_id, empresas: { nombre: ctx.nombre } }}
        config={config}
        carrito={carrito}
        onAgregar={item => setCarrito(prev => [...prev, { ...item, id: generarId() }])}
        onVerCarrito={() => setPaso('carrito')}
        onVolver={() => setPaso('datos')}
      />
    </div>
  )
}
