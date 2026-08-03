'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ShoppingCart, ArrowLeft, Check, X } from 'lucide-react'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Categoria { id: string; nombre: string; icono_url: string | null }
interface Producto { id: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria_id: string }
interface Presentacion { id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; producto_id: string }
interface Opcion { id: string; nombre: string; descripcion: string | null; emoji: string | null; color: string | null; grupo_id: string }

type Paso = 'categorias' | 'productos' | 'presentacion' | 'opciones'

interface Props {
  dispositivo: DispositivoKiosk
  config: EmpresaConfig
  carrito: ItemCarrito[]
  onAgregar: (item: Omit<ItemCarrito, 'id'>) => void
  onVerCarrito: () => void
  onVolver: () => void
}

function formatPrecio(n: number) {
  return `$${Number(n).toLocaleString('es-AR')}`
}

function emojiCategoria(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.includes('helado') || n.includes('kilo')) return '🍦'
  if (n.includes('bombon') || n.includes('bombón') || n.includes('envasa')) return '🍫'
  if (n.includes('torta')) return '🎂'
  if (n.includes('balde')) return '🪣'
  return '🍨'
}

export default function KioskCatalogo({ dispositivo, config, carrito, onAgregar, onVerCarrito, onVolver }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [loading, setLoading] = useState(true)

  const [paso, setPaso] = useState<Paso>('categorias')
  const [categoriaActiva, setCategoriaActiva] = useState<Categoria | null>(null)
  const [productoActivo, setProductoActivo] = useState<Producto | null>(null)
  const [presentacionActiva, setPresentacionActiva] = useState<Presentacion | null>(null)
  const [opcionesSeleccionadas, setOpcionesSeleccionadas] = useState<Opcion[]>([])
  const [agregado, setAgregado] = useState(false)

  useEffect(() => {
    fetch(`/api/kiosk/catalogo?empresa_id=${dispositivo.empresa_id}&sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json())
      .then(data => {
        setCategorias(data.categorias ?? [])
        setProductos(data.productos ?? [])
        setPresentaciones(data.presentaciones ?? [])
        setOpciones(data.opciones ?? [])
        setLoading(false)
      })
  }, [dispositivo])

  function seleccionarCategoria(cat: Categoria) {
    setCategoriaActiva(cat)
    setPaso('productos')
  }

  function seleccionarProducto(prod: Producto) {
    const pres = presentaciones.filter(p => p.producto_id === prod.id)
    setProductoActivo(prod)
    if (pres.length === 1) {
      setPresentacionActiva(pres[0])
      setPaso(pres[0].permite_opciones ? 'opciones' : 'opciones')
    } else {
      setPaso('presentacion')
    }
  }

  function seleccionarPresentacion(pres: Presentacion) {
    setPresentacionActiva(pres)
    setOpcionesSeleccionadas([])
    setPaso('opciones')
  }

  function toggleOpcion(op: Opcion) {
    if (!presentacionActiva) return
    const yaSeleccionada = opcionesSeleccionadas.find(o => o.id === op.id)
    if (yaSeleccionada) {
      setOpcionesSeleccionadas(prev => prev.filter(o => o.id !== op.id))
    } else {
      if (opcionesSeleccionadas.length >= presentacionActiva.opciones_max) return
      setOpcionesSeleccionadas(prev => [...prev, op])
    }
  }

  function agregarAlCarrito() {
    if (!presentacionActiva || !productoActivo) return
    if (presentacionActiva.permite_opciones && opcionesSeleccionadas.length < presentacionActiva.opciones_min) return

    onAgregar({
      presentacion_id: presentacionActiva.id,
      nombre_producto: productoActivo.nombre,
      nombre_presentacion: presentacionActiva.nombre,
      precio: presentacionActiva.precio,
      cantidad: 1,
      opciones: opcionesSeleccionadas.map(op => ({
        opcion_id: op.id,
        nombre: op.nombre,
        emoji: op.emoji,
        color: op.color,
      })),
    })

    setAgregado(true)
    setTimeout(() => {
      setAgregado(false)
      setOpcionesSeleccionadas([])
      setPresentacionActiva(null)
      setProductoActivo(null)
      setPaso('categorias')
    }, 1000)
  }

  function volverPaso() {
    if (paso === 'opciones' && presentaciones.filter(p => p.producto_id === productoActivo?.id).length > 1) {
      setPaso('presentacion')
    } else if (paso === 'opciones' || paso === 'presentacion') {
      setPaso('productos')
      setProductoActivo(null)
      setPresentacionActiva(null)
      setOpcionesSeleccionadas([])
    } else if (paso === 'productos') {
      setPaso('categorias')
      setCategoriaActiva(null)
    } else {
      onVolver()
    }
  }

  const productosFiltrados = productos.filter(p => p.categoria_id === categoriaActiva?.id)
  const presentacionesFiltradas = presentaciones.filter(p => p.producto_id === productoActivo?.id)
  const totalCarrito = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#fdf8f4]">
      <div className="text-center">
        <span className="text-5xl animate-bounce block mb-4">🍦</span>
        <p className="text-neutral-400">Cargando catálogo...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-[#fdf8f4]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: config.primary_color }}>
        <button onClick={volverPaso} className="flex items-center gap-2 text-white/80 hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium">Volver</span>
        </button>

        {config.logo_url ? (
          <Image src={config.logo_url} alt="Logo" width={120} height={50} className="object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
        ) : (
          <span className="text-white font-bold">{dispositivo.empresas?.nombre}</span>
        )}

        <button onClick={onVerCarrito} className="relative flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl transition-colors">
          <ShoppingCart className="h-5 w-5 text-white" />
          {carrito.length > 0 && (
            <span className="text-white font-bold text-sm">{formatPrecio(totalCarrito)}</span>
          )}
          {carrito.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center" style={{ color: config.primary_color }}>
              {carrito.length}
            </span>
          )}
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="px-6 py-3 flex items-center gap-2 text-sm text-neutral-400">
        <span className={paso === 'categorias' ? 'font-medium text-neutral-700' : ''}>Categorías</span>
        {categoriaActiva && <><span>›</span><span className={paso === 'productos' ? 'font-medium text-neutral-700' : ''}>{categoriaActiva.nombre}</span></>}
        {productoActivo && <><span>›</span><span className={paso === 'presentacion' || paso === 'opciones' ? 'font-medium text-neutral-700' : ''}>{productoActivo.nombre}</span></>}
        {presentacionActiva && paso === 'opciones' && <><span>›</span><span className="font-medium text-neutral-700">{presentacionActiva.nombre}</span></>}
      </div>

      {/* Contenido */}
      <div className="flex-1 px-6 pb-8">

        {/* PASO: Categorías */}
        {paso === 'categorias' && (
          <div>
            <h2 className="text-2xl font-bold text-neutral-800 mb-6">¿Qué querés pedir?</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {categorias.map(cat => (
                <button key={cat.id} onClick={() => seleccionarCategoria(cat)}
                  className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl shadow-sm border border-neutral-100 hover:shadow-md active:scale-95 transition-all gap-3 min-h-[140px]">
                  {cat.icono_url
                    ? <Image src={cat.icono_url} alt={cat.nombre} width={64} height={64} className="object-contain" />
                    : <span className="text-5xl">{emojiCategoria(cat.nombre)}</span>}
                  <span className="text-neutral-700 font-semibold text-center">{cat.nombre}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO: Productos */}
        {paso === 'productos' && (
          <div>
            <h2 className="text-2xl font-bold text-neutral-800 mb-6">{categoriaActiva?.nombre}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {productosFiltrados.map(prod => (
                <button key={prod.id} onClick={() => seleccionarProducto(prod)}
                  className="flex flex-col bg-white rounded-2xl shadow-sm border border-neutral-100 hover:shadow-md active:scale-95 transition-all overflow-hidden text-left">
                  {/* Imagen o placeholder */}
                  <div className="w-full h-40 bg-neutral-50 flex items-center justify-center overflow-hidden">
                    {prod.imagen_url
                      ? <Image src={prod.imagen_url} alt={prod.nombre} width={200} height={160} className="object-cover w-full h-full" />
                      : <span className="text-6xl">{emojiCategoria(categoriaActiva?.nombre ?? '')}</span>}
                  </div>
                  <div className="p-4">
                    <p className="text-neutral-800 font-semibold">{prod.nombre}</p>
                    {prod.descripcion && <p className="text-neutral-400 text-sm mt-1 line-clamp-2">{prod.descripcion}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {presentaciones.filter(p => p.producto_id === prod.id).map(p => (
                        <span key={p.id} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: config.secondary_color, color: '#5a3a1a' }}>
                          {p.nombre} — {formatPrecio(p.precio)}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO: Presentación */}
        {paso === 'presentacion' && productoActivo && (
          <div>
            <h2 className="text-2xl font-bold text-neutral-800 mb-2">{productoActivo.nombre}</h2>
            <p className="text-neutral-400 mb-6">Elegí el tamaño</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl">
              {presentacionesFiltradas.map(pres => (
                <button key={pres.id} onClick={() => seleccionarPresentacion(pres)}
                  className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-sm border-2 border-neutral-100 hover:shadow-md active:scale-95 transition-all gap-2">
                  <span className="text-4xl">🍦</span>
                  <p className="text-neutral-800 font-bold text-lg">{pres.nombre}</p>
                  <p className="font-bold text-xl" style={{ color: config.primary_color }}>{formatPrecio(pres.precio)}</p>
                  {pres.permite_opciones && (
                    <p className="text-neutral-400 text-xs">
                      {pres.opciones_min === pres.opciones_max ? `${pres.opciones_min} sabores` : `${pres.opciones_min}–${pres.opciones_max} sabores`}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO: Opciones/Sabores */}
        {paso === 'opciones' && presentacionActiva && productoActivo && (
          <div>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-800">{productoActivo.nombre} — {presentacionActiva.nombre}</h2>
                {presentacionActiva.permite_opciones && (
                  <p className="text-neutral-500 mt-1">
                    Elegí {presentacionActiva.opciones_min === presentacionActiva.opciones_max
                      ? `${presentacionActiva.opciones_min} sabores`
                      : `entre ${presentacionActiva.opciones_min} y ${presentacionActiva.opciones_max} sabores`}
                    {' '}<span className="font-medium" style={{ color: config.primary_color }}>({opcionesSeleccionadas.length}/{presentacionActiva.opciones_max})</span>
                  </p>
                )}
              </div>
              <p className="text-2xl font-bold" style={{ color: config.primary_color }}>{formatPrecio(presentacionActiva.precio)}</p>
            </div>

            {/* Indicador de progreso */}
            {presentacionActiva.permite_opciones && (
              <div className="flex gap-2 mb-6">
                {Array.from({ length: presentacionActiva.opciones_max }).map((_, i) => (
                  <div key={i} className="h-2 flex-1 rounded-full transition-colors"
                    style={{ backgroundColor: i < opcionesSeleccionadas.length ? config.primary_color : '#e5e7eb' }} />
                ))}
              </div>
            )}

            {presentacionActiva.permite_opciones ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
                {opciones.map(op => {
                  const sel = opcionesSeleccionadas.find(o => o.id === op.id)
                  const maxAlcanzado = opcionesSeleccionadas.length >= presentacionActiva.opciones_max
                  return (
                    <button key={op.id} onClick={() => toggleOpcion(op)}
                      disabled={!sel && maxAlcanzado}
                      className={`relative flex flex-col items-center p-4 rounded-2xl border-2 transition-all active:scale-95 gap-2 ${
                        sel ? 'border-2 bg-white shadow-md' : 'border-neutral-100 bg-white hover:border-neutral-300'
                      } disabled:opacity-40`}
                      style={sel ? { borderColor: config.primary_color } : {}}>
                      {sel && (
                        <div className="absolute top-2 right-2 rounded-full w-5 h-5 flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
                          <Check className="h-3 w-3 text-white" />
                        </div>
                      )}
                      <span className="text-4xl">{op.emoji ?? '🍦'}</span>
                      <p className="text-neutral-800 font-medium text-sm text-center">{op.nombre}</p>
                      {op.descripcion && <p className="text-neutral-400 text-xs text-center line-clamp-2">{op.descripcion}</p>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-neutral-400">
                <span className="text-5xl block mb-3">🍦</span>
                <p>Este producto no requiere selección de sabores</p>
              </div>
            )}

            {/* Botón agregar */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#fdf8f4] border-t border-neutral-100">
              <button
                onClick={agregarAlCarrito}
                disabled={presentacionActiva.permite_opciones && opcionesSeleccionadas.length < presentacionActiva.opciones_min || agregado}
                className="w-full max-w-md mx-auto flex items-center justify-center gap-3 py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all disabled:opacity-40"
                style={{ backgroundColor: config.primary_color }}
              >
                {agregado
                  ? <><Check className="h-5 w-5" /> ¡Agregado!</>
                  : <><ShoppingCart className="h-5 w-5" /> Agregar — {formatPrecio(presentacionActiva.precio)}</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
