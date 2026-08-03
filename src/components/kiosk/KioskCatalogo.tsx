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
interface PresGrupo { presentacion_id: string; grupo_id: string }
interface PendienteSabores { presentacion: Presentacion; producto: Producto; numero: number; total: number }
type Paso = 'categorias' | 'productos' | 'opciones'

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

function LogoHeader({ config, dispositivo }: { config: EmpresaConfig; dispositivo: DispositivoKiosk }) {
  if (!config.logo_url) return <span className="text-white font-bold text-lg">{dispositivo.empresas?.nombre}</span>
  return (
    <div className="bg-white rounded-xl px-4 py-1.5 flex items-center justify-center" style={{ minWidth: 140, maxWidth: 180 }}>
      <Image src={config.logo_url} alt={dispositivo.empresas?.nombre ?? 'Logo'} width={160} height={55} className="object-contain w-auto" style={{ maxHeight: 48 }} />
    </div>
  )
}

export default function KioskCatalogo({ dispositivo, config, carrito, categoriaIdInicial, onAgregar, onVerCarrito, onVolver }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [grupos, setGrupos] = useState<GrupoOpciones[]>([])
  const [presGrupos, setPresGrupos] = useState<PresGrupo[]>([])
  const [loading, setLoading] = useState(true)

  const [paso, setPaso] = useState<Paso>('categorias')
  const [categoriaActiva, setCategoriaActiva] = useState<Categoria | null>(null)
  // cantidad[producto_id][presentacion_id] = número
  const [cantidad, setCantidad] = useState<Record<string, Record<string, number>>>({})

  const [cola, setCola] = useState<PendienteSabores[]>([])
  const [colaIndex, setColaIndex] = useState(0)
  const [opcionesSeleccionadas, setOpcionesSeleccionadas] = useState<Opcion[]>([])
  const [grupoActivo, setGrupoActivo] = useState<string | null>(null)
  const [agregado, setAgregado] = useState(false)

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
        setPresGrupos(data.presentacion_grupos ?? [])
        setLoading(false)
        if (categoriaIdInicial) {
          const cat = cats.find((c: Categoria) => c.id === categoriaIdInicial)
          if (cat) { setCategoriaActiva(cat); setPaso('productos') }
        }
      })
  }, [dispositivo, categoriaIdInicial])

  function getCant(prodId: string, presId: string) { return cantidad[prodId]?.[presId] ?? 0 }
  function setCant(prodId: string, presId: string, val: number) {
    setCantidad(prev => ({ ...prev, [prodId]: { ...(prev[prodId] ?? {}), [presId]: Math.max(0, val) } }))
  }

  function seleccionarCategoria(cat: Categoria) {
    setCategoriaActiva(cat)
    setCantidad({})
    setPaso('productos')
  }

  function haySeleccionEnCategoria() {
    const prods = productos.filter(p => p.categoria_id === categoriaActiva?.id)
    return prods.some(prod => {
      const pres = presentaciones.filter(p => p.producto_id === prod.id)
      return pres.some(p => getCant(prod.id, p.id) > 0)
    })
  }

  function totalSeleccionado() {
    const prods = productos.filter(p => p.categoria_id === categoriaActiva?.id)
    let total = 0
    prods.forEach(prod => {
      const pres = presentaciones.filter(p => p.producto_id === prod.id)
      pres.forEach(p => { total += getCant(prod.id, p.id) * p.precio })
    })
    return total
  }

  function confirmarSeleccion() {
    const prods = productos.filter(p => p.categoria_id === categoriaActiva?.id)
    const nuevaCola: PendienteSabores[] = []

    prods.forEach(prod => {
      const pres = presentaciones.filter(p => p.producto_id === prod.id)
      pres.forEach(p => {
        const cant = getCant(prod.id, p.id)
        if (cant === 0) return
        if (!p.permite_opciones) {
          // Agregar directo sin opciones
          for (let i = 0; i < cant; i++) {
            onAgregar({ presentacion_id: p.id, nombre_producto: prod.nombre, nombre_presentacion: p.nombre, precio: p.precio, cantidad: 1, opciones: [] })
          }
        } else {
          for (let i = 0; i < cant; i++) {
            nuevaCola.push({ presentacion: p, producto: prod, numero: i + 1, total: cant })
          }
        }
      })
    })

    if (nuevaCola.length === 0) {
      setAgregado(true)
      setTimeout(() => { setAgregado(false); setCantidad({}); setPaso('categorias'); setCategoriaActiva(null) }, 900)
      return
    }
    setCola(nuevaCola); setColaIndex(0); setOpcionesSeleccionadas([]); setGrupoActivo(null)
    setPaso('opciones')
  }

  function toggleOpcion(op: Opcion) {
    const actual = cola[colaIndex]
    if (!actual) return
    const ya = opcionesSeleccionadas.find(o => o.id === op.id)
    if (ya) { setOpcionesSeleccionadas(prev => prev.filter(o => o.id !== op.id)) }
    else {
      if (opcionesSeleccionadas.length >= actual.presentacion.opciones_max) return
      setOpcionesSeleccionadas(prev => [...prev, op])
    }
  }

  function confirmarSabores() {
    const actual = cola[colaIndex]
    if (!actual) return
    if (actual.presentacion.permite_opciones && opcionesSeleccionadas.length < actual.presentacion.opciones_min) return
    onAgregar({
      presentacion_id: actual.presentacion.id, nombre_producto: actual.producto.nombre,
      nombre_presentacion: actual.presentacion.nombre, precio: actual.presentacion.precio,
      cantidad: 1, opciones: opcionesSeleccionadas.map(op => ({ opcion_id: op.id, nombre: op.nombre, emoji: op.emoji, color: op.color })),
    })
    const siguiente = colaIndex + 1
    if (siguiente < cola.length) { setColaIndex(siguiente); setOpcionesSeleccionadas([]); setGrupoActivo(null) }
    else {
      setAgregado(true)
      setTimeout(() => { setAgregado(false); setCola([]); setColaIndex(0); setOpcionesSeleccionadas([]); setCantidad({}); setPaso('categorias'); setCategoriaActiva(null) }, 900)
    }
  }

  function volverPaso() {
    if (paso === 'opciones') {
      if (colaIndex > 0) { setColaIndex(colaIndex - 1); setOpcionesSeleccionadas([]) }
      else { setPaso('productos'); setCola([]); setColaIndex(0); setOpcionesSeleccionadas([]) }
    } else if (paso === 'productos') {
      setPaso('categorias'); setCategoriaActiva(null); setCantidad({})
    } else onVolver()
  }

  const productosFiltrados = productos.filter(p => p.categoria_id === categoriaActiva?.id)
  const totalCarrito = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const actualCola = cola[colaIndex]

  const gruposDeActual = actualCola
    ? grupos.filter(g => presGrupos.some(pg => pg.presentacion_id === actualCola.presentacion.id && pg.grupo_id === g.id)).sort((a, b) => a.orden - b.orden)
    : []
  const opcionesDeActual = actualCola
    ? opciones.filter(op => presGrupos.some(pg => pg.presentacion_id === actualCola.presentacion.id && pg.grupo_id === op.grupo_id))
    : []
  const opcionesFiltradas = grupoActivo ? opcionesDeActual.filter(op => op.grupo_id === grupoActivo) : opcionesDeActual

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#fdf8f4]">
      <div className="text-center"><span className="text-5xl animate-bounce block mb-4">🍦</span><p className="text-neutral-400">Cargando...</p></div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-[#fdf8f4]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3" style={{ backgroundColor: config.primary_color }}>
        <button onClick={volverPaso} className="flex items-center gap-2 text-white/80 hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5" /><span className="text-sm font-medium">Volver</span>
        </button>
        <LogoHeader config={config} dispositivo={dispositivo} />
        <button onClick={onVerCarrito} className="relative flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl transition-colors">
          <ShoppingCart className="h-5 w-5 text-white" />
          {carrito.length > 0 && <span className="text-white font-bold text-sm">{formatPrecio(totalCarrito)}</span>}
          {carrito.length > 0 && <span className="absolute -top-1.5 -right-1.5 bg-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center" style={{ color: config.primary_color }}>{carrito.length}</span>}
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="px-6 py-3 flex items-center justify-center gap-2 text-sm text-neutral-400 flex-wrap">
        <span className="cursor-pointer hover:text-neutral-600" onClick={() => { setPaso('categorias'); setCategoriaActiva(null); setCola([]); setCantidad({}) }}>Categorías</span>
        {categoriaActiva && <><span>›</span><span className="text-neutral-600">{categoriaActiva.nombre}</span></>}
        {paso === 'opciones' && actualCola && <><span>›</span><span className="font-medium text-neutral-700">{actualCola.presentacion.nombre}{actualCola.total > 1 ? ` #${actualCola.numero}` : ''}</span></>}
      </div>

      <div className={`flex-1 px-6 flex flex-col items-center ${paso === 'opciones' ? 'pb-36' : paso === 'productos' ? 'pb-36' : 'pb-8'}`}>

        {/* Categorías */}
        {paso === 'categorias' && (
          <div className="w-full max-w-2xl">
            <h2 className="text-2xl font-bold text-neutral-800 mb-6 text-center">¿Qué querés pedir?</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {categorias.map(cat => (
                <button key={cat.id} onClick={() => seleccionarCategoria(cat)}
                  className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl shadow-sm border border-neutral-100 hover:shadow-md active:scale-95 transition-all gap-3 min-h-[140px]">
                  {cat.icono_url ? <Image src={cat.icono_url} alt={cat.nombre} width={64} height={64} className="object-contain" /> : <span className="text-5xl">{emojiCategoria(cat.nombre)}</span>}
                  <span className="text-neutral-700 font-semibold text-center">{cat.nombre}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Productos con selector de cantidad inline */}
        {paso === 'productos' && categoriaActiva && (
          <div className="w-full max-w-2xl">
            <h2 className="text-2xl font-bold text-neutral-800 mb-6 text-center">{categoriaActiva.nombre}</h2>
            <div className="flex flex-col gap-4">
              {productosFiltrados.map(prod => {
                const pres = presentaciones.filter(p => p.producto_id === prod.id)
                const emoji = emojiCategoria(categoriaActiva.nombre)
                return (
                  <div key={prod.id} className="bg-white rounded-2xl shadow-sm border border-neutral-100 overflow-hidden">
                    <div className="flex gap-4 p-4">
                      {/* Imagen o emoji */}
                      <div className="w-20 h-20 bg-neutral-50 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {prod.imagen_url
                          ? <Image src={prod.imagen_url} alt={prod.nombre} width={80} height={80} className="object-cover w-full h-full" />
                          : <span className="text-4xl">{emoji}</span>}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-neutral-800 font-semibold">{prod.nombre}</p>
                        {prod.descripcion && <p className="text-neutral-400 text-xs mt-0.5 line-clamp-2">{prod.descripcion}</p>}
                      </div>
                    </div>

                    {/* Presentaciones con selector */}
                    <div className="border-t border-neutral-100 divide-y divide-neutral-50">
                      {pres.map(p => {
                        const cant = getCant(prod.id, p.id)
                        return (
                          <div key={p.id} className="flex items-center justify-between px-4 py-3">
                            <div>
                              <p className="text-neutral-700 text-sm font-medium">{p.nombre}</p>
                              <p className="font-bold" style={{ color: config.primary_color }}>{formatPrecio(p.precio)}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setCant(prod.id, p.id, cant - 1)}
                                className="w-9 h-9 flex items-center justify-center rounded-xl border-2 border-neutral-200 hover:border-neutral-400 bg-white transition-colors">
                                <Minus className="h-4 w-4 text-neutral-600" />
                              </button>
                              <span className="text-lg font-bold text-neutral-900 w-6 text-center">{cant}</span>
                              <button onClick={() => setCant(prod.id, p.id, cant + 1)}
                                className="w-9 h-9 flex items-center justify-center rounded-xl border-2 text-white transition-colors"
                                style={{ backgroundColor: config.primary_color, borderColor: config.primary_color }}>
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Opciones / Sabores */}
        {paso === 'opciones' && actualCola && (
          <div className="w-full max-w-2xl">
            {cola.length > 1 && (
              <div className="flex justify-center gap-1.5 mb-4">
                {cola.map((_, i) => <div key={i} className="h-2 w-8 rounded-full transition-colors" style={{ backgroundColor: i <= colaIndex ? config.primary_color : '#e5e7eb' }} />)}
              </div>
            )}
            <div className="text-center mb-4">
              <p className="text-sm font-medium mb-1" style={{ color: config.primary_color }}>
                {cola.length > 1 ? `${colaIndex + 1} de ${cola.length} — ${actualCola.presentacion.nombre}${actualCola.total > 1 ? ` #${actualCola.numero}` : ''}` : actualCola.presentacion.nombre}
              </p>
              <h2 className="text-xl font-bold text-neutral-800">{actualCola.producto.nombre}</h2>
              <p className="text-neutral-500 text-sm mt-1">
                {actualCola.presentacion.opciones_max === 1 ? 'Elegí una variedad' : `Elegí entre ${actualCola.presentacion.opciones_min} y ${actualCola.presentacion.opciones_max} sabores`}
                {' '}<span className="font-medium" style={{ color: config.primary_color }}>({opcionesSeleccionadas.length}/{actualCola.presentacion.opciones_max})</span>
              </p>
            </div>

            {actualCola.presentacion.opciones_max > 1 && (
              <div className="flex gap-1.5 mb-4 max-w-xs mx-auto">
                {Array.from({ length: actualCola.presentacion.opciones_max }).map((_, i) => <div key={i} className="h-1.5 flex-1 rounded-full transition-colors" style={{ backgroundColor: i < opcionesSeleccionadas.length ? config.primary_color : '#e5e7eb' }} />)}
              </div>
            )}

            {opcionesSeleccionadas.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                {opcionesSeleccionadas.map(op => (
                  <button key={op.id} onClick={() => toggleOpcion(op)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white" style={{ backgroundColor: config.primary_color }}>
                    {op.emoji} {op.nombre} <span className="opacity-70">✕</span>
                  </button>
                ))}
              </div>
            )}

            {gruposDeActual.length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1 justify-center">
                <button onClick={() => setGrupoActivo(null)} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${!grupoActivo ? 'text-white' : 'bg-neutral-100 text-neutral-500'}`} style={!grupoActivo ? { backgroundColor: config.primary_color } : {}}>Todos</button>
                {gruposDeActual.map(g => (
                  <button key={g.id} onClick={() => setGrupoActivo(grupoActivo === g.id ? null : g.id)} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${grupoActivo === g.id ? 'text-white' : 'bg-neutral-100 text-neutral-500'}`} style={grupoActivo === g.id ? { backgroundColor: config.primary_color } : {}}>{g.nombre}</button>
                ))}
              </div>
            )}

            <div className={`grid gap-3 ${actualCola.presentacion.opciones_max === 1 ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
              {opcionesFiltradas.map(op => {
                const sel = opcionesSeleccionadas.find(o => o.id === op.id)
                const maxAlcanzado = opcionesSeleccionadas.length >= actualCola.presentacion.opciones_max
                return (
                  <button key={op.id} onClick={() => toggleOpcion(op)} disabled={!sel && maxAlcanzado}
                    className={`relative flex ${actualCola.presentacion.opciones_max === 1 ? 'flex-row items-center gap-3 text-left' : 'flex-col items-center text-center'} p-4 rounded-2xl border-2 transition-all active:scale-95 bg-white ${sel ? 'shadow-md' : 'border-neutral-100 hover:border-neutral-300'} disabled:opacity-30`}
                    style={sel ? { borderColor: config.primary_color } : {}}>
                    {sel && <div className="absolute top-2 right-2 rounded-full w-5 h-5 flex items-center justify-center" style={{ backgroundColor: config.primary_color }}><Check className="h-3 w-3 text-white" /></div>}
                    <span className={actualCola.presentacion.opciones_max === 1 ? 'text-2xl flex-shrink-0' : 'text-3xl'}>{op.emoji ?? '🍦'}</span>
                    <div>
                      <p className="text-neutral-800 font-medium text-sm leading-tight">{op.nombre}</p>
                      {op.descripcion && <p className="text-neutral-400 text-xs mt-0.5 line-clamp-2">{op.descripcion}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Botón fijo abajo — productos */}
      {paso === 'productos' && haySeleccionEnCategoria() && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#fdf8f4] border-t border-neutral-100 p-4">
          <div className="max-w-md mx-auto">
            <button onClick={confirmarSeleccion}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all"
              style={{ backgroundColor: config.primary_color }}>
              {agregado
                ? <><Check className="h-5 w-5" /> ¡Agregado!</>
                : <><ShoppingCart className="h-5 w-5" /> Continuar — {formatPrecio(totalSeleccionado())}</>}
            </button>
          </div>
        </div>
      )}

      {/* Botón fijo abajo — opciones */}
      {paso === 'opciones' && actualCola && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#fdf8f4] border-t border-neutral-100 p-4">
          <div className="max-w-md mx-auto">
            <button onClick={confirmarSabores}
              disabled={(actualCola.presentacion.permite_opciones && opcionesSeleccionadas.length < actualCola.presentacion.opciones_min) || agregado}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-95 transition-all disabled:opacity-40"
              style={{ backgroundColor: config.primary_color }}>
              {agregado ? <><Check className="h-5 w-5" /> ¡Agregado!</> : colaIndex < cola.length - 1 ? <>Confirmar y siguiente →</> : <><ShoppingCart className="h-5 w-5" /> Agregar al pedido</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
