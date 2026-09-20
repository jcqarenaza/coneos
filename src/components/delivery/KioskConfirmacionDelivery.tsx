'use client'

import { useEffect, useState, useRef } from 'react'

import { Loader2, CheckCircle, Copy, Check, Truck, Upload, X, ArrowLeft } from 'lucide-react'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito } from '@/app/[empresa]/delivery/[sucursal]/page'

interface Props {
  canal?: 'delivery' | 'takeaway'
  pagosIniciales?: PagosSucursal | null
  mpPermitido?: boolean
  horarioTexto?: string
  slotsRetiro?: { iso: string; label: string }[]
  config: EmpresaConfig; dispositivo: DispositivoKiosk; carrito: ItemCarrito[]
  costoEnvio: number; pedidoCreado: { numero: number; codigo: string } | null
  onPedidoCreado: (numero: number, codigo: string) => void
  onNuevoPedido: () => void; onVolver: () => void
  // 9d: el server rechazó por precios (409 del ciclo C) → el padre re-precia
  // el carrito contra el catálogo fresco y devuelve al cliente a revisarlo.
  onPreciosDesactualizados?: () => void
}
interface DatosDelivery { nombre: string; telefono: string; direccion: string; entre_calles: string }
interface PagosSucursal { acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean; cbu_transferencia: string | null; titular_transferencia?: string | null }

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

function Header({ onBack, title }: { onBack?: () => void; title: string }) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-neutral-100 px-4 py-3 flex items-center gap-2">
      {onBack && <button onClick={onBack} className="p-2 -ml-2 text-neutral-400 active:bg-neutral-100 rounded-xl"><ArrowLeft className="h-5 w-5" /></button>}
      <h1 className="font-bold text-lg text-neutral-800">{title}</h1>
    </div>
  )
}

function ResumenTotal({ subtotal, costoEnvio, total, config, esTakeaway = false }: { subtotal: number; costoEnvio: number; total: number; config: EmpresaConfig; esTakeaway?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-4">
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-neutral-400">Subtotal</span>
        <span className="font-medium text-neutral-600">{formatPrecio(subtotal)}</span>
      </div>
      <div className="flex justify-between text-sm mb-2.5">
        {!esTakeaway && <><span className="text-neutral-400 flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Envío</span>
        <span className="font-medium text-neutral-600">{formatPrecio(costoEnvio)}</span></>}
      </div>
      <div className="flex justify-between border-t border-neutral-100 pt-2.5">
        <span className="font-bold text-neutral-800">Total</span>
        <span className="font-black text-xl" style={{ color: config.primary_color }}>{formatPrecio(total)}</span>
      </div>
    </div>
  )
}

