'use client'

import { useEffect, useState, useCallback } from 'react'

import { Loader2, CheckCircle, RefreshCw, ArrowRight, Copy, Check } from 'lucide-react'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Props {
  config: EmpresaConfig
  dispositivo: DispositivoKiosk
  carrito: ItemCarrito[]
  pedidoCreado: { numero: number; codigo: string } | null
  onPedidoCreado: (numero: number, codigo: string) => void
  onNuevoPedido: () => void
  onVolver: () => void
}

interface MetodoPago { id: string; label: string; emoji: string; descripcion: string }
interface PagosSucursal { acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean; cbu_transferencia: string | null; mp_alias?: string | null; mp_access_token?: string | null }

type EstadoMP = 'idle' | 'creando' | 'esperando' | 'aprobado' | 'rechazado'

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function KioskConfirmacion({ config, dispositivo, carrito, pedidoCreado, onPedidoCreado, onNuevoPedido, onVolver }: Props) {
  const [metodosDisponibles, setMetodosDisponibles] = useState<MetodoPago[]>([])
  const [pagosSucursal, setPagosSucursal] = useState<PagosSucursal | null>(null)
  const [metodoPago, setMetodoPago] = useState<string>('')
  const [creando, setCreando] = useState(false)
  const [countdown, setCountdown] = useState(15)

  // Estado transferencia
  const [pedidoTransferencia, setPedidoTransferencia] = useState<{ id: string; numero: number; codigo: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [numComprobante, setNumComprobante] = useState('')

  // MP state
  const [estadoMP, setEstadoMP] = useState<EstadoMP>('idle')
  const [mpInitPoint, setMpInitPoint] = useState<string | null>(null)
  const [mpDisponible, setMpDisponible] = useState(false)

  useEffect(() => {
    fetch(`/api/mp/estado?empresa_id=${dispositivo.empresa_id}`)
      .then(r => r.json())
      .then(d => setMpDisponible(!!d.conectado))
      .catch(() => setMpDisponible(false))
  }, [dispositivo.empresa_id])
  const [pedidoIdPendiente, setPedidoIdPendiente] = useState<string | null>(null)
  const [pollingCount, setPollingCount] = useState(0)

  const total = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)

  useEffect(() => {
    fetch(`/api/kiosk/pagos?sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json())
      .then(data => {
        setPagosSucursal({ ...data, mp_access_token: data.mp_access_token })
        const metodos: MetodoPago[] = []
        if (data.acepta_efectivo) metodos.push({ id: 'efectivo', label: 'Efectivo en caja', emoji: '💵', descripcion: 'Pagás al retirar tu pedido' })
        if (data.acepta_transferencia) metodos.push({ id: 'transferencia', label: 'Transferencia', emoji: '📲', descripcion: data.cbu_transferencia ? `Alias: ${data.cbu_transferencia}` : 'Transferencia bancaria' })
        if (data.acepta_mp && data.acepta_mp_kiosk !== false) metodos.push({ id: 'mp', label: 'Mercado Pago', emoji: '💳', descripcion: 'Pagá con QR' })
        setMetodosDisponibles(metodos)
        if (metodos.length > 0) setMetodoPago(metodos[0].id)
      })
      .catch(() => {
        setMetodosDisponibles([{ id: 'efectivo', label: 'Efectivo en caja', emoji: '💵', descripcion: 'Pagás al retirar tu pedido' }])
        setMetodoPago('efectivo')
      })
  }, [dispositivo])

  // Countdown para volver al inicio
  useEffect(() => {
    if (!pedidoCreado) return
    const interval = setInterval(() => {
      setCountdown(c => { if (c <= 1) { onNuevoPedido(); return 15 } return c - 1 })
    }, 1000)
    return () => clearInterval(interval)
  }, [pedidoCreado, onNuevoPedido])

  // Countdown transferencia — más largo, 3 minutos
  const [countdownTransf, setCountdownTransf] = useState(180)
  useEffect(() => {
    if (!pedidoTransferencia) return
    const interval = setInterval(() => {
      setCountdownTransf(c => { if (c <= 1) { onNuevoPedido(); return 180 } return c - 1 })
    }, 1000)
    return () => clearInterval(interval)
  }, [pedidoTransferencia, onNuevoPedido])

  // Polling MP
  const verificarPagoMP = useCallback(async (pedidoId: string) => {
    try {
      // Server-side: el kiosk es anónimo y la RLS le bloquea el SELECT directo
      const r = await fetch(`/api/pedidos/estado?pedido_id=${pedidoId}`)
      if (!r.ok) return
      const data = await r.json()
      if (data?.estado === 'PAID') {
        setEstadoMP('aprobado')
        onPedidoCreado(data.numero_pedido, data.codigo_retiro)
      }
    } catch { /* ignorar */ }
  }, [onPedidoCreado])

  useEffect(() => {
    if (estadoMP !== 'esperando' || !pedidoIdPendiente) return
    if (pollingCount > 60) { setEstadoMP('rechazado'); return }
    const timeout = setTimeout(async () => {
      await verificarPagoMP(pedidoIdPendiente)
      setPollingCount(c => c + 1)
    }, 2000)
    return () => clearTimeout(timeout)
  }, [estadoMP, pedidoIdPendiente, pollingCount, verificarPagoMP])

  async function crearPedido(metodo: string) {
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
      body: JSON.stringify({
        empresa_id: dispositivo.empresa_id, sucursal_id: dispositivo.sucursal_id,
        dispositivo_id: dispositivo.id, items, metodo_pago: metodo, origen: 'KIOSK',
      }),
    })

    const data = await res.json()
    setCreando(false)

    if (!res.ok || !data.pedido) return

    if (metodo === 'transferencia') {
      // Guardar comprobante en notas si lo ingresó
      if (numComprobante.trim()) {
        const { createClient } = await import('@/lib/supabase/client')
        await createClient().from('pedidos').update({ notas: `Comprobante: ...${numComprobante.trim()}` }).eq('id', data.pedido.id)
      }
      setPedidoTransferencia({ id: data.pedido.id, numero: data.pedido.numero_pedido, codigo: data.pedido.codigo_retiro })
    } else if (metodo === 'mp') {
      // Verificar si MP está configurado
      const mpConfigurado = mpDisponible
      if (!mpConfigurado) {
        // Fallback a transferencia — mostrar alias
        if (numComprobante.trim()) {
          const { createClient } = await import('@/lib/supabase/client')
          await createClient().from('pedidos').update({ notas: `Comprobante: ...${numComprobante.trim()}` }).eq('id', data.pedido.id)
        }
        setPedidoTransferencia({ id: data.pedido.id, numero: data.pedido.numero_pedido, codigo: data.pedido.codigo_retiro })
      } else {
        setPedidoIdPendiente(data.pedido.id)
        setEstadoMP('creando')
        const mpRes = await fetch('/api/mp/preferencia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pedido_id: data.pedido.id }),
        })
        if (mpRes.ok) {
          const mpData = await mpRes.json()
          setMpInitPoint(mpData.sandbox_init_point ?? mpData.init_point)
          setEstadoMP('esperando')
          setPollingCount(0)
        } else {
          setEstadoMP('rechazado')
        }
      }
    } else {
      onPedidoCreado(data.pedido.numero_pedido, data.pedido.codigo_retiro)
    }
  }

  function copiarAlias() {
    const alias = pagosSucursal?.cbu_transferencia ?? ''
    navigator.clipboard.writeText(alias).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    })
  }

  function formatCountdown(s: number) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // ─── Pantalla éxito ───
  if (pedidoCreado) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#faf8f5' }}>
        <div className="text-center max-w-sm w-full">
          {config.logo_url && <img src={config.logo_url} alt="Logo" width={160} height={64} className="object-contain mx-auto mb-8" />}
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg" style={{ backgroundColor: config.primary_color }}>
            <CheckCircle className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-black mb-2" style={{ color: config.primary_color }}>¡Pedido recibido!</h1>
          <p className="text-neutral-500 mb-8">Presentá tu código al retirar</p>
          <div className="bg-white rounded-3xl p-8 shadow-md mb-8 border border-neutral-100">
            <p className="text-neutral-400 text-sm mb-1 uppercase tracking-wide font-medium">Número de pedido</p>
            <p className="font-black mb-5" style={{ fontSize: '6rem', lineHeight: 1, color: config.primary_color }}>#{pedidoCreado.numero}</p>
            <div className="h-px bg-neutral-100 mb-5" />
            <p className="text-neutral-400 text-sm mb-2 uppercase tracking-wide font-medium">Código de retiro</p>
            <p className="text-4xl font-black tracking-[0.3em] font-mono" style={{ color: config.primary_color }}>{pedidoCreado.codigo}</p>
          </div>
          <p className="text-neutral-300 text-sm mb-4">Volviendo al inicio en {countdown}s...</p>
          <button onClick={onNuevoPedido} className="px-8 py-3 rounded-2xl text-white font-semibold active:scale-95 transition-all" style={{ backgroundColor: config.primary_color }}>
            Volver al inicio
          </button>
          <p className="mt-8 text-neutral-300 text-sm italic">¡Gracias por tu pedido! 🍦</p>
        </div>
      </div>
    )
  }

  // ─── Pantalla transferencia ───
  if (pedidoTransferencia) {
    const alias = pagosSucursal?.cbu_transferencia ?? ''
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#faf8f5' }}>
        <div className="text-center max-w-sm w-full">
          {config.logo_url && <img src={config.logo_url} alt="Logo" width={140} height={56} className="object-contain mx-auto mb-6" />}

          <div className="bg-white rounded-3xl p-6 shadow-md border border-neutral-100 mb-5">
            <p className="text-neutral-400 text-xs uppercase tracking-widest mb-1">Pedido</p>
            <p className="font-black text-5xl mb-1" style={{ color: config.primary_color }}>#{pedidoTransferencia.numero}</p>
            <p className="text-neutral-400 text-sm">Código: <span className="font-mono font-bold text-neutral-600">{pedidoTransferencia.codigo}</span></p>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-md border border-neutral-100 mb-5 text-left">
            <p className="text-sm font-bold text-neutral-700 mb-4 text-center">📲 Datos para transferir</p>

            <div className="space-y-3">
              <div className="bg-neutral-50 rounded-2xl p-4">
                <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Monto a transferir</p>
                <p className="text-3xl font-black" style={{ color: config.primary_color }}>{formatPrecio(total)}</p>
              </div>

              {alias && (
                <div className="bg-neutral-50 rounded-2xl p-4">
                  <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">Alias / CBU</p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono font-bold text-neutral-800 text-lg break-all">{alias}</p>
                    <button onClick={copiarAlias}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
                      style={{ backgroundColor: copiado ? '#dcfce7' : `${config.primary_color}15`, color: copiado ? '#16a34a' : config.primary_color }}>
                      {copiado ? <><Check className="h-3.5 w-3.5" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3">
                <p className="text-amber-700 text-xs text-center font-medium">⚠️ Incluí el número de pedido en el comentario de la transferencia</p>
              </div>
            </div>
          </div>

          {/* Campo comprobante opcional */}
          <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-4 shadow-sm">
            <p className="text-sm font-semibold text-neutral-700 mb-2">¿Tenés el número de comprobante?</p>
            <div className="flex items-center gap-2">
              <span className="text-neutral-400 text-sm font-mono">...</span>
              <input
                value={numComprobante}
                onChange={e => setNumComprobante(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="123"
                maxLength={3}
                className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 text-xl font-mono font-bold text-center tracking-widest focus:outline-none focus:border-neutral-400"
              />
            </div>
            <p className="text-neutral-400 text-xs mt-1.5 text-center">Últimos 3 números — opcional</p>
          </div>

          <button onClick={() => { onPedidoCreado(pedidoTransferencia.numero, pedidoTransferencia.codigo) }}
            className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-98 transition-all mb-3"
            style={{ backgroundColor: config.primary_color }}>
            ✅ Ya realicé la transferencia
          </button>

          <p className="text-neutral-300 text-xs">El operador confirmará tu pago · {formatCountdown(countdownTransf)}</p>
        </div>
      </div>
    )
  }

  // ─── MP esperando ───
  if (estadoMP === 'esperando' && mpInitPoint) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#faf8f5' }}>
        <div className="text-center max-w-sm w-full">
          {config.logo_url && <img src={config.logo_url} alt="Logo" width={140} height={56} className="object-contain mx-auto mb-6" />}
          <div className="bg-white rounded-3xl p-8 shadow-md border border-neutral-100 mb-6">
            <p className="text-2xl font-black mb-2" style={{ color: config.primary_color }}>Mercado Pago</p>
            <p className="text-neutral-400 text-sm mb-6">Escaneá el QR o tocá el botón para pagar</p>
            <div className="flex justify-center mb-6">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(mpInitPoint)}`}
                alt="QR Mercado Pago" className="w-52 h-52 rounded-xl border border-neutral-100" />
            </div>
            <p className="text-neutral-400 text-sm mb-1">Total a pagar</p>
            <p className="font-black text-3xl mb-6" style={{ color: config.primary_color }}>{formatPrecio(total)}</p>
            <a href={mpInitPoint} target="_blank" rel="noopener noreferrer"
              className="w-full py-4 rounded-2xl text-white font-bold text-lg flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
              style={{ backgroundColor: '#009EE3' }}>
              💳 Pagar con Mercado Pago <ArrowRight className="h-5 w-5" />
            </a>
          </div>
          <div className="space-y-3">
            <button onClick={() => verificarPagoMP(pedidoIdPendiente!)}
              className="w-full py-3 rounded-2xl border-2 border-neutral-200 text-neutral-500 font-semibold flex items-center justify-center gap-2 hover:bg-neutral-50 transition-colors">
              <RefreshCw className="h-4 w-4" /> Verificar pago
            </button>
            <button onClick={onNuevoPedido} className="w-full py-3 rounded-2xl text-neutral-400 text-sm font-medium hover:text-neutral-600 transition-colors">
              👩‍💼 Pagar en caja
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── MP rechazado ───
  if (estadoMP === 'rechazado') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#faf8f5' }}>
        <div className="text-center max-w-sm w-full">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6"><span className="text-4xl">❌</span></div>
          <h2 className="text-2xl font-black text-neutral-800 mb-2">No pudimos completar el pago</h2>
          <p className="text-neutral-400 mb-8">Tu pedido está guardado. Podés intentar de nuevo o pagar en caja.</p>
          <div className="space-y-3">
            <button onClick={() => { setEstadoMP('idle'); setMpInitPoint(null) }}
              className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg"
              style={{ backgroundColor: config.primary_color }}>
              🔄 Intentar nuevamente
            </button>
            <button onClick={onNuevoPedido}
              className="w-full py-4 rounded-2xl border-2 border-neutral-200 text-neutral-600 font-bold text-lg hover:bg-neutral-50 transition-colors">
              👩‍💼 Pagar en caja
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Pantalla principal — selección método de pago ───
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <div className="flex items-center justify-center px-6 py-5 bg-white border-b border-neutral-100">
        {config.logo_url
          ? <img src={config.logo_url} alt="Logo" width={140} height={56} className="object-contain" style={{ maxHeight: 52 }} />
          : <span className="font-bold text-xl" style={{ color: config.primary_color }}>{dispositivo.empresas?.nombre}</span>}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-black mb-2 text-center" style={{ color: config.primary_color }}>¿Cómo querés pagar?</h2>
          <p className="text-neutral-400 text-center mb-8">Elegí tu método de pago</p>

          <div className="bg-white rounded-2xl border border-neutral-100 mb-6 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-neutral-50">
              <p className="text-neutral-400 text-xs font-semibold uppercase tracking-wide">Resumen del pedido</p>
            </div>
            {carrito.map(item => (
              <div key={item.id} className="px-5 py-3 border-b border-neutral-50 last:border-0">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-neutral-700 text-sm font-semibold">{item.nombre_producto} — {item.nombre_presentacion}</p>
                    {item.opciones.length > 0 && <p className="text-neutral-400 text-xs mt-0.5">{item.opciones.map(o => o.nombre).join(', ')}</p>}
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

          <button onClick={() => crearPedido(metodoPago)} disabled={!metodoPago || creando || estadoMP === 'creando'}
            className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-98 transition-all disabled:opacity-40 flex items-center justify-center gap-3"
            style={{ backgroundColor: config.primary_color }}>
            {(creando || estadoMP === 'creando') ? <><Loader2 className="h-5 w-5 animate-spin" /> Procesando...</> : 'Confirmar pedido →'}
          </button>
          <button onClick={onVolver} className="w-full py-3 rounded-2xl text-neutral-400 text-sm font-medium hover:text-neutral-600 transition-colors">
            ← Volver al carrito
          </button>
        </div>
      </div>
    </div>
  )
}
