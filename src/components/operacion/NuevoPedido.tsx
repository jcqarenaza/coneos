'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Trash2, CheckCircle } from 'lucide-react'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string }
interface SesionOperador { session_id: string; operador: { id: string } }

interface Categoria { id: string; nombre: string }
interface Producto { id: string; nombre: string; categoria_id: string }
interface Presentacion { id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; producto_id: string }
interface Opcion { id: string; nombre: string; emoji: string | null; color: string | null; grupos_opciones?: { nombre: string } | null }

interface ItemCarrito {
  presentacion: Presentacion
  producto: Producto
  opciones: Opcion[]
  cantidad: number
}

interface Props {
  dispositivo: Dispositivo
  sesion: SesionOperador
  onPedidoCreado: () => void
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function NuevoPedido({ dispositivo, sesion, onPedidoCreado }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])

  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null)
  const [productoActivo, setProductoActivo] = useState<Producto | null>(null)
  const [presentacionActiva, setPresentacionActiva] = useState<Presentacion | null>(null)
  const [opcionesSeleccionadas, setOpcionesSeleccionadas] = useState<Opcion[]>([])

  const [metodoPago, setMetodoPago] = useState<string>('efectivo')
  const [notas, setNotas] = useState('')
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)
  const [metodosDisponibles, setMetodosDisponibles] = useState({ efectivo: true, transferencia: true, mp: false })

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('categorias').select('id, nombre').eq('empresa_id', dispositivo.empresa_id).eq('activo', true).is('deleted_at', null).order('orden'),
      supabase.from('productos').select('id, nombre, categoria_id').eq('empresa_id', dispositivo.empresa_id).eq('activo', true).is('deleted_at', null).order('orden'),
      supabase.from('presentaciones').select('id, nombre, precio, permite_opciones, opciones_min, opciones_max, producto_id').eq('empresa_id', dispositivo.empresa_id).eq('activo', true).order('orden'),
      supabase.from('opciones').select('id, nombre, emoji, color, grupos_opciones(nombre)').eq('empresa_id', dispositivo.empresa_id).eq('activo', true).is('deleted_at', null).order('orden'),
      supabase.from('sucursal_pagos').select('acepta_efectivo, acepta_transferencia, acepta_mp').eq('sucursal_id', dispositivo.sucursal_id).single(),
    ]).then(([cats, prods, pres, ops, pagos]) => {
      setCategorias((cats.data ?? []) as Categoria[])
      setProductos((prods.data ?? []) as Producto[])
      setPresentaciones((pres.data ?? []) as Presentacion[])
      setOpciones((ops.data ?? []) as Opcion[])
      if (pagos.data) setMetodosDisponibles({ efectivo: pagos.data.acepta_efectivo, transferencia: pagos.data.acepta_transferencia, mp: pagos.data.acepta_mp })
      if (cats.data?.length) setCategoriaActiva(cats.data[0].id)
      setLoading(false)
    })
  }, [dispositivo])

  function seleccionarPresentacion(p: Presentacion, prod: Producto) {
    setPresentacionActiva(p)
    setProductoActivo(prod)
    setOpcionesSeleccionadas([])
  }

  function toggleOpcion(op: Opcion) {
    if (!presentacionActiva) return
    const ya = opcionesSeleccionadas.find(o => o.id === op.id)
    if (ya) { setOpcionesSeleccionadas(prev => prev.filter(o => o.id !== op.id)) }
    else {
      if (opcionesSeleccionadas.length >= presentacionActiva.opciones_max) return
      setOpcionesSeleccionadas(prev => [...prev, op])
    }
  }

  function agregarAlCarrito() {
    if (!presentacionActiva || !productoActivo) return
    if (presentacionActiva.permite_opciones && opcionesSeleccionadas.length < presentacionActiva.opciones_min) return
    setCarrito(prev => [...prev, { presentacion: presentacionActiva, producto: productoActivo, opciones: opcionesSeleccionadas, cantidad: 1 }])
    setPresentacionActiva(null)
    setProductoActivo(null)
    setOpcionesSeleccionadas([])
  }

  async function confirmarPedido() {
    if (!carrito.length) return
    setGuardando(true)
    const items = carrito.map(item => ({
      presentacion_id: item.presentacion.id,
      nombre_producto_snap: item.producto.nombre,
      nombre_presentacion_snap: item.presentacion.nombre,
      precio_snap: item.presentacion.precio,
      cantidad: item.cantidad,
      opciones: item.opciones.map(op => ({ opcion_id: op.id, nombre_snap: op.nombre, emoji_snap: op.emoji, color_snap: op.color })),
    }))
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: dispositivo.empresa_id, sucursal_id: dispositivo.sucursal_id, dispositivo_id: dispositivo.id, session_id: sesion.session_id, items, metodo_pago: metodoPago, notas: notas || null }),
    })
    setGuardando(false)
    if (res.ok) {
      setExito(true)
      setCarrito([])
      setNotas('')
      setTimeout(() => { setExito(false); onPedidoCreado() }, 1500)
    }
  }

  const total = carrito.reduce((acc, item) => acc + item.presentacion.precio * item.cantidad, 0)
  const productosFiltrados = productos.filter(p => p.categoria_id === categoriaActiva)

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <CheckCircle className="h-12 w-12 text-green-500" />
      <p className="text-neutral-700 text-lg font-medium">¡Pedido creado!</p>
    </div>
  )

  return (
    <div className="flex h-full">
      {/* Izquierda: catálogo */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Categorías */}
        <div className="flex gap-2 p-3 border-b border-neutral-200 bg-white overflow-x-auto">
          {categorias.map(cat => (
            <button key={cat.id} onClick={() => { setCategoriaActiva(cat.id); setPresentacionActiva(null) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                categoriaActiva === cat.id ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
              }`}>
              {cat.nombre}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!presentacionActiva ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {productosFiltrados.map(prod => {
                const pres = presentaciones.filter(p => p.producto_id === prod.id)
                return pres.map(p => (
                  <button key={p.id} onClick={() => seleccionarPresentacion(p, prod)}
                    className="flex flex-col items-start p-4 bg-white rounded-xl border border-neutral-200 hover:border-neutral-300 hover:shadow-sm transition-all text-left">
                    <p className="text-neutral-800 font-medium text-sm">{prod.nombre}</p>
                    <p className="text-neutral-400 text-xs mt-0.5">{p.nombre}</p>
                    <p className="text-neutral-700 font-bold mt-2">{formatPrecio(p.precio)}</p>
                  </button>
                ))
              })}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-neutral-800 font-medium">{productoActivo?.nombre} — {presentacionActiva.nombre}</p>
                  {presentacionActiva.permite_opciones && (
                    <p className="text-neutral-400 text-sm">Elegí {presentacionActiva.opciones_min}–{presentacionActiva.opciones_max} sabores ({opcionesSeleccionadas.length}/{presentacionActiva.opciones_max})</p>
                  )}
                </div>
                <button onClick={() => { setPresentacionActiva(null); setOpcionesSeleccionadas([]) }}
                  className="text-neutral-400 text-sm hover:text-neutral-600">Volver</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                {opciones.map(op => {
                  const sel = opcionesSeleccionadas.find(o => o.id === op.id)
                  const maxAlcanzado = opcionesSeleccionadas.length >= presentacionActiva.opciones_max
                  return (
                    <button key={op.id} onClick={() => toggleOpcion(op)} disabled={!sel && maxAlcanzado}
                      className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-colors ${
                        sel ? 'border-neutral-800 bg-neutral-50' : 'border-neutral-200 bg-white hover:border-neutral-300'
                      } disabled:opacity-30`}>
                      <span className="text-xl">{op.emoji || '🍦'}</span>
                      <span className="text-neutral-700 text-sm font-medium">{op.nombre}</span>
                    </button>
                  )
                })}
              </div>
              <button onClick={agregarAlCarrito}
                disabled={presentacionActiva.permite_opciones && opcionesSeleccionadas.length < presentacionActiva.opciones_min}
                className="w-full py-3 bg-neutral-800 text-white rounded-xl font-medium disabled:opacity-40 hover:bg-neutral-700 transition-colors">
                Agregar — {formatPrecio(presentacionActiva.precio)}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Derecha: carrito */}
      <div className="w-72 border-l border-neutral-200 bg-white flex flex-col">
        <div className="p-4 border-b border-neutral-100">
          <p className="text-neutral-700 font-semibold text-sm">Pedido actual</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {carrito.length === 0 ? (
            <p className="text-neutral-300 text-sm text-center py-8">Sin items</p>
          ) : (
            carrito.map((item, i) => (
              <div key={i} className="bg-neutral-50 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-neutral-700 text-sm font-medium">{item.producto.nombre}</p>
                    <p className="text-neutral-400 text-xs">{item.presentacion.nombre}</p>
                    {item.opciones.length > 0 && (
                      <p className="text-neutral-400 text-xs mt-0.5">{item.opciones.map(o => o.nombre).join(', ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 ml-2">
                    <p className="text-neutral-700 text-sm font-medium">{formatPrecio(item.presentacion.precio)}</p>
                    <button onClick={() => setCarrito(prev => prev.filter((_, idx) => idx !== i))} className="text-neutral-300 hover:text-red-400 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        {carrito.length > 0 && (
          <div className="p-4 border-t border-neutral-100 space-y-3">
            <div className="flex gap-2">
              {metodosDisponibles.efectivo && (
                <button onClick={() => setMetodoPago('efectivo')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${metodoPago === 'efectivo' ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
                  Efectivo
                </button>
              )}
              {metodosDisponibles.transferencia && (
                <button onClick={() => setMetodoPago('transferencia')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${metodoPago === 'transferencia' ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
                  Transfer
                </button>
              )}
              {metodosDisponibles.mp && (
                <button onClick={() => setMetodoPago('mp')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${metodoPago === 'mp' ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
                  MP
                </button>
              )}
            </div>
            <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Notas..." className="w-full bg-neutral-50 border border-neutral-200 text-neutral-700 text-sm rounded-lg px-3 py-2 placeholder-neutral-300 focus:outline-none focus:border-neutral-400" />
            <div className="flex items-center justify-between">
              <p className="text-neutral-500 text-sm">Total</p>
              <p className="text-neutral-800 font-bold text-lg">{formatPrecio(total)}</p>
            </div>
            <button onClick={confirmarPedido} disabled={guardando}
              className="w-full py-3 bg-neutral-800 text-white rounded-xl font-semibold text-sm hover:bg-neutral-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar pedido'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
