'use client'

import { useEffect, useState, useRef } from 'react'

import { Loader2, CheckCircle, Copy, Check, Truck, Upload, X, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito } from '@/app/[empresa]/delivery/[sucursal]/page'

interface Props {
  config: EmpresaConfig; dispositivo: DispositivoKiosk; carrito: ItemCarrito[]
  costoEnvio: number; pedidoCreado: { numero: number; codigo: string } | null
  onPedidoCreado: (numero: number, codigo: string) => void
  onNuevoPedido: () => void; onVolver: () => void
}
interface DatosDelivery { nombre: string; telefono: string; direccion: string; entre_calles: string }
interface PagosSucursal { acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean; cbu_transferencia: string | null; mp_access_token: string | null }

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

function Header({ onBack, title }: { onBack?: () => void; title: string }) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-neutral-100 px-4 py-3 flex items-center gap-2">
      {onBack && <button onClick={onBack} className="p-2 -ml-2 text-neutral-400 active:bg-neutral-100 rounded-xl"><ArrowLeft className="h-5 w-5" /></button>}
      <h1 className="font-bold text-lg text-neutral-800">{title}</h1>
    </div>
  )
}

function ResumenTotal({ subtotal, costoEnvio, total, config }: { subtotal: number; costoEnvio: number; total: number; config: EmpresaConfig }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-4">
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-neutral-400">Subtotal</span>
        <span className="font-medium text-neutral-600">{formatPrecio(subtotal)}</span>
      </div>
      <div className="flex justify-between text-sm mb-2.5">
        <span className="text-neutral-400 flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Envío</span>
        <span className="font-medium text-neutral-600">{formatPrecio(costoEnvio)}</span>
      </div>
      <div className="flex justify-between border-t border-neutral-100 pt-2.5">
        <span className="font-bold text-neutral-800">Total</span>
        <span className="font-black text-xl" style={{ color: config.primary_color }}>{formatPrecio(total)}</span>
      </div>
    </div>
  )
}

