'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ShoppingCart, ArrowLeft, Check, Plus, Minus } from 'lucide-react'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Categoria { id: string; nombre: string; icono_url: string | null }
interface Producto { id: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria_id: string }
interface Presentacion { id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; producto_id: string }
interface Opcion { id: string; nombre: string; descripcion: string | null; emoji: string | null; color: string | null; grupo_id: string }
interface GrupoOpciones { id: string; nombre: string; orden: number }

type Paso = 'categorias' | 'productos' | 'presentacion' | 'opciones'

interface Props {
  dispositivo: DispositivoKiosk
  config: EmpresaConfig
  carrito: ItemCarrito[]
  categoriaIdInicial?: string
  onAgregar: (item: Omit<ItemCarrito, 'id'>) => void
  onVerCarrito: () => void
  onVolver: () => void
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

function emojiCategoria(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.includes('helado') || n.includes('kilo')) return '🍦'
  if (n.includes('balde')) return '🪣'
  if (n.includes('cono') || n.includes('bocha')) return '🍦'
  if (n.includes('bombon') || n.includes('envasa')) return '🍫'
  if (n.includes('torta')) return '🎂'
  if (n.includes('palito')) return '🍡'
  if (n.includes('copa')) return '🍨'
  return '🍨'
}

export default function KioskCatalogo({ dispositivo, config, carrito, categoriaIdInicial, onAgregar, onVerCarrito, onVolver }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [grupos, setGrupos] = useState<GrupoOpciones[]>([])
  const [loading, setLoading] = useState(true)

  const [paso, setPaso] = useState<Paso>('categorias')
  const [categoriaActiva, setCategoriaActiva] = useState<Categoria | null>(null)
  const [productoActivo, setProductoActivo] = useState<Producto | null>(null)
  const [presentacionActiva, setPresentacionActiva] = useState<Presentacion | null>(null)
  const [cantidad, setCantidad] = useState<Record<string, number>>({})
  const [opcionesSeleccionadas, setOpcionesSeleccionadas] = useState<Opcion[]>([])
  const [agregado, setAgregado] = useState(false)
  const [grupoActivo, setGrupoActivo] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/kiosk/catalogo?empresa_id=${dispositivo.empresa_id}&sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json())
      .then(data => {
        const cats = data.categorias ?? []
        setCategorias(cats)
        setProductos(data.productos ?? [])
        setPresentaciones(data.presentaciones ?? [])
        setOpciones(data.opciones ?? [])
        setGrupos(data.grupos ?? [])
        setLoading(false)

        if (categoriaIdInicial) {
          const cat = cats.find((c: Categoria) => c.id === categoriaIdInicial)
          if (cat) {
            const prodsDeCategoria = (data.productos ?? []).filter((p: Producto) => p.categoria_id === categoriaIdInicial)
            setCategoriaActiva(cat)
            if (prodsDeCategoria.length === 1) {
              setProductoActivo(prodsDeCategoria[0])
              setPaso('presentacion')
            } else {
              setPaso('productos')
            }
          }
        }
      })
  }, [dispositivo, categoriaIdInicial])

  function getCantidad(presId: string) { return cantidad[presId] ?? 0 }
  function setCantidadPres(presId: string, val: number) {
    setCantidad(prev => ({ ...prev, [presId]: Math.max(0, val) }))
  }

  function seleccionarCategoria(cat: Categoria) {
    setCategoriaActiva(cat)
    const prods = productos.filter(p => p.categoria_id === cat.id)
    if (prods.length === 1) { setProductoActivo(prods[0]); setPaso('presentacion') }
    else setPaso('productos')
  }

  function seleccionarProducto(prod: Producto) {
    setProductoActivo(prod)
    setCantidad({})
    const pres = presentaciones.filter(p => p.producto_id === prod.id)
    if (pres.length === 1) {
      setPresentacionActiva(pres[0])
      setOpcionesSeleccionadas([])
      setPaso('opciones')
    } else {
      setPaso('presentacion')
    }
  }

  function confirmarPresentacion() {
    // Buscar la presentación con cantidad > 0
    const pres = presentaciones.filter(p => p.producto_id === productoActivo?.id)
    const seleccionada = pres.find(p => getCantidad(p.id) > 0)
    if (!seleccionada) return
    setPresentacionActiva(seleccionada)
    setOpcionesSeleccionadas([])
    setGrupoActivo(null)
    setPaso('opciones')
  }

  function toggleOpcion(op: Opcion) {
    if (!presentacionActiva) return
    const ya = opcionesSeleccionadas.find(o => o.id === op.id)
    if (ya) {
      setOpcionesSeleccionadas(prev => prev.filter(o => o.id !== op.id))
    } else {
      if (opcionesSeleccionadas.length >= presentacionActiva.opciones_max) return
      setOpcionesSeleccionadas(prev => [...prev, op])
    }
  }

  function agregarAlCarrito() {
    if (!presentacionActiva || !productoActivo) return
    if (presentacionActiva.permite_opciones && opcionesSeleccionadas.length < presentacionActiva.opciones_min) return

    const cant = getCantidad(presentacionActiva.id) || 1
    for (let i = 0; i < cant; i++) {
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
    }

    setAgregado(true)
    setTimeout(() => {
      setAgregado(false)
      setOpcionesSeleccionadas([])
      setCantidad({})
      setPresentacionActiva(null)
      setPaso('presentacion')
    }, 900)
  }

  function volverPaso() {
    if (paso === 'opciones') {
      const pres = presentaciones.filter(p => p.producto_id === productoActivo?.id)
      if (pres.length > 1) { setPaso('presentacion') }
      else { setPaso('productos'); setProductoActivo(null) }
      setPresentacionActiva(null)
      setOpcionesSeleccionadas([])
    } else if (paso === 'presentacion') {
      const prods = productos.filter(p => p.categoria_id === categoriaActiva?.id)
      if (prods.length > 1) { setPaso('productos') }
      else { setPaso('categorias'); setCategoriaActiva(null) }
      setProductoActivo(null)
      setCantidad({})
    } else if (paso === 'productos') {
      setPaso('categorias'); setCategoriaActiva(null)
    } else {
      onVolver()
    }
  }

  const productosFiltrados = productos.filter(p => p.categoria_id === categoriaActiva?.id)
  const presentacionesFiltradas = presentaciones.filter(p => p.producto_id === productoActivo?.id)
  const totalCarrito = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const gruposConOpciones = grupos.filter(g => opciones.some(op => op.grupo_id === g.id)).sort((a, b) => a.orden - b.orden)
  const opcionesFiltradas = grupoActivo ? opciones.filter(op => op.grupo_id === grupoActivo) : opciones
  const haySeleccion = presentacionesFiltradas.some(p => getCantidad(p.id) > 0)

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
      <div className="flex items-center justify-between px-6 py-3" style={{ backgroundColor: config.primary_color }}>
        <button onClick={volverPaso} className="flex items-center gap-2 text-white/80 hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium">Volver</span>
        </button>
        {config.logo_url ? (
          <Image src={config.logo_url} alt="Logo" width={140} height={55} className="object-contain bg-white rounded-lg px-3 py-1" />
        ) : (
          <span className="text-white font-bold">{dispositivo.empresas?.nombre}</span>
        )}
        <button onClick={onVerCarrito} className="relative flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl transition-colors">
          <ShoppingCart className="h-5 w-5 text-white" />
          {carrito.length > 0 && <span className="text-white font-bold text-sm">{formatPrecio(totalCarrito)}</span>}
          {carrito.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center" style={{ color: config.primary_color }}>
              {carrito.length}
            </span>
          )}
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="px-6 py-3 flex items-center justify-center gap-2 text-sm text-neutral-400 flex-wrap">
        <span className="cursor-pointer hover:text-neutral-600" onClick={() => { setPaso('categorias'); setCategoriaActiva(null); setProductoActivo(null); setPresentacionActiva(null) }}>Categorías</span>
        {categoriaActiva && <><span>›</span><span className="text-neutral-600">{categoriaActiva.nombre}</span></>}
        {productoActivo && paso !== 'productos' && <><span>›</span><span className="text-neutral-600">{productoActivo.nombre}</span></>}
        {presentacionActiva && paso === 'opciones' && <><span>›</span><span className="font-medium text-neutral-700">{presentacionActiva.nombre}</span></>}
      </div>

      {/* Contenido */}
      <div className={`flex-1 px-6 flex flex-col items-center ${paso === 'opciones' ? 'pb-36' : 'pb-8'}`}>

        {/* Categorías */}
        {paso === 'categorias' && (
          <div className="w-full max-w-2xl">
            <h2 className="text-2xl font-bold text-neutral-800 mb-6 text-center">¿Qué querés pedir?</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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

        {/* Productos */}
        {paso === 'productos' && (
          <div className="w-full max-w-2xl">
            <h2 className="text-2xl font-bold text-neutral-800 mb-6 text-center">{categoriaActiva?.nombre}</h2>
            <div className="grid grid-cols-2 gap-4">
              {productosFiltrados.map(prod => (
                <button key={prod.id} onClick={() => seleccionarProducto(prod)}
                  className="flex flex-col bg-white rounded-2xl shadow-sm border border-neutral-100 hover:shadow-md active:scale-95 transition-all overflow-hidden text-left">
                  <div className="w-full h-40 bg-neutral-50 flex items-center justify-center overflow-hidden">
                    {prod.imagen_url
                      ? <Image src={prod.imagen_url} alt={prod.nombre} width={200} height={160} className="object-cover w-full h-full" />
                      : <span className="text-6xl">{emojiCategoria(categoriaActiva?.nombre ?? '')}</span>}
                  </div>
                  <div className="p-4">
                    <p className="text-neutral-800 font-semibold">{prod.nombre}</p>
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

        {/* Presentaciones con selector de cantidad */}
        {paso === 'presentacion' && productoActivo && (
          <div className="w-full max-w-lg">
            <h2 className="text-2xl font-bold text-neutral-800 mb-1 text-center">{productoActivo.nombre}</h2>
            <p className="text-neutral-400 mb-8 text-center">Elegí el tamaño y la cantidad</p>
            <div className="flex flex-col gap-4">
              {presentacionesFiltradas.map(pres => {
                const cant = getCantidad(pres.id)
                return (
                  <div key={pres.id}
                    className={`flex flex-col items-center p-6 bg-white rounded-2xl shadow-sm border-2 transition-all gap-4 ${cant > 0 ? 'shadow-md' : 'border-neutral-100'}`}
                    style={cant > 0 ? { borderColor: config.primary_color } : {}}>
                    {/* Info presentación */}
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">🍦</span>
                        <div>
                          <p className="text-neutral-800 font-bold text-lg">{pres.nombre}</p>
                          <p className="text-xs text-neutral-400">
                            {pres.permite_opciones
                              ? `${pres.opciones_min}–${pres.opciones_max} sabores`
                              : 'Sin selección de sabores'}
                          </p>
                        </div>
                      </div>
                      <p className="font-bold text-xl" style={{ color: config.primary_color }}>{formatPrecio(pres.precio)}</p>
                    </div>

                    {/* Selector cantidad */}
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setCantidadPres(pres.id, cant - 1)}
                        className="w-11 h-11 flex items-center justify-center rounded-xl border-2 border-neutral-200 hover:border-neutral-400 transition-colors bg-white"
                      >
                        <Minus className="h-5 w-5 text-neutral-600" />
                      </button>
                      <span className="text-2xl font-bold text-neutral-900 w-8 text-center">{cant}</span>
                      <button
                        onClick={() => setCantidadPres(pres.id, cant + 1)}
                        className="w-11 h-11 flex items-center justify-center rounded-xl border-2 text-white transition-colors"
                        style={{ backgroundColor: config.primary_color, borderColor: config.primary_color }}
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    </div>

                    {cant > 0 && (
                      <p className="text-sm font-medium" style={{ color: config.primary_color }}>
                        Subtotal: {formatPrecio(pres.precio * cant)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Botón continuar */}
            <button
              onClick={confirmarPresentacion}
              disabled={!haySeleccion}
              className="mt-8 w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all disabled:opacity-30"
              style={{ backgroundColor: config.primary_color }}
            >
              Elegir sabores →
            </button>
          </div>
        )}

        {/* Opciones / Sabores */}
        {paso === 'opciones' && presentacionActiva && productoActivo && (
          <div className="w-full max-w-2xl">
            <div className="text-center mb-3">
              <h2 className="text-xl font-bold text-neutral-800">{productoActivo.nombre} — {presentacionActiva.nombre}</h2>
              {presentacionActiva.permite_opciones && (
                <p className="text-neutral-500 text-sm mt-1">
                  Elegí entre {presentacionActiva.opciones_min} y {presentacionActiva.opciones_max} sabores
                  {' '}<span className="font-medium" style={{ color: config.primary_color }}>({opcionesSeleccionadas.length}/{presentacionActiva.opciones_max})</span>
                </p>
              )}
            </div>

            {/* Barra progreso */}
            {presentacionActiva.permite_opciones && (
              <div className="flex gap-1.5 mb-4 max-w-xs mx-auto">
                {Array.from({ length: presentacionActiva.opciones_max }).map((_, i) => (
                  <div key={i} className="h-1.5 flex-1 rounded-full transition-colors"
                    style={{ backgroundColor: i < opcionesSeleccionadas.length ? config.primary_color : '#e5e7eb' }} />
                ))}
              </div>
            )}

            {/* Seleccionados */}
            {opcionesSeleccionadas.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                {opcionesSeleccionadas.map(op => (
                  <button key={op.id} onClick={() => toggleOpcion(op)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white"
                    style={{ backgroundColor: config.primary_color }}>
                    {op.emoji} {op.nombre} <span className="opacity-70">✕</span>
                  </button>
                ))}
              </div>
            )}

            {/* Tabs grupos */}
            {gruposConOpciones.length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1 justify-center">
                <button onClick={() => setGrupoActivo(null)}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${!grupoActivo ? 'text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                  style={!grupoActivo ? { backgroundColor: config.primary_color } : {}}>
                  Todos
                </button>
                {gruposConOpciones.map(g => (
                  <button key={g.id} onClick={() => setGrupoActivo(grupoActivo === g.id ? null : g.id)}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${grupoActivo === g.id ? 'text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                    style={grupoActivo === g.id ? { backgroundColor: config.primary_color } : {}}>
                    {g.nombre}
                  </button>
                ))}
              </div>
            )}

            {/* Grid sabores */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {opcionesFiltradas.map(op => {
                const sel = opcionesSeleccionadas.find(o => o.id === op.id)
                const maxAlcanzado = opcionesSeleccionadas.length >= presentacionActiva.opciones_max
                return (
                  <button key={op.id} onClick={() => toggleOpcion(op)}
                    disabled={!sel && maxAlcanzado}
                    className={`relative flex flex-col items-center p-3 rounded-2xl border-2 transition-all active:scale-95 gap-1.5 bg-white ${sel ? 'shadow-md' : 'border-neutral-100 hover:border-neutral-300'} disabled:opacity-30`}
                    style={sel ? { borderColor: config.primary_color } : {}}>
                    {sel && (
                      <div className="absolute top-2 right-2 rounded-full w-5 h-5 flex items-center justify-center" style={{ backgroundColor: config.primary_color }}>
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                    <span className="text-3xl">{op.emoji ?? '🍦'}</span>
                    <p className="text-neutral-800 font-medium text-xs text-center leading-tight">{op.nombre}</p>
                    {op.descripcion && <p className="text-neutral-400 text-xs text-center line-clamp-1 hidden md:block">{op.descripcion}</p>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Botón agregar fijo */}
      {paso === 'opciones' && presentacionActiva && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#fdf8f4] border-t border-neutral-100 p-4">
          <div className="max-w-md mx-auto">
            <button
              onClick={agregarAlCarrito}
              disabled={(presentacionActiva.permite_opciones && opcionesSeleccionadas.length < presentacionActiva.opciones_min) || agregado}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all disabled:opacity-40"
              style={{ backgroundColor: config.primary_color }}
            >
              {agregado
                ? <><Check className="h-5 w-5" /> ¡Agregado al pedido!</>
                : <><ShoppingCart className="h-5 w-5" /> Agregar al pedido — {formatPrecio(presentacionActiva.precio * (getCantidad(presentacionActiva.id) || 1))}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