export default function KioskConfirmacionDelivery({ config, dispositivo, carrito, costoEnvio, pedidoCreado, onPedidoCreado, onNuevoPedido, onVolver, canal = 'delivery', mpPermitido = true, horarioTexto, pagosIniciales = null, slotsRetiro = [] , onPreciosDesactualizados }: Props) {
  const esTakeaway = canal === 'takeaway'
  // V1.5: hora de retiro elegida. null = ⚡ Lo antes posible (default histórico)
  const [horaRetiro, setHoraRetiro] = useState<string | null>(null)
  // Hora CONFIRMADA por el server (viaja en la respuesta solo si quedó guardada)
  const [horaConfirmada, setHoraConfirmada] = useState<string | null>(null)
  const subtotal = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const total = subtotal + (canal === 'takeaway' ? 0 : costoEnvio)

  const [paso, setPaso] = useState<'datos' | 'pago' | 'transferencia' | 'exito'>('datos')
  const [benefPesosPorPunto, setBenefPesosPorPunto] = useState<number | null>(null)
  useEffect(() => {
    fetch(`/api/beneficios?empresa_id=${dispositivo.empresa_id}`)
      .then(r => r.json()).then(d => { if (d.activo) setBenefPesosPorPunto(Number(d.pesos_por_punto ?? 1000)) }).catch(() => {})
  }, [dispositivo])
  // Datos de entrega con memoria de sesión (JC 19/09): si el re-precio o un
  // "volver" desmonta este paso, lo escrito NO se pierde — al volver a entrar
  // el form renace lleno. Se limpia al confirmar el pedido (éxito) y muere
  // solo al cerrar la pestaña (sessionStorage): no filtra datos entre clientes
  // distintos en un mismo dispositivo más allá de la sesión.
  const [datos, setDatos] = useState<DatosDelivery>(() => {
    try {
      const g = sessionStorage.getItem('delivery-datos')
      if (g) return { nombre: '', telefono: '', direccion: '', entre_calles: '', ...JSON.parse(g) }
    } catch {}
    return { nombre: '', telefono: '', direccion: '', entre_calles: '' }
  })
  useEffect(() => {
    try { sessionStorage.setItem('delivery-datos', JSON.stringify(datos)) } catch {}
  }, [datos])
  useEffect(() => {
    // Pedido confirmado → los datos cumplieron su ciclo: se limpian
    if (paso === 'exito') { try { sessionStorage.removeItem('delivery-datos') } catch {} }
  }, [paso])
  const [erroresCampos, setErroresCampos] = useState<Partial<DatosDelivery>>({})
  const [errorPedido, setErrorPedido] = useState<string | null>(null)
  // FASE 4: la disponibilidad de MP la decide el SERVER (resolver del canal
  // en /api/kiosk/pagos?canal=DELIVERY o en el contexto de takeaway) — acá ya
  // no se consulta /api/mp/estado ni se combina nada client-side.
  useEffect(() => {
    if (pagosIniciales) { setPagosSucursal(pagosIniciales); return }
  }, [pagosIniciales])
  const [metodoPago, setMetodoPago] = useState('efectivo')
  // F-C (matriz): el método seleccionado debe ser uno DISPONIBLE. Si el actual
  // quedó afuera (ej: efectivo apagado por llave del canal), se selecciona el
  // primero disponible — con un solo medio, queda elegido por defecto.
  useEffect(() => {
    if (!pagosSucursal) return
    const ids: string[] = []
    if (pagosSucursal.acepta_efectivo) ids.push('efectivo')
    if (pagosSucursal.acepta_transferencia) ids.push('transferencia')
    if (mpPermitido && pagosSucursal.acepta_mp) ids.push('mp')
    if (ids.length > 0 && !ids.includes(metodoPago)) setMetodoPago(ids[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagosSucursal, mpPermitido])
  const [pagosSucursal, setPagosSucursal] = useState<PagosSucursal | null>(null)
  const [creando, setCreando] = useState(false)
  const [pedidoId, setPedidoId] = useState<string | null>(null)
  const [pedidoNum, setPedidoNum] = useState<number | null>(null)
  const [codigoRetiro, setCodigoRetiro] = useState<string>('')
  const pedidoRef = useRef<{ id: string; numero: number; codigo: string } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [captura, setCaptura] = useState<File | null>(null)
  const [capturaPreview, setCapturaPreview] = useState<string | null>(null)
  const [subiendoCaptura, setSubiendoCaptura] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pagosIniciales) return
    // F-C: el canal se declara — TAKEAWAY recibe sus medios resueltos por canal
    fetch(`/api/kiosk/pagos?sucursal_id=${dispositivo.sucursal_id}&canal=${esTakeaway ? 'TAKEAWAY' : 'DELIVERY'}`)
      .then(r => r.json()).then(data => { setPagosSucursal(data) })
  }, [dispositivo, pagosIniciales])

  function handleCaptura(file: File) {
    setCaptura(file)
    const reader = new FileReader()
    reader.onload = e => setCapturaPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function subirCaptura(pid: string): Promise<string | null> {
    if (!captura) return null
    setSubiendoCaptura(true)
    const form = new FormData()
    form.append('pedido_id', pid)
    form.append('archivo', captura)
    const res = await fetch('/api/pedidos/comprobante', { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    setSubiendoCaptura(false)
    if (!res.ok || !data?.url) { console.error('[comprobante]', data?.error ?? res.status); return null }
    return data.url as string
  }

  async function crearPedido(metodo: string) {
    setCreando(true)
    const items = carrito.map(item => ({
      presentacion_id: item.presentacion_id,
      nombre_producto_snap: item.nombre_producto,
      nombre_presentacion_snap: item.nombre_presentacion,
      precio_snap: item.precio, cantidad: item.cantidad,
      opciones: item.opciones.map(op => ({ opcion_id: op.opcion_id, nombre_snap: op.nombre, emoji_snap: op.emoji, color_snap: op.color })),
    }))
    const res = await fetch('/api/pedidos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: dispositivo.empresa_id, sucursal_id: dispositivo.sucursal_id, dispositivo_id: esTakeaway ? null : dispositivo.id, items, metodo_pago: metodo, origen: esTakeaway ? 'TAKEAWAY' : 'DELIVERY', tipo_pedido: canal, costo_envio: esTakeaway ? 0 : costoEnvio, datos_delivery: datos, ...(esTakeaway && horaRetiro ? { hora_retiro: horaRetiro } : {}) }),
    })
    const data = await res.json().catch(() => null)
    setCreando(false)
    if (!res.ok || !data?.pedido) {
      // 9d: precio desactualizado (mensaje humano del ciclo C) → no es un error
      // del cliente: el catálogo cambió. El padre re-precia y volvemos al carrito.
      if (res.status === 409 && String(data?.error ?? '').toLowerCase().includes('precio') && onPreciosDesactualizados) {
        onPreciosDesactualizados()
        return null
      }
      setErrorPedido(data?.error ?? 'No pudimos crear tu pedido. Probá de nuevo.')
      return null
    }
    setErrorPedido(null)
    setPedidoId(data.pedido.id)
    setPedidoNum(data.pedido.numero_pedido)
    setHoraConfirmada((data.pedido as { hora_retiro?: string | null }).hora_retiro ?? null)
    setCodigoRetiro(data.pedido.codigo_retiro)
    pedidoRef.current = { id: data.pedido.id, numero: data.pedido.numero_pedido, codigo: data.pedido.codigo_retiro }
    return data.pedido
  }

  function confirmarDatos() {
    const errs: Partial<DatosDelivery> = {}
    if (!datos.nombre.trim()) errs.nombre = 'Ingresá tu nombre'
    if (!esTakeaway) {
      if (!datos.telefono.trim()) errs.telefono = 'Ingresá tu teléfono'
      if (!datos.direccion.trim()) errs.direccion = 'Ingresá tu dirección'
      if (!datos.entre_calles.trim()) errs.entre_calles = 'Ingresá las calles de referencia'
    }
    setErroresCampos(errs)
    if (Object.keys(errs).length > 0) return
    setPaso('pago')
  }

  // F-C (orden CTO): TA en modo prepago = el canal no acepta efectivo. En ese
  // modo la transferencia exige comprobante ANTES de crear el pedido — "sin
  // captura → no crear". La captura NO equivale a pago acreditado: el pedido
  // nace PENDING_PAYMENT igual (semántica prepago-declarado).
  const prepagoTA = esTakeaway && pagosSucursal !== null && !pagosSucursal.acepta_efectivo

  async function confirmarPago() {
    setErrorPedido(null)
    if (metodoPago === 'transferencia' && prepagoTA && !pedidoRef.current) { setPaso('transferencia'); return }
    const pedido = await crearPedido(metodoPago)
    if (!pedido) return
    if (metodoPago === 'transferencia') { setPaso('transferencia') }
    else if (metodoPago === 'mp') {
      // Crear preferencia y redirigir al checkout de MP
      setCreando(true)
      const res = await fetch('/api/mp/preferencia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_id: pedido.id }),
      })
      const data = await res.json()
      setCreando(false)
      // Canje de puntos elegido en el carrito: descontar server-side y limpiar
      try {
        const raw = sessionStorage.getItem('coneos_canje')
        if (raw && data?.pedido?.id) {
          const cj = JSON.parse(raw)
          if (cj?.telefono && Array.isArray(cj.opciones) && cj.opciones.length > 0) {
            await fetch('/api/beneficios', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pedido_id: data.pedido.id, telefono: cj.telefono, opcion_ids: cj.opciones }) })
          }
          sessionStorage.removeItem('coneos_canje')
        }
      } catch {}

      if (res.ok && data.init_point) {
        // Guardar pendiente para que la page lo retome al volver del checkout de MP
        try { sessionStorage.setItem('coneos_mp_pedido', JSON.stringify({ id: pedido.id, ts: Date.now() })) } catch {}
        window.location.href = data.init_point
      } else {
        // Fallback: mostrar éxito igual, la caja cobra manual
        onPedidoCreado(pedido.numero_pedido, pedido.codigo_retiro)
        setPaso('exito')
      }
    }
    else { onPedidoCreado(pedido.numero_pedido, pedido.codigo_retiro); setPaso('exito') }
  }

  async function confirmarTransferencia() {
    let p = pedidoRef.current
    if (!p) {
      // F-C prepago: el pedido se crea RECIÉN acá, con el comprobante en mano
      if (prepagoTA && !captura) { setErrorPedido('Subí el comprobante de tu transferencia para confirmar el pedido.'); return }
      setErrorPedido(null)
      const creado = await crearPedido('transferencia')
      if (!creado) return
      p = pedidoRef.current
      if (!p) return
    }
    if (captura) await subirCaptura(p.id) // la API sube y guarda la URL en el pedido
    onPedidoCreado(p.numero, p.codigo)
    setPaso('exito')
  }

  // ── DATOS ──
  if (paso === 'datos') return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <Header onBack={onVolver} title={esTakeaway ? 'Tu pedido para retirar' : 'Datos de entrega'} />
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-48">
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4 space-y-4">
          {[
            { key: 'nombre', label: esTakeaway ? 'Tu nombre' : 'Nombre y apellido', placeholder: 'Juan García', type: 'text', required: true },
            ...(esTakeaway ? [] : [
              { key: 'telefono', label: 'Teléfono', placeholder: '3491 123456', type: 'tel', required: true },
              { key: 'direccion', label: 'Dirección', placeholder: 'San Martín 456', type: 'text', required: true },
              { key: 'entre_calles', label: 'Entre calles', placeholder: '268 y 270', type: 'text', required: true },
            ] as const),
          ].map(({ key, label, placeholder, type, required }) => (
            <div key={key}>
              <label className="text-xs font-semibold text-neutral-500 mb-1 block">
                {label} {required && <span className="text-red-400">*</span>}
              </label>
              <input
                type={type}
                value={datos[key as keyof DatosDelivery]}
                onChange={e => setDatos(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className={`w-full px-4 py-3 rounded-xl border text-base bg-white outline-none transition-colors ${
                  erroresCampos[key as keyof DatosDelivery]
                    ? 'border-red-300 focus:border-red-400'
                    : 'border-neutral-200 focus:border-neutral-400'
                }`}
              />
              {erroresCampos[key as keyof DatosDelivery] && (
                <p className="text-xs text-red-400 mt-1">{erroresCampos[key as keyof DatosDelivery]}</p>
              )}
            </div>
          ))}
        </div>

        {esTakeaway && slotsRetiro.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4">
            <p className="text-xs font-semibold text-neutral-500 mb-2">¿Cuándo lo retirás?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setHoraRetiro(null)}
                className={`px-3.5 py-2 rounded-xl text-sm font-bold border transition-colors ${horaRetiro === null ? 'text-white border-transparent' : 'bg-white text-neutral-500 border-neutral-200'}`}
                style={horaRetiro === null ? { backgroundColor: config.primary_color } : undefined}>
                ⚡ Lo antes posible
              </button>
              {slotsRetiro.map(s => (
                <button key={s.iso} type="button" onClick={() => setHoraRetiro(s.iso)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-bold border transition-colors ${horaRetiro === s.iso ? 'text-white border-transparent' : 'bg-white text-neutral-500 border-neutral-200'}`}
                  style={horaRetiro === s.iso ? { backgroundColor: config.primary_color } : undefined}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 px-4 pt-3 pb-6 shadow-lg">
        <ResumenTotal subtotal={subtotal} costoEnvio={costoEnvio} total={total} config={config} esTakeaway={esTakeaway} />
        <button onClick={confirmarDatos}
          className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-md active:scale-98 transition-all"
          style={{ backgroundColor: config.primary_color }}>
          Continuar al pago →
        </button>
      </div>
    </div>
  )

  // ── PAGO ──
  if (paso === 'pago') {
    const metodos: { id: string; label: string; desc: string }[] = []
    if (pagosSucursal?.acepta_efectivo) metodos.push({ id: 'efectivo', label: esTakeaway ? 'Efectivo al retirar' : 'Efectivo al repartidor', desc: esTakeaway ? 'Pagás cuando retires tu pedido' : 'Pagás cuando llegue tu pedido' })
    if (pagosSucursal?.acepta_transferencia) metodos.push({ id: 'transferencia', label: 'Transferencia bancaria', desc: `Alias: ${pagosSucursal.cbu_transferencia ?? ''}${pagosSucursal.titular_transferencia ? ` · a nombre de ${pagosSucursal.titular_transferencia}` : ''}` })
    // FASE 4: acepta_mp llega RESUELTO del server (credencial usable + checkbox + llave del canal)
    if (mpPermitido && pagosSucursal?.acepta_mp) metodos.push({ id: 'mp', label: 'Mercado Pago', desc: 'Pagá con QR o link' })
    // F-C: fin del fallback que resucitaba efectivo con lista vacía — si la
    // config no deja ningún medio, se dice de frente (y el server igual manda).

    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
        <Header onBack={() => setPaso('datos')} title="Método de pago" />
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
          <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wide font-semibold mb-2">Entregar a</p>
            <p className="font-bold text-neutral-800">{datos.nombre}</p>
            <p className="text-sm text-neutral-500 mt-0.5">{datos.direccion}{datos.entre_calles ? ` (entre ${datos.entre_calles})` : ''}</p>
            <p className="text-sm text-neutral-500">{datos.telefono}</p>
          </div>

          <div className="space-y-3 mb-4">
            {metodos.map(m => (
              <button key={m.id} onClick={() => setMetodoPago(m.id)}
                className="w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all bg-white text-left active:scale-98"
                style={metodoPago === m.id ? { borderColor: config.primary_color } : { borderColor: '#F3F4F6' }}>
                <div className="flex-1">
                  <p className="font-bold text-neutral-800">{m.label}</p>
                  <p className="text-neutral-400 text-sm mt-0.5">{m.desc}</p>
                </div>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                  style={metodoPago === m.id ? { borderColor: config.primary_color, backgroundColor: config.primary_color } : { borderColor: '#D1D5DB' }}>
                  {metodoPago === m.id && <div className="w-2 h-2 bg-white rounded-full" />}
                </div>
              </button>
            ))}
          </div>

          <ResumenTotal subtotal={subtotal} costoEnvio={costoEnvio} total={total} config={config} esTakeaway={esTakeaway} />

          {errorPedido && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setErrorPedido(null)} />
                        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-7 text-center">
                          <div className="text-5xl mb-3">⚠️</div>
                          <h3 className="font-black text-neutral-900 text-xl mb-2">No pudimos crear tu pedido</h3>
                          <p className="text-neutral-500 text-sm mb-6">{errorPedido}</p>
                          <button onClick={() => setErrorPedido(null)}
                            className="w-full py-3.5 rounded-2xl bg-neutral-900 text-white font-bold text-base active:scale-98 transition-all">
                            Entendido
                          </button>
                        </div>
                      </div>
                    )}

          {metodos.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 text-center">
              <p className="text-amber-800 text-sm font-semibold">😕 No hay medios de pago disponibles en este momento. Consultá en el local.</p>
            </div>
          )}
          <button onClick={confirmarPago} disabled={creando || metodos.length === 0}
            className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-md active:scale-98 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: config.primary_color }}>
            {creando ? <><Loader2 className="h-5 w-5 animate-spin" /> Procesando...</> : 'Confirmar pedido →'}
          </button>
        </div>
      </div>
    )
  }

  // ── TRANSFERENCIA ──
  if (paso === 'transferencia') return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <Header title="Transferencia bancaria" />
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4">
          <div className="bg-neutral-50 rounded-xl p-4 mb-3">
            <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Monto a transferir</p>
            <p className="text-3xl font-black" style={{ color: config.primary_color }}>{formatPrecio(total)}</p>
          </div>
          {pagosSucursal?.cbu_transferencia && (
            <div className="rounded-xl p-4 mb-3 border-2" style={{ borderColor: config.primary_color, backgroundColor: `${config.primary_color}08` }}>
              <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">Alias / CBU — tocá para copiar</p>
              <button onClick={() => { navigator.clipboard.writeText(pagosSucursal.cbu_transferencia!); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }}
                className="w-full text-left active:opacity-70 transition-opacity">
                <p className="font-black text-2xl break-all leading-tight" style={{ color: config.primary_color }}>{pagosSucursal.cbu_transferencia}</p>
              </button>
              {copiado
                ? <p className="text-green-600 text-sm font-bold mt-2 flex items-center gap-1"><Check className="h-4 w-4" /> ¡Copiado!</p>
                : <p className="text-xs mt-2" style={{ color: config.primary_color }}>Tocá el alias para copiarlo</p>
              }
              {pagosSucursal.titular_transferencia && (
                <p className="text-xs text-neutral-400 mt-2">A nombre de <span className="font-semibold text-neutral-600">{pagosSucursal.titular_transferencia}</span></p>
              )}
            </div>
          )}
          {pedidoNum !== null && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-amber-700 text-xs text-center font-medium">Incluí el número de pedido #{pedidoNum} en el comentario</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4">
          <p className="text-sm font-bold text-neutral-700 mb-1">Subir comprobante</p>
          <p className="text-xs text-neutral-400 mb-3">{prepagoTA ? '📎 Obligatorio — tu pedido se confirma con el comprobante' : 'Opcional pero recomendado — acelera la confirmación'}</p>
          {capturaPreview ? (
            <div className="relative rounded-xl overflow-hidden">
              <img src={capturaPreview} alt="Comprobante" className="w-full max-h-52 object-contain bg-neutral-50" />
              <button onClick={() => { setCaptura(null); setCapturaPreview(null) }}
                className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center shadow active:scale-90">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button onClick={() => fileInputRef.current?.click()}
              className="w-full h-28 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 active:bg-neutral-100 transition-colors flex flex-col items-center justify-center gap-2 text-neutral-400">
              <Upload className="h-6 w-6" />
              <span className="text-sm font-medium">Subir captura de pantalla</span>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCaptura(f); e.target.value = '' }} />
        </div>

        {errorPedido && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-3 text-center">
            <p className="text-red-600 text-sm font-semibold">{errorPedido}</p>
          </div>
        )}
        <button onClick={confirmarTransferencia} disabled={subiendoCaptura || creando || (prepagoTA && !pedidoRef.current && !captura)}
          className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-md active:scale-98 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ backgroundColor: config.primary_color }}>
          {(subiendoCaptura || creando) ? <><Loader2 className="h-5 w-5 animate-spin" /> {creando ? 'Confirmando...' : 'Subiendo...'}</> : (pedidoRef.current ? '✅ Ya realicé la transferencia' : '✅ Confirmar pedido')}
        </button>
      </div>
    </div>
  )

  // ── F-D (orden CTO 20/09): comprobante como imagen descargable ──
  // Canvas dibujado a mano — cero dependencias, cero infraestructura. Botón
  // explícito (gesto del usuario: robusto en iOS/Safari), nunca auto-descarga.
  // El cliente sin cuenta se lleva su evidencia; el flujo de compra no cambia.
  async function guardarComprobante() {
    const num = pedidoCreado?.numero ?? pedidoNum
    const cod = pedidoCreado?.codigo ?? codigoRetiro
    const comercio = ((dispositivo as unknown as { empresas?: { nombre?: string } }).empresas?.nombre) ?? ''
    // Logo del comercio (pedido JC): se intenta cargar con timeout — si falla
    // (red/CORS), el comprobante sale igual sin logo. La descarga nunca se
    // bloquea por una imagen.
    let logo: HTMLImageElement | null = null
    if (config.logo_url) {
      logo = await new Promise<HTMLImageElement | null>(res => {
        const im = new Image()
        im.crossOrigin = 'anonymous'
        const t = setTimeout(() => res(null), 2500)
        im.onload = () => { clearTimeout(t); res(im) }
        im.onerror = () => { clearTimeout(t); res(null) }
        im.src = config.logo_url as string
      })
    }
    const W = 640
    const lineas = carrito.length + (costoEnvio > 0 && !esTakeaway ? 1 : 0)
    const H = 460 + lineas * 34 + (esTakeaway && cod ? 110 : 0) + (esTakeaway && cod && (horaConfirmada || slotsRetiro.length > 0) ? 40 : 0) + (logo ? 96 : 0)
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const cx = cv.getContext('2d')
    if (!cx) return
    // fondo blanco
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H)
    let y = 56
    cx.textAlign = 'center'; cx.fillStyle = '#171717'
    if (logo) {
      const maxH = 72, maxW = 260
      const esc = Math.min(maxH / logo.height, maxW / logo.width, 1)
      const lw = logo.width * esc, lh = logo.height * esc
      try { cx.drawImage(logo, (W - lw) / 2, y - 34, lw, lh); y += lh + 14 } catch { /* canvas tainted: seguimos sin logo */ }
    }
    if (comercio) { cx.font = 'bold 26px system-ui, sans-serif'; cx.fillText(comercio, W / 2, y); y += 30 }
    cx.font = '13px system-ui, sans-serif'; cx.fillStyle = '#a3a3a3'
    cx.fillText('COMPROBANTE DE PEDIDO · ' + new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), W / 2, y); y += 44
    // número
    cx.fillStyle = config.primary_color || '#171717'
    cx.font = '900 84px system-ui, sans-serif'
    cx.fillText('#' + (num ?? ''), W / 2, y + 40); y += 96
    // código de retiro (TA)
    if (esTakeaway && cod) {
      cx.font = '12px system-ui, sans-serif'; cx.fillStyle = '#a3a3a3'
      cx.fillText('CÓDIGO DE RETIRO', W / 2, y); y += 34
      cx.font = '900 52px ui-monospace, monospace'; cx.fillStyle = config.primary_color || '#171717'
      cx.fillText(cod, W / 2, y); y += 44
      // hora de retiro elegida (matriz F-C test 8): el dato que el mostrador y
      // el cliente van a mirar juntos — al comprobante también
      const horaComprobante = horaConfirmada
        ? new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(horaConfirmada))
        : (slotsRetiro.length > 0 ? `desde las ${slotsRetiro[0].label}` : null)
      if (horaComprobante) {
        cx.font = 'bold 20px system-ui, sans-serif'; cx.fillStyle = '#404040'
        cx.fillText(`🕐 Retiro: ${horaComprobante}`, W / 2, y); y += 36
      }
    }
    // separador
    cx.strokeStyle = '#e5e5e5'; cx.beginPath(); cx.moveTo(48, y); cx.lineTo(W - 48, y); cx.stroke(); y += 34
    // detalle
    cx.textAlign = 'left'; cx.font = '16px system-ui, sans-serif'
    for (const it of carrito) {
      cx.fillStyle = '#404040'
      const nom = `${it.cantidad > 1 ? it.cantidad + '× ' : ''}${it.nombre_producto} — ${it.nombre_presentacion}`
      cx.fillText(nom.length > 44 ? nom.slice(0, 43) + '…' : nom, 48, y)
      cx.textAlign = 'right'; cx.fillText(formatPrecio(it.precio * it.cantidad), W - 48, y)
      cx.textAlign = 'left'; y += 34
    }
    if (costoEnvio > 0 && !esTakeaway) {
      cx.fillStyle = '#737373'; cx.fillText('Envío', 48, y)
      cx.textAlign = 'right'; cx.fillText(formatPrecio(costoEnvio), W - 48, y)
      cx.textAlign = 'left'; y += 34
    }
    cx.strokeStyle = '#e5e5e5'; cx.beginPath(); cx.moveTo(48, y); cx.lineTo(W - 48, y); cx.stroke(); y += 40
    cx.font = '900 26px system-ui, sans-serif'; cx.fillStyle = '#171717'
    cx.fillText('TOTAL', 48, y)
    cx.textAlign = 'right'; cx.fillStyle = config.primary_color || '#171717'; cx.fillText(formatPrecio(total), W - 48, y)
    // pie
    y += 48; cx.textAlign = 'center'; cx.font = '13px system-ui, sans-serif'; cx.fillStyle = '#a3a3a3'
    cx.fillText(esTakeaway ? 'Presentá este comprobante al retirar tu pedido' : 'Presentá este comprobante al recibir tu pedido', W / 2, y)
    // descarga (gesto del usuario)
    cv.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pedido-${num ?? 'coneos'}${cod ? '-' + cod : ''}.png`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }, 'image/png')
  }

  // ── ÉXITO ──
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-sm">
        {config.logo_url && <img src={config.logo_url} alt="Logo" width={140} height={56} className="object-contain mx-auto mb-6" />}
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-md" style={{ backgroundColor: config.primary_color }}>
          <CheckCircle className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-black text-center mb-1" style={{ color: config.primary_color }}>¡Pedido confirmado!</h1>
        <p className="text-neutral-400 text-sm text-center mb-6">{esTakeaway ? (() => {
          // Condición CTO: mostrar SOLO la hora confirmada por el server (viaja
          // en la respuesta únicamente si quedó guardada; fallo = ASAP honesto)
          const horaConf = horaConfirmada
          return horaConf ? 'Tu pedido quedó registrado' : 'Tu pedido quedó registrado para retirar'
        })() : `Te contactaremos al ${datos.telefono}`}</p>

        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 mb-4">
          <div className="text-center mb-4">
            <p className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Número de pedido</p>
            <p className="font-black" style={{ fontSize: '4rem', lineHeight: 1, color: config.primary_color }}>#{pedidoCreado?.numero ?? pedidoNum}</p>
          </div>
          {esTakeaway && (
            <div className="text-center mb-4 rounded-2xl py-4" style={{ backgroundColor: `${config.primary_color}0d` }}>
              <p className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Código de retiro</p>
              <p className="font-black tracking-[0.3em]" style={{ fontSize: '3.2rem', lineHeight: 1, color: config.primary_color }}>{pedidoCreado?.codigo ?? codigoRetiro}</p>
              <p className="text-neutral-500 text-xs mt-2 font-semibold">Mostrá este código al retirar tu pedido</p>
              {horaConfirmada ? (
                <p className="inline-block mt-3 px-4 py-2 rounded-xl text-white font-bold text-base" style={{ backgroundColor: config.primary_color }}>
                  🕐 Retiralo a las {new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(horaConfirmada))}
                </p>
              ) : slotsRetiro.length > 0 ? (
                // "Lo antes posible": el dato útil es el PRÓXIMO retiro posible,
                // no el rango del día entero (pedido JC, matriz F-C)
                <p className="inline-block mt-3 px-4 py-2 rounded-xl text-white font-bold text-base" style={{ backgroundColor: config.primary_color }}>
                  🕐 Retiralo desde las {slotsRetiro[0].label}
                </p>
              ) : (
                horarioTexto && <p className="text-neutral-400 text-xs mt-1">🕗 Horario de retiro: {horarioTexto}</p>
              )}
            </div>
          )}
          <div className="border-t border-neutral-100 pt-4 space-y-1.5">
            <p className="text-sm text-neutral-600"><span className="font-semibold">Nombre:</span> {datos.nombre}</p>
            {!esTakeaway && <p className="text-sm text-neutral-600"><span className="font-semibold">Dirección:</span> {datos.direccion}</p>}
            {!esTakeaway && datos.entre_calles && <p className="text-sm text-neutral-600"><span className="font-semibold">Entre:</span> {datos.entre_calles}</p>}
            {!esTakeaway && <p className="text-sm text-neutral-600"><span className="font-semibold">Tel:</span> {datos.telefono}</p>}
            <p className="text-sm font-bold mt-2 pt-2 border-t border-neutral-100" style={{ color: config.primary_color }}>Total: {formatPrecio(total)}</p>
            {metodoPago === 'efectivo' && <p className="text-xs text-amber-600">💵 {esTakeaway ? 'Pagás en el mostrador al retirar' : 'Pagás al repartidor cuando llegue'}</p>}
            {metodoPago === 'transferencia' && <p className="text-xs text-blue-600">📲 Transferencia {captura ? 'enviada ✓' : 'pendiente de confirmación'}</p>}
            {benefPesosPorPunto && (() => {
              const base = carrito.reduce((s, i) => s + (i.precio > 0 ? i.precio * i.cantidad : 0), 0)
              const pts = Math.floor(base / benefPesosPorPunto)
              return pts > 0 ? <p className="text-xs text-green-600 font-semibold">🎁 Al pagar vas a sumar {pts} puntos con tu celu</p> : null
            })()}
          </div>
        </div>

        <button onClick={guardarComprobante}
          className="w-full py-3.5 rounded-2xl text-white font-bold text-sm active:opacity-80 transition-opacity mb-3 shadow-sm"
          style={{ backgroundColor: config.primary_color }}>
          ⬇️ Guardar comprobante
        </button>
        <button onClick={onNuevoPedido}
          className="w-full py-3.5 rounded-2xl border-2 border-neutral-200 text-neutral-600 font-semibold text-sm active:bg-neutral-50 transition-colors">
          Hacer otro pedido
        </button>
      </div>
    </div>
  )
}
