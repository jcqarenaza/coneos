'use client'

import { useEffect, useState, useRef } from 'react'
import Image from 'next/image'
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
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [pagosSucursal, setPagosSucursal] = useState<PagosSucursal | null>(null)
  const [creando, setCreando] = useState(false)
  const [pedidoId, setPedidoId] = useState<string | null>(null)
  const [pedidoNum, setPedidoNum] = useState<number | null>(null)
  const [codigoRetiro, setCodigoRetiro] = useState<string>('')
  const [copiado, setCopiado] = useState(false)
  const [captura, setCaptura] = useState<File | null>(null)
  const [capturaPreview, setCapturaPreview] = useState<string | null>(null)
  const [subiendoCaptura, setSubiendoCaptura] = useState(false)
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const errores: Partial<DatosDelivery> = {}
  if (!datos.nombre.trim()) errores.nombre = 'Ingresá tu nombre'
  if (!datos.telefono.trim()) errores.telefono = 'Ingresá tu teléfono'
  if (!datos.direccion.trim()) errores.direccion = 'Ingresá tu dirección'

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
    return data.pedido
  }

  async function confirmarDatos() {
    setIntentoEnvio(true)
    if (Object.keys(errores).length > 0) return
    setPaso('pago')
  }

  async function confirmarPago() {
    const pedido = await crearPedido(metodoPago)
    if (!pedido) return
    if (metodoPago === 'transferencia') { setPaso('transferencia') }
    else { onPedidoCreado(pedido.numero_pedido, pedido.codigo_retiro); setPaso('exito') }
  }

  async function confirmarTransferencia() {
    if (!pedidoId || !pedidoNum) return
    if (captura) {
      const url = await subirCaptura(pedidoId)
      if (url) {
        await createClient().from('pedidos').update({ captura_transferencia_url: url }).eq('id', pedidoId)
      }
    }
    onPedidoCreado(pedidoNum, codigoRetiro)
    setPaso('exito')
  }

  function Input({ label, value, onChange, placeholder, type = 'text', error, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; error?: string; required?: boolean }) {
    return (
      <div>
        <label className="text-sm font-semibold text-neutral-700 block mb-1.5">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type}
          className={`w-full px-4 py-3.5 rounded-2xl border text-base focus:outline-none transition-colors ${error ? 'border-red-300 bg-red-50' : 'border-neutral-200 focus:border-neutral-400'}`}
          style={{ fontSize: '16px' }} // Evita zoom en iOS
        />
        {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
      </div>
    )
  }

  // ── DATOS ──
  if (paso === 'datos') return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      <Header onBack={onVolver} title="Datos de entrega" />
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 space-y-4 mb-4">
          <Input label="Nombre y apellido" value={datos.nombre} onChange={v => setDatos({ ...datos, nombre: v })}
            placeholder="Juan García" required error={intentoEnvio ? errores.nombre : undefined} />
          <Input label="Teléfono" value={datos.telefono} onChange={v => setDatos({ ...datos, telefono: v })}
            placeholder="3302 123456" type="tel" required error={intentoEnvio ? errores.telefono : undefined} />
          <Input label="Dirección" value={datos.direccion} onChange={v => setDatos({ ...datos, direccion: v })}
            placeholder="San Martín 456" required error={intentoEnvio ? errores.direccion : undefined} />
          <Input label="Entre calles (opcional)" value={datos.entre_calles} onChange={v => setDatos({ ...datos, entre_calles: v })}
            placeholder="Rivadavia y Belgrano" />
        </div>
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
    const metodos = []
    if (pagosSucursal?.acepta_efectivo) metodos.push({ id: 'efectivo', label: 'Efectivo al repartidor', desc: 'Pagás cuando llegue tu pedido' })
    const mpConfigurado = pagosSucursal?.mp_access_token?.startsWith('APP_USR-')
    if (pagosSucursal?.acepta_transferencia && pagosSucursal?.cbu_transferencia) metodos.push({ id: 'transferencia', label: 'Transferencia bancaria', desc: `Alias: ${pagosSucursal.cbu_transferencia}` })
    if (pagosSucursal?.acepta_mp && mpConfigurado) metodos.push({ id: 'mp', label: 'Mercado Pago', desc: 'Pagá con QR o link' })
    if (!metodos.length) metodos.push({ id: 'efectivo', label: 'Efectivo al repartidor', desc: 'Pagás cuando llegue tu pedido' })

    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
        <Header onBack={() => setPaso('datos')} title="Método de pago" />
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
          {/* Resumen entrega */}
          <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-4">
            <p className="text-xs text-neutral-400 uppercase tracking-wide font-semibold mb-2">Entregar a</p>
            <p className="font-bold text-neutral-800">{datos.nombre}</p>
            <p className="text-sm text-neutral-500 mt-0.5">{datos.direccion}{datos.entre_calles ? ` (entre ${datos.entre_calles})` : ''}</p>
            <p className="text-sm text-neutral-500">{datos.telefono}</p>
          </div>

          {/* Métodos */}
          <div className="space-y-3 mb-4">
            {metodos.map(m => (
              <button key={m.id} onClick={() => setMetodoPago(m.id)}
                className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 transition-all bg-white text-left active:scale-98`}
                style={metodoPago === m.id ? { borderColor: config.primary_color } : { borderColor: '#F3F4F6' }}>
                <div className="flex-1">
                  <p className="font-bold text-neutral-800">{m.label}</p>
                  <p className="text-neutral-400 text-sm mt-0.5">{m.desc}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors`}
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
            <div className="bg-neutral-50 rounded-xl p-4 mb-3">
              <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">Alias / CBU</p>
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono font-bold text-neutral-800 text-lg break-all">{pagosSucursal.cbu_transferencia}</p>
                <button onClick={() => { navigator.clipboard.writeText(pagosSucursal.cbu_transferencia!); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold transition-colors active:scale-95"
                  style={{ backgroundColor: copiado ? '#dcfce7' : `${config.primary_color}15`, color: copiado ? '#16a34a' : config.primary_color }}>
                  {copiado ? <><Check className="h-3.5 w-3.5" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
                </button>
              </div>
            </div>
          )}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-amber-700 text-xs text-center font-medium">Incluí el número de pedido #{pedidoNum} en el comentario</p>
          </div>
        </div>

        {/* Subir captura */}
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
        {config.logo_url && <Image src={config.logo_url} alt="Logo" width={140} height={56} className="object-contain mx-auto mb-6" />}
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