export default function KioskConfirmacionDelivery({ config, dispositivo, carrito, costoEnvio, pedidoCreado, onPedidoCreado, onNuevoPedido, onVolver }: Props) {
  const subtotal = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const total = subtotal + costoEnvio

  const [paso, setPaso] = useState<'datos' | 'pago' | 'transferencia' | 'exito'>('datos')
  const [datos, setDatos] = useState<DatosDelivery>({ nombre: '', telefono: '', direccion: '', entre_calles: '' })
  const [erroresCampos, setErroresCampos] = useState<Partial<DatosDelivery>>({})
  const [mpDisponible, setMpDisponible] = useState(false)

  useEffect(() => {
    // Verificar si la empresa tiene MP conectado via OAuth
    fetch(`/api/mp/estado?empresa_id=${dispositivo.empresa_id}`)
      .then(r => r.json())
      .then(d => setMpDisponible(!!d.conectado))
      .catch(() => setMpDisponible(false))
  }, [dispositivo.empresa_id])
  const [metodoPago, setMetodoPago] = useState('efectivo')
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
    fetch(`/api/kiosk/pagos?sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json()).then(data => { setPagosSucursal(data) })
  }, [dispositivo])

  function handleCaptura(file: File) {
    setCaptura(file)
    const reader = new FileReader()
    reader.onload = e => setCapturaPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function subirCaptura(pid: string): Promise<string | null> {
    if (!captura) return null
    setSubiendoCaptura(true)
    const supabase = createClient()
    const ext = captura.name.split('.').pop()
    const path = `pedidos/${pid}.${ext}`
    const { error } = await supabase.storage.from('capturas').upload(path, captura, { upsert: true })
    if (error) { setSubiendoCaptura(false); return null }
    const { data } = supabase.storage.from('capturas').getPublicUrl(path)
    setSubiendoCaptura(false)
    return data.publicUrl
  }

  async function crearPedido(metodo: string) {
    setCreando(true)
    console.log('[delivery] carrito al crear pedido:', carrito)
    const items = carrito.map(item => ({
      presentacion_id: item.presentacion_id,
      nombre_producto_snap: item.nombre_producto,
      nombre_presentacion_snap: item.nombre_presentacion,
      precio_snap: item.precio, cantidad: item.cantidad,
      opciones: item.opciones.map(op => ({ opcion_id: op.opcion_id, nombre_snap: op.nombre, emoji_snap: op.emoji, color_snap: op.color })),
    }))
    const res = await fetch('/api/pedidos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: dispositivo.empresa_id, sucursal_id: dispositivo.sucursal_id, dispositivo_id: dispositivo.id, items, metodo_pago: metodo, origen: 'DELIVERY', tipo_pedido: 'delivery', costo_envio: costoEnvio, datos_delivery: datos }),
    })
    const data = await res.json()
    setCreando(false)
    if (!res.ok || !data.pedido) return null
    setPedidoId(data.pedido.id)
    setPedidoNum(data.pedido.numero_pedido)
    setCodigoRetiro(data.pedido.codigo_retiro)
    pedidoRef.current = { id: data.pedido.id, numero: data.pedido.numero_pedido, codigo: data.pedido.codigo_retiro }
    return data.pedido
  }

  function confirmarDatos() {
    const errs: Partial<DatosDelivery> = {}
    if (!datos.nombre.trim()) errs.nombre = 'Ingresá tu nombre'
    if (!datos.telefono.trim()) errs.telefono = 'Ingresá tu teléfono'
    if (!datos.direccion.trim()) errs.direccion = 'Ingresá tu dirección'
    if (!datos.entre_calles.trim()) errs.entre_calles = 'Ingresá las calles de referencia'
    setErroresCampos(errs)
    if (Object.keys(errs).length > 0) return
    setPaso('pago')
  }

  async function confirmarPago() {
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
    const p = pedidoRef.current
    if (!p) return
    if (captura) {
      const url = await subirCaptura(p.id)
      if (url) {
        await createClient().from('pedidos').update({ captura_transferencia_url: url }).eq('id', p.id)
      }
    }
    onPedidoCreado(p.numero, p.codigo)
    setPaso('exito')
  }

  // ── DATOS ──
  if (paso === 'datos') return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <Header onBack={onVolver} title="Datos de entrega" />
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-48">
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4 space-y-4">
          {[
            { key: 'nombre', label: 'Nombre y apellido', placeholder: 'Juan García', type: 'text', required: true },
            { key: 'telefono', label: 'Teléfono', placeholder: '3491 123456', type: 'tel', required: true },
            { key: 'direccion', label: 'Dirección', placeholder: 'San Martín 456', type: 'text', required: true },
            { key: 'entre_calles', label: 'Entre calles', placeholder: '268 y 270', type: 'text', required: true },
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
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-100 px-4 pt-3 pb-6 shadow-lg">
        <ResumenTotal subtotal={subtotal} costoEnvio={costoEnvio} total={total} config={config} />
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
    const mpConfigurado = mpDisponible
    const metodos: { id: string; label: string; desc: string }[] = []
    if (pagosSucursal?.acepta_efectivo) metodos.push({ id: 'efectivo', label: 'Efectivo al repartidor', desc: 'Pagás cuando llegue tu pedido' })
    if (pagosSucursal?.acepta_transferencia) metodos.push({ id: 'transferencia', label: 'Transferencia bancaria', desc: `Alias: ${pagosSucursal.cbu_transferencia ?? ''}` })
    if (pagosSucursal?.acepta_mp && (pagosSucursal as { acepta_mp_delivery?: boolean }).acepta_mp_delivery !== false && mpConfigurado) metodos.push({ id: 'mp', label: 'Mercado Pago', desc: 'Pagá con QR o link' })
    if (!metodos.length) metodos.push({ id: 'efectivo', label: 'Efectivo al repartidor', desc: 'Pagás cuando llegue tu pedido' })

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

          <ResumenTotal subtotal={subtotal} costoEnvio={costoEnvio} total={total} config={config} />

          <button onClick={confirmarPago} disabled={creando}
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
            </div>
          )}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-amber-700 text-xs text-center font-medium">Incluí el número de pedido #{pedidoNum} en el comentario</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 mb-4">
          <p className="text-sm font-bold text-neutral-700 mb-1">Subir comprobante</p>
          <p className="text-xs text-neutral-400 mb-3">Opcional pero recomendado — acelera la confirmación</p>
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
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCaptura(f); e.target.value = '' }} />
        </div>

        <button onClick={confirmarTransferencia} disabled={subiendoCaptura}
          className="w-full py-4 rounded-2xl text-white font-bold text-base shadow-md active:scale-98 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ backgroundColor: config.primary_color }}>
          {subiendoCaptura ? <><Loader2 className="h-5 w-5 animate-spin" /> Subiendo...</> : '✅ Ya realicé la transferencia'}
        </button>
      </div>
    </div>
  )

  // ── ÉXITO ──
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-sm">
        {config.logo_url && <img src={config.logo_url} alt="Logo" width={140} height={56} className="object-contain mx-auto mb-6" />}
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-md" style={{ backgroundColor: config.primary_color }}>
          <CheckCircle className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-black text-center mb-1" style={{ color: config.primary_color }}>¡Pedido confirmado!</h1>
        <p className="text-neutral-400 text-sm text-center mb-6">Te contactaremos al {datos.telefono}</p>

        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 mb-4">
          <div className="text-center mb-4">
            <p className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Número de pedido</p>
            <p className="font-black" style={{ fontSize: '4rem', lineHeight: 1, color: config.primary_color }}>#{pedidoCreado?.numero ?? pedidoNum}</p>
          </div>
          <div className="border-t border-neutral-100 pt-4 space-y-1.5">
            <p className="text-sm text-neutral-600"><span className="font-semibold">Nombre:</span> {datos.nombre}</p>
            <p className="text-sm text-neutral-600"><span className="font-semibold">Dirección:</span> {datos.direccion}</p>
            {datos.entre_calles && <p className="text-sm text-neutral-600"><span className="font-semibold">Entre:</span> {datos.entre_calles}</p>}
            <p className="text-sm text-neutral-600"><span className="font-semibold">Tel:</span> {datos.telefono}</p>
            <p className="text-sm font-bold mt-2 pt-2 border-t border-neutral-100" style={{ color: config.primary_color }}>Total: {formatPrecio(total)}</p>
            {metodoPago === 'efectivo' && <p className="text-xs text-amber-600">💵 Pagás al repartidor cuando llegue</p>}
            {metodoPago === 'transferencia' && <p className="text-xs text-blue-600">📲 Transferencia {captura ? 'enviada ✓' : 'pendiente de confirmación'}</p>}
          </div>
        </div>

        <button onClick={onNuevoPedido}
          className="w-full py-3.5 rounded-2xl border-2 border-neutral-200 text-neutral-600 font-semibold text-sm active:bg-neutral-50 transition-colors">
          Hacer otro pedido
        </button>
      </div>
    </div>
  )
}
