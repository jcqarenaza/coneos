'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2, CheckCircle, Plus, Minus, Bike } from 'lucide-react'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador { session_id: string; operador: { id: string } }
interface Categoria { id: string; nombre: string }
interface Producto { id: string; nombre: string; imagen_url: string | null; categoria_id: string }
interface Presentacion { id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; producto_id: string; imagen_url: string | null }
interface Grupo { id: string; nombre: string }
interface Opcion { id: string; nombre: string; emoji: string | null; color: string | null; imagen_url: string | null; grupo_id: string; precio_adicional: number }
interface PresGrupo { presentacion_id: string; grupo_id: string }
interface ItemCarrito {
  uid: string
  presentacion_id: string
  nombre_producto: string
  nombre_presentacion: string
  precio: number
  cantidad: number
  opciones: Opcion[]
}
interface DatosDelivery { nombre: string; telefono: string; direccion: string; entre_calles: string }
interface Props { dispositivo: Dispositivo; sesion: SesionOperador; onPedidoCreado: () => void }

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function uid() { return Math.random().toString(36).substring(2) + Date.now().toString(36) }

export default function NuevoPedido({ dispositivo, sesion, onPedidoCreado }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [presGrupos, setPresGrupos] = useState<PresGrupo[]>([])

  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null)
  const [productoActivo, setProductoActivo] = useState<Producto | null>(null)
  const [presentacionActiva, setPresentacionActiva] = useState<Presentacion | null>(null)
  const [opcionesSeleccionadas, setOpcionesSeleccionadas] = useState<Opcion[]>([])
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [notas, setNotas] = useState('')

  // Delivery telefónico
  const [esDelivery, setEsDelivery] = useState(false)
  const [datosDelivery, setDatosDelivery] = useState<DatosDelivery>({ nombre: '', telefono: '', direccion: '', entre_calles: '' })
  const [costoEnvio, setCostoEnvio] = useState(0)
  const [costoEnvioConfig, setCostoEnvioConfig] = useState(0)

  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      // Mismo catálogo que kiosk: fotos, grupos por presentación, disponibilidad por sucursal e inventario
      const [catRes, horaRes] = await Promise.all([
        fetch(`/api/kiosk/catalogo?empresa_id=${dispositivo.empresa_id}&sucursal_id=${dispositivo.sucursal_id}`),
        fetch(`/api/hora-argentina?sucursal_id=${dispositivo.sucursal_id}`),
      ])
      if (catRes.ok) {
        const cat = await catRes.json()
        setCategorias(cat.categorias ?? [])
        setProductos(cat.productos ?? [])
        setPresentaciones(cat.presentaciones ?? [])
        setGrupos(cat.grupos ?? [])
        setOpciones(cat.opciones ?? [])
        setPresGrupos(cat.presentacion_grupos ?? [])
        if (cat.categorias?.length) setCategoriaActiva(cat.categorias[0].id)
      }
      if (horaRes.ok) {
        const h = await horaRes.json()
        const costo = Number(h.delivery_config?.costo_envio ?? 0)
        setCostoEnvioConfig(costo)
        setCostoEnvio(costo)
      }
      setLoading(false)
    }
    init()
  }, [dispositivo])

  // Grupos de accesorios (por nombre, igual que kiosk)
  const grupoIdsAccesorios = new Set(grupos.filter(g => g.nombre.toLowerCase().includes('accesorio')).map(g => g.id))
  const accesorios = opciones.filter(op => grupoIdsAccesorios.has(op.grupo_id) && (op.precio_adicional ?? 0) > 0)

  // FIX bug sabores: solo opciones de los grupos vinculados a la presentación
  // (antes se listaban TODAS las opciones y se mezclaban toppings con sabores)
  function opcionesDePresentacion(pres: Presentacion): Opcion[] {
    const gruposDePres = new Set(presGrupos.filter(pg => pg.presentacion_id === pres.id).map(pg => pg.grupo_id))
    if (gruposDePres.size > 0) return opciones.filter(op => gruposDePres.has(op.grupo_id))
    // Fallback si la presentación no tiene grupos vinculados: todo menos accesorios
    return opciones.filter(op => !grupoIdsAccesorios.has(op.grupo_id))
  }

  function seleccionarPresentacion(p: Presentacion, prod: Producto) {
    setProductoActivo(prod)
    setOpcionesSeleccionadas([])
    if (p.permite_opciones) { setPresentacionActiva(p) }
    else {
      // Sin opciones: directo al carrito
      agregarItem(p, prod, [])
    }
  }

  function toggleOpcion(op: Opcion) {
    if (!presentacionActiva) return
    const ya = opcionesSeleccionadas.find(o => o.id === op.id)
    if (ya) { setOpcionesSeleccionadas(prev => prev.filter(o => o.id !== op.id)) }
    else { if (opcionesSeleccionadas.length >= presentacionActiva.opciones_max) return; setOpcionesSeleccionadas(prev => [...prev, op]) }
  }

  function agregarItem(pres: Presentacion, prod: Producto, ops: Opcion[]) {
    setCarrito(prev => [...prev, {
      uid: uid(), presentacion_id: pres.id,
      nombre_producto: prod.nombre, nombre_presentacion: pres.nombre,
      precio: pres.precio, cantidad: 1, opciones: ops,
    }])
    setPresentacionActiva(null); setProductoActivo(null); setOpcionesSeleccionadas([])
  }

  function confirmarConOpciones() {
    if (!presentacionActiva || !productoActivo) return
    if (opcionesSeleccionadas.length < presentacionActiva.opciones_min) return
    agregarItem(presentacionActiva, productoActivo, opcionesSeleccionadas)
  }

  function agregarAccesorio(acc: Opcion) {
    setCarrito(prev => {
      const existente = prev.find(i => i.presentacion_id === '' && i.nombre_presentacion === acc.nombre.replace(/^Toppings?\s+/i, ''))
      if (existente) return prev.map(i => i.uid === existente.uid ? { ...i, cantidad: i.cantidad + 1 } : i)
      return [...prev, {
        uid: uid(), presentacion_id: '',
        nombre_producto: 'Accesorios',
        nombre_presentacion: acc.nombre.replace(/^Toppings?\s+/i, ''),
        precio: acc.precio_adicional, cantidad: 1, opciones: [],
      }]
    })
  }

  function cambiarCantidad(id: string, delta: number) {
    setCarrito(prev => prev.map(i => i.uid === id ? { ...i, cantidad: Math.max(0, i.cantidad + delta) } : i).filter(i => i.cantidad > 0))
  }

  const subtotal = carrito.reduce((acc, item) => acc + item.precio * item.cantidad, 0)
  const total = subtotal + (esDelivery ? Number(costoEnvio) : 0)
  const deliveryValido = !esDelivery || (datosDelivery.nombre.trim() && datosDelivery.telefono.trim() && datosDelivery.direccion.trim())

  async function confirmarPedido() {
    if (!carrito.length || !deliveryValido) return
    setGuardando(true); setError(null)
    const items = carrito.map(item => ({
      presentacion_id: item.presentacion_id,
      nombre_producto_snap: item.nombre_producto,
      nombre_presentacion_snap: item.nombre_presentacion,
      precio_snap: item.precio,
      cantidad: item.cantidad,
      opciones: item.opciones.map(op => ({ opcion_id: op.id, nombre_snap: op.nombre, emoji_snap: op.emoji, color_snap: op.color })),
    }))
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresa_id: dispositivo.empresa_id, sucursal_id: dispositivo.sucursal_id,
        dispositivo_id: dispositivo.id, session_id: sesion.session_id,
        items, metodo_pago: metodoPago, notas: notas || null,
        ...(esDelivery ? {
          tipo_pedido: 'delivery',
          costo_envio: Number(costoEnvio),
          datos_delivery: {
            nombre: datosDelivery.nombre.trim(), telefono: datosDelivery.telefono.trim(),
            direccion: datosDelivery.direccion.trim(), entre_calles: datosDelivery.entre_calles.trim() || null,
          },
        } : {}),
      }),
    })
    setGuardando(false)
    if (res.ok) {
      setExito(true); setCarrito([]); setNotas(''); setEsDelivery(false)
      setDatosDelivery({ nombre: '', telefono: '', direccion: '', entre_calles: '' })
      setCostoEnvio(costoEnvioConfig)
      setTimeout(() => { setExito(false); onPedidoCreado() }, 1500)
    } else {
      const d = await res.json().catch(() => null)
      setError(d?.error ?? 'Error al crear el pedido')
    }
  }

  const productosFiltrados = productos.filter(p => p.categoria_id === categoriaActiva)

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-200" /></div>
  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <CheckCircle className="h-12 w-12 text-green-500" />
      <p className="text-neutral-700 text-lg font-bold">¡Pedido creado!</p>
    </div>
  )

  const opcionesVisibles = presentacionActiva ? opcionesDePresentacion(presentacionActiva) : []

  return (
    <div className="flex h-full overflow-hidden">
      {/* Catálogo */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex gap-2 p-3 border-b border-neutral-100 bg-white overflow-x-auto">
          {categorias.map(cat => (
            <button key={cat.id} onClick={() => { setCategoriaActiva(cat.id); setPresentacionActiva(null) }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${categoriaActiva === cat.id ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
              {cat.nombre}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!presentacionActiva ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {productosFiltrados.map(prod => {
                const pres = presentaciones.filter(p => p.producto_id === prod.id)
                return pres.map(p => {
                  const img = p.imagen_url || prod.imagen_url
                  // Con foto: tarjeta grande. Sin foto: ficha compacta (formato accesorios)
                  return img ? (
                    <button key={p.id} onClick={() => seleccionarPresentacion(p, prod)}
                      className="flex flex-col bg-white rounded-2xl border border-neutral-100 hover:border-neutral-200 hover:shadow-sm transition-all text-left active:scale-98 overflow-hidden">
                      <img src={img} alt={prod.nombre} className="w-full h-20 object-cover" />
                      <div className="p-3">
                        <p className="text-neutral-800 font-bold text-sm leading-tight">{prod.nombre}</p>
                        <p className="text-neutral-400 text-xs mt-0.5">{p.nombre}</p>
                        <p className="text-neutral-700 font-black mt-1.5 text-base">{formatPrecio(p.precio)}</p>
                      </div>
                    </button>
                  ) : (
                    <button key={p.id} onClick={() => seleccionarPresentacion(p, prod)}
                      className="flex items-center gap-2.5 p-3 bg-white rounded-xl border border-neutral-100 hover:border-neutral-200 hover:shadow-sm transition-all text-left active:scale-98">
                      <span className="w-10 h-10 rounded-lg bg-neutral-50 flex items-center justify-center text-xl flex-shrink-0">🍦</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-neutral-800 font-bold text-sm leading-tight truncate">{prod.nombre}</p>
                        <p className="text-neutral-400 text-xs truncate">{p.nombre}</p>
                        <p className="text-neutral-700 font-black text-sm mt-0.5">{formatPrecio(p.precio)}</p>
                      </div>
                    </button>
                  )
                })
              })}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-neutral-800 font-bold">{productoActivo?.nombre} — {presentacionActiva.nombre}</p>
                  <p className="text-neutral-400 text-sm">Elegí {presentacionActiva.opciones_min}–{presentacionActiva.opciones_max} sabores ({opcionesSeleccionadas.length}/{presentacionActiva.opciones_max})</p>
                </div>
                <button onClick={() => { setPresentacionActiva(null); setOpcionesSeleccionadas([]) }}
                  className="text-neutral-400 text-sm hover:text-neutral-600 transition-colors">← Volver</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 mb-4">
                {opcionesVisibles.map(op => {
                  const sel = opcionesSeleccionadas.find(o => o.id === op.id)
                  const maxAlcanzado = opcionesSeleccionadas.length >= presentacionActiva.opciones_max
                  return (
                    <button key={op.id} onClick={() => toggleOpcion(op)} disabled={!sel && maxAlcanzado}
                      className={`flex items-center gap-2 p-3 rounded-xl border transition-all text-left ${sel ? 'border-neutral-800 bg-neutral-50' : 'border-neutral-200 bg-white hover:border-neutral-300'} disabled:opacity-30 active:scale-98`}>
                      <span className="text-xl">{op.emoji || '🍦'}</span>
                      <span className="text-neutral-700 text-sm font-semibold">{op.nombre}</span>
                    </button>
                  )
                })}
              </div>
              <button onClick={confirmarConOpciones}
                disabled={opcionesSeleccionadas.length < presentacionActiva.opciones_min}
                className="w-full py-3 bg-neutral-800 text-white rounded-xl font-bold disabled:opacity-40 hover:bg-neutral-700 transition-colors">
                Agregar — {formatPrecio(presentacionActiva.precio)}
              </button>
            </div>
          )}

          {/* Accesorios: siempre a mano abajo del catálogo */}
          {!presentacionActiva && accesorios.length > 0 && (
            <div className="mt-6">
              <p className="text-neutral-500 font-bold text-xs uppercase tracking-wide mb-2">Accesorios</p>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                {accesorios.map(acc => (
                  <button key={acc.id} onClick={() => agregarAccesorio(acc)}
                    className="flex items-center gap-2.5 p-2.5 bg-white rounded-xl border border-neutral-100 hover:border-neutral-200 transition-all text-left active:scale-98">
                    {acc.imagen_url
                      ? <img src={acc.imagen_url} alt={acc.nombre} className="w-9 h-9 object-cover rounded-lg" />
                      : <span className="w-9 h-9 rounded-lg bg-neutral-50 flex items-center justify-center text-lg">{acc.emoji ?? '🍒'}</span>
                    }
                    <div className="min-w-0">
                      <p className="text-neutral-700 text-xs font-semibold truncate">{acc.nombre.replace(/^Toppings?\s+/i, '')}</p>
                      <p className="text-neutral-400 text-xs">+{formatPrecio(acc.precio_adicional)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Carrito */}
      <div className="w-80 border-l border-neutral-100 bg-white flex flex-col shadow-sm">
        <div className="p-4 border-b border-neutral-50 flex items-center justify-between">
          <p className="text-neutral-700 font-bold">Pedido</p>
          <button onClick={() => setEsDelivery(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${esDelivery ? 'bg-violet-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
            <Bike className="h-3.5 w-3.5" /> Delivery
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {carrito.length === 0 ? (
            <p className="text-neutral-300 text-sm text-center py-10">Sin items</p>
          ) : carrito.map(item => (
            <div key={item.uid} className="bg-neutral-50 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-neutral-700 text-sm font-bold">{item.nombre_producto}</p>
                  <p className="text-neutral-400 text-xs">{item.nombre_presentacion}</p>
                  {item.opciones.length > 0 && <p className="text-neutral-400 text-xs mt-0.5">{item.opciones.map(o => o.nombre).join(', ')}</p>}
                  <p className="text-neutral-700 text-sm font-bold mt-1">{formatPrecio(item.precio * item.cantidad)}</p>
                </div>
                <div className="flex items-center gap-0 bg-white border border-neutral-200 rounded-lg overflow-hidden flex-shrink-0">
                  <button onClick={() => cambiarCantidad(item.uid, -1)}
                    className="w-7 h-7 flex items-center justify-center text-neutral-500 active:bg-neutral-100">
                    {item.cantidad === 1 ? <Trash2 className="h-3.5 w-3.5 text-red-400" /> : <Minus className="h-3.5 w-3.5" />}
                  </button>
                  <span className="w-6 text-center font-bold text-neutral-800 text-xs">{item.cantidad}</span>
                  <button onClick={() => cambiarCantidad(item.uid, 1)}
                    className="w-7 h-7 flex items-center justify-center text-neutral-500 active:bg-neutral-100">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Datos delivery */}
          {esDelivery && (
            <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 space-y-2">
              <p className="text-violet-700 text-xs font-bold flex items-center gap-1"><Bike className="h-3.5 w-3.5" /> Datos de entrega</p>
              <input value={datosDelivery.nombre} onChange={e => setDatosDelivery({ ...datosDelivery, nombre: e.target.value })} placeholder="Nombre *"
                className="w-full bg-white border border-violet-100 text-neutral-700 text-sm rounded-lg px-3 py-2 placeholder-neutral-300 focus:outline-none focus:border-violet-300" />
              <input value={datosDelivery.telefono} onChange={e => setDatosDelivery({ ...datosDelivery, telefono: e.target.value })} placeholder="Teléfono *"
                className="w-full bg-white border border-violet-100 text-neutral-700 text-sm rounded-lg px-3 py-2 placeholder-neutral-300 focus:outline-none focus:border-violet-300" />
              <input value={datosDelivery.direccion} onChange={e => setDatosDelivery({ ...datosDelivery, direccion: e.target.value })} placeholder="Dirección *"
                className="w-full bg-white border border-violet-100 text-neutral-700 text-sm rounded-lg px-3 py-2 placeholder-neutral-300 focus:outline-none focus:border-violet-300" />
              <input value={datosDelivery.entre_calles} onChange={e => setDatosDelivery({ ...datosDelivery, entre_calles: e.target.value })} placeholder="Entre calles"
                className="w-full bg-white border border-violet-100 text-neutral-700 text-sm rounded-lg px-3 py-2 placeholder-neutral-300 focus:outline-none focus:border-violet-300" />
              <div className="flex items-center gap-2">
                <span className="text-violet-700 text-xs font-semibold">Envío</span>
                <input type="number" min={0} value={costoEnvio} onChange={e => setCostoEnvio(Number(e.target.value))}
                  className="w-24 bg-white border border-violet-100 text-neutral-700 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-300" />
              </div>
            </div>
          )}
        </div>

        {carrito.length > 0 && (
          <div className="p-4 border-t border-neutral-50 space-y-3">
            <div className="flex gap-2">
              {['efectivo', 'transferencia'].map(m => (
                <button key={m} onClick={() => setMetodoPago(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors capitalize ${metodoPago === m ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
                  {m === 'efectivo' ? '💵 Efectivo' : '📱 Transfer'}
                </button>
              ))}
            </div>
            <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Notas..."
              className="w-full bg-neutral-50 border border-neutral-200 text-neutral-700 text-sm rounded-xl px-3 py-2 placeholder-neutral-300 focus:outline-none focus:border-neutral-300" />
            {esDelivery && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-neutral-400">Subtotal + envío</span>
                <span className="text-neutral-500 font-semibold">{formatPrecio(subtotal)} + {formatPrecio(Number(costoEnvio))}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-neutral-400 text-sm">Total</span>
              <span className="text-neutral-800 font-black text-xl">{formatPrecio(total)}</span>
            </div>
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <button onClick={confirmarPedido} disabled={guardando || !deliveryValido}
              className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : esDelivery ? 'Confirmar delivery' : 'Confirmar pedido'}
            </button>
            {esDelivery && !deliveryValido && <p className="text-neutral-400 text-xs text-center">Completá nombre, teléfono y dirección</p>}
          </div>
        )}
      </div>
    </div>
  )
}
