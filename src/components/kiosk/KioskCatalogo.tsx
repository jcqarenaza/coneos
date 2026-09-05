'use client'

import { useEffect, useState } from 'react'

import { ShoppingCart, ArrowLeft, Check, Plus, Minus, X } from 'lucide-react'
import type { EmpresaConfig, DispositivoKiosk, ItemCarrito } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Categoria { id: string; nombre: string; icono_url: string | null }
interface Producto { id: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria_id: string }
interface Presentacion { id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; producto_id: string; imagen_url: string | null; es_novedad?: boolean }
interface Opcion { id: string; nombre: string; descripcion: string | null; emoji: string | null; imagen_url: string | null; color: string | null; grupo_id: string; precio_adicional?: number }
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

function getEmoji(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.includes('helado') || n.includes('kilo')) return '🍦'
  if (n.includes('balde')) return '🧊'
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
  const [presGrupos, setPresGrupos] = useState<PresGrupo[]>([])
  const [loading, setLoading] = useState(true)

  const [paso, setPaso] = useState<Paso>('categorias')
  const [categoriaActiva, setCategoriaActiva] = useState<Categoria | null>(null)
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

  function seleccionarCategoria(cat: Categoria) { setCategoriaActiva(cat); setCantidad({}); setPaso('productos') }
  // Novedades: el banner solo NAVEGA al producto (categoría + scroll). No agrega nada al carrito.
  function irANovedad(pres: Presentacion) {
    const prod = productos.find(p => p.id === pres.producto_id)
    if (!prod) return
    const cat = categorias.find(c => c.id === prod.categoria_id)
    if (!cat) return
    setCategoriaActiva(cat); setCantidad({}); setPaso('productos')
    setTimeout(() => { document.getElementById(`prod-${prod.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 200)
  }

  function agregarSinOpciones(prod: Producto, pres: Presentacion, cant: number) {
    for (let i = 0; i < cant; i++) {
      onAgregar({ presentacion_id: pres.id, nombre_producto: prod.nombre, nombre_presentacion: pres.nombre, precio: pres.precio, cantidad: 1, opciones: [] })
    }
  }

  function confirmarSeleccion() {
    const prods = productos.filter(p => p.categoria_id === categoriaActiva?.id)
    const nuevaCola: PendienteSabores[] = []
    prods.forEach(prod => {
      const pres = presentaciones.filter(p => p.producto_id === prod.id)
      pres.forEach(p => {
        const cant = getCant(prod.id, p.id)
        if (cant === 0) return
        if (!p.permite_opciones) { agregarSinOpciones(prod, p, cant) }
        else { for (let i = 0; i < cant; i++) nuevaCola.push({ presentacion: p, producto: prod, numero: i + 1, total: cant }) }
      })
    })
    if (nuevaCola.length === 0) {
      setAgregado(true)
      setTimeout(() => { setAgregado(false); setCantidad({}); setPaso('categorias'); setCategoriaActiva(null) }, 900)
      return
    }
    setCola(nuevaCola); setColaIndex(0); setOpcionesSeleccionadas([]); setGrupoActivo(null); setPaso('opciones')
  }

  function esAccesorio(op: Opcion): boolean {
    const grupo = grupos.find(g => g.id === op.grupo_id)
    return grupo?.nombre.toLowerCase().includes('accesorio') ?? false
  }

  function toggleOpcion(op: Opcion) {
    const actual = cola[colaIndex]
    if (!actual) return
    const ya = opcionesSeleccionadas.find(o => o.id === op.id)
    if (ya) { setOpcionesSeleccionadas(prev => prev.filter(o => o.id !== op.id)) }
    else {
      // Accesorios no cuentan para el límite de sabores
      if (!esAccesorio(op)) {
        const saboresSeleccionados = opcionesSeleccionadas.filter(o => !esAccesorio(o))
        if (saboresSeleccionados.length >= actual.presentacion.opciones_max) return
      }
      setOpcionesSeleccionadas(prev => [...prev, op])
    }
  }

  function confirmarSabores() {
    const actual = cola[colaIndex]
    if (!actual) return
    const saboresCount = opcionesSeleccionadas.filter(o => { const g = grupos.find(gr => gr.id === o.grupo_id); return !g?.nombre.toLowerCase().includes('accesorio') }).length
    if (actual.presentacion.permite_opciones && saboresCount < actual.presentacion.opciones_min) return
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
      setPaso('categorias')
      // NO reseteamos categoriaActiva ni cantidad — el usuario puede volver a entrar
      setCantidad({})
    }
    else onVolver()
  }

  const productosFiltrados = productos.filter(p => p.categoria_id === categoriaActiva?.id)
  const novedades = presentaciones.filter(p => p.es_novedad === true)
    .map(pres => ({ pres, prod: productos.find(pr => pr.id === pres.producto_id) }))
    .filter((n): n is { pres: Presentacion; prod: Producto } => !!n.prod)
  const totalCarrito = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const actualCola = cola[colaIndex]
  const haySeleccion = productos.filter(p => p.categoria_id === categoriaActiva?.id).some(prod =>
    presentaciones.filter(p => p.producto_id === prod.id).some(p => getCant(prod.id, p.id) > 0)
  )
  const totalSeleccionado = productos.filter(p => p.categoria_id === categoriaActiva?.id).reduce((acc, prod) => {
    return acc + presentaciones.filter(p => p.producto_id === prod.id).reduce((a, p) => a + getCant(prod.id, p.id) * p.precio, 0)
  }, 0)

  const gruposDeActual = actualCola
    ? grupos.filter(g => presGrupos.some(pg => pg.presentacion_id === actualCola.presentacion.id && pg.grupo_id === g.id)).sort((a, b) => a.orden - b.orden)
    : []
  // Multi-rubro F1: la etiqueta de selección usa el NOMBRE DEL GRUPO real de la
  // presentación ("sabores", "adicionales", "salsas", "variedades"). Con varios
  // grupos (sin contar accesorios) cae al genérico "opciones".
  function etiquetaOpciones(presentacionId: string): string {
    const gs = grupos.filter(g => presGrupos.some(pg => pg.presentacion_id === presentacionId && pg.grupo_id === g.id) && !g.nombre.toLowerCase().includes('accesorio'))
    return gs.length === 1 ? gs[0].nombre.toLowerCase() : 'opciones'
  }
  const opcionesDeActual = actualCola
    ? opciones.filter(op => presGrupos.some(pg => pg.presentacion_id === actualCola.presentacion.id && pg.grupo_id === op.grupo_id))
    : []
  const opcionesFiltradas = grupoActivo ? opcionesDeActual.filter(op => op.grupo_id === grupoActivo) : opcionesDeActual

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <div className="text-center"><span className="text-6xl block mb-4 animate-bounce">🛍️</span><p className="text-neutral-400">Cargando catálogo...</p></div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-100 shadow-sm">
        <button onClick={volverPaso} className="flex items-center gap-2 px-4 py-2 rounded-xl text-neutral-500 hover:bg-neutral-50 active:bg-neutral-100 transition-colors">
          <ArrowLeft className="h-5 w-5" /><span className="text-sm font-medium">Volver</span>
        </button>
        {config.logo_url
          ? <img src={config.logo_url} alt="Logo" width={120} height={48} className="object-contain" style={{ maxHeight: 44 }} />
          : <span className="font-bold text-lg" style={{ color: config.primary_color }}>{dispositivo.empresas?.nombre}</span>}
        <button onClick={onVerCarrito} className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-white font-medium transition-all active:scale-95" style={{ backgroundColor: config.primary_color }}>
          <ShoppingCart className="h-5 w-5" />
          {carrito.length > 0 ? (
            <><span className="text-sm">{formatPrecio(totalCarrito)}</span>
            <span className="absolute -top-1.5 -right-1.5 bg-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shadow" style={{ color: config.primary_color }}>{carrito.length}</span></>
          ) : <span className="text-sm text-white/70">Carrito</span>}
        </button>
      </div>

      {/* Breadcrumb */}
      {categoriaActiva && (
        <div className="px-6 py-2 flex items-center gap-2 text-sm text-neutral-400">
          <button onClick={() => { setPaso('categorias'); setCategoriaActiva(null); setCantidad({}) }} className="hover:text-neutral-600">Categorías</button>
          <span>›</span><span className="text-neutral-600 font-medium">{categoriaActiva.nombre}</span>
          {paso === 'opciones' && actualCola && <><span>›</span><span className="font-medium" style={{ color: config.primary_color }}>{actualCola.presentacion.nombre}{actualCola.total > 1 ? ` #${actualCola.numero}` : ''}</span></>}
        </div>
      )}

      <div className={`flex-1 px-6 ${paso === 'opciones' || haySeleccion ? 'pb-56' : 'pb-8'}`}>

        {/* Categorías */}
        {paso === 'categorias' && (
          <div className="max-w-3xl mx-auto pt-6">
            {novedades.length > 0 && (
              <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-3 mb-5">
                <p className="text-sm font-bold mb-2 flex items-center gap-1.5" style={{ color: config.primary_color }}>✨ Novedades</p>
                <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {novedades.map(({ pres, prod }) => (
                    <button key={pres.id} onClick={() => irANovedad(pres)}
                      className="flex items-center gap-2.5 border border-neutral-100 rounded-xl px-2.5 py-2 flex-shrink-0 active:scale-95 transition-transform bg-white text-left">
                      {(pres.imagen_url || prod.imagen_url) && (
                        <div className="w-11 h-11 rounded-lg overflow-hidden bg-neutral-50 flex-shrink-0">
                          <img src={pres.imagen_url ?? prod.imagen_url!} alt="" className="object-cover w-full h-full" />
                        </div>
                      )}
                      <div className="pr-1">
                        <p className="text-sm font-semibold text-neutral-800 leading-tight whitespace-nowrap">{prod.nombre}</p>
                        <p className="text-xs text-neutral-400 leading-tight whitespace-nowrap">{pres.nombre} · <span className="font-bold" style={{ color: config.primary_color }}>${Number(pres.precio).toLocaleString('es-AR')}</span></p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: config.primary_color }}>¿Qué querés pedir?</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {categorias.map(cat => {
                const fotosProds = productos.filter(p => p.categoria_id === cat.id && p.imagen_url).map(p => p.imagen_url!).slice(0, 4)
                const seen = new Set<string>()
                const fotosPres = fotosProds.length === 0
                  ? presentaciones.filter(p => productos.some(pr => pr.categoria_id === cat.id && pr.id === p.producto_id) && p.imagen_url)
                      .filter(p => { if (seen.has(p.imagen_url!)) return false; seen.add(p.imagen_url!); return true })
                      .map(p => p.imagen_url!).slice(0, 4)
                  : []
                const seen2 = new Set<string>()
                const fotosSabores = fotosProds.length === 0 && fotosPres.length === 0
                  ? (() => {
                      const prodIds = new Set(productos.filter(p => p.categoria_id === cat.id).map(p => p.id))
                      const presIds = new Set(presentaciones.filter(p => prodIds.has(p.producto_id)).map(p => p.id))
                      const grupoIds = new Set(presGrupos.filter(pg => presIds.has(pg.presentacion_id)).map(pg => pg.grupo_id))
                      return opciones.filter(op => grupoIds.has(op.grupo_id) && op.imagen_url)
                        .filter(op => { if (seen2.has(op.imagen_url!)) return false; seen2.add(op.imagen_url!); return true })
                        .map(op => op.imagen_url!).slice(0, 4)
                    })()
                  : []
                const fotos = fotosProds.length > 0 ? fotosProds : fotosPres.length > 0 ? fotosPres : fotosSabores
                const tieneIcono = !!cat.icono_url

                return (
                  <button key={cat.id} onClick={() => seleccionarCategoria(cat)}
                    className="group relative flex flex-col rounded-2xl bg-white border border-neutral-100 shadow-sm hover:shadow-lg active:scale-95 transition-all duration-200 overflow-hidden min-h-[150px]">
                    <div className="flex-1 w-full p-2">
                      {tieneIcono ? (
                        <div className="w-full h-full rounded-xl overflow-hidden">
                          <img src={cat.icono_url!} alt={cat.nombre} width={200} height={200} className="object-cover w-full h-full" />
                        </div>
                      ) : fotos.length === 1 ? (
                        <div className="w-full h-full rounded-xl overflow-hidden">
                          <img src={fotos[0]} alt="" width={200} height={200} className="object-cover w-full h-full" />
                        </div>
                      ) : fotos.length > 1 ? (
                        <div className={`w-full h-full grid gap-0.5 rounded-xl overflow-hidden ${fotos.length >= 4 ? 'grid-cols-2 grid-rows-2' : fotos.length === 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2'}`}>
                          {fotos.slice(0, 4).map((url, i) => (
                            <div key={i} className={`overflow-hidden ${fotos.length === 3 && i === 0 ? 'row-span-2' : ''}`}>
                              <img src={url} alt="" width={100} height={100} className="object-cover w-full h-full" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-6xl group-hover:scale-110 transition-transform duration-200">{getEmoji(cat.nombre)}</span>
                        </div>
                      )}
                    </div>
                    <div className="px-3 pb-3 pt-1 text-center">
                      <span className="text-sm font-bold text-neutral-700">{cat.nombre}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Productos */}
        {paso === 'productos' && categoriaActiva && (
          <div className="max-w-2xl mx-auto pt-4">
            <h2 className="text-xl font-bold mb-5" style={{ color: config.primary_color }}>{categoriaActiva.nombre}</h2>
            <div className="space-y-4">
              {productosFiltrados.map(prod => {
                const pres = presentaciones.filter(p => p.producto_id === prod.id)
                return (
                  <div key={prod.id} id={`prod-${prod.id}`} className="bg-white rounded-2xl shadow-sm border border-neutral-100 overflow-hidden">
                    <div className="flex gap-4 p-4 items-center">
                      {(() => {
                        const algunaTieneImagen = pres.some(p => p.imagen_url)
                        // Si alguna presentación tiene foto, no mostrar imagen/emoji del producto
                        if (algunaTieneImagen) return null
                        return (
                          <div className="w-20 h-20 rounded-xl bg-neutral-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {prod.imagen_url
                              ? <img src={prod.imagen_url} alt={prod.nombre} width={80} height={80} className="object-cover w-full h-full" />
                              : null}
                          </div>
                        )
                      })()}
                      <div className="flex-1">
                        <p className="font-bold text-neutral-800 text-lg">{prod.nombre}</p>
                        {prod.descripcion && <p className="text-neutral-400 text-sm mt-0.5">{prod.descripcion}</p>}
                      </div>
                    </div>
                    <div className="border-t border-neutral-50">
                      {pres.map((p, i) => {
                        const cant = getCant(prod.id, p.id)
                        return (
                          <div key={p.id} className={`flex items-center justify-between px-5 py-3.5 ${i < pres.length - 1 ? 'border-b border-neutral-50' : ''} ${cant > 0 ? 'bg-blue-50/50' : ''}`}>
                            <div className="flex items-center gap-3">
                            {p.imagen_url && (
                              <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
                                <img src={p.imagen_url} alt={p.nombre} width={56} height={56} className="object-cover w-full h-full" />
                              </div>
                            )}
                            <div>
                              <p className="font-semibold text-neutral-700">{p.nombre}</p>
                              <p className="font-bold text-lg" style={{ color: config.primary_color }}>{formatPrecio(p.precio)}</p>
                              {p.permite_opciones && <p className="text-xs text-neutral-400">{p.opciones_max === 1 ? 'Elegís variedad' : `${p.opciones_min}–${p.opciones_max} ${etiquetaOpciones(p.id)}`}</p>}
                            </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setCant(prod.id, p.id, cant - 1)} className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-neutral-200 bg-white active:bg-neutral-50 transition-colors">
                                <Minus className="h-4 w-4 text-neutral-600" />
                              </button>
                              <span className="text-xl font-bold text-neutral-900 w-7 text-center">{cant}</span>
                              <button onClick={() => setCant(prod.id, p.id, cant + 1)} className="w-10 h-10 flex items-center justify-center rounded-xl border-2 text-white transition-colors active:opacity-80"
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
          <div className="max-w-2xl mx-auto pt-4">
            {cola.length > 1 && (
              <div className="flex justify-center gap-2 mb-5">
                {cola.map((_, i) => (
                  <div key={i} className="h-2 rounded-full transition-all" style={{ width: i === colaIndex ? 32 : 12, backgroundColor: i <= colaIndex ? config.primary_color : '#e5e7eb' }} />
                ))}
              </div>
            )}
            <div className="text-center mb-5">
              <p className="text-sm font-semibold tracking-wide uppercase mb-1" style={{ color: config.secondary_color }}>
                {cola.length > 1 ? `${colaIndex + 1} de ${cola.length}` : actualCola.presentacion.nombre}
              </p>
              <h2 className="text-2xl font-bold mb-1" style={{ color: config.primary_color }}>
                {actualCola.producto.nombre}
                {actualCola.total > 1 && <span className="text-lg font-normal text-neutral-400 ml-2">#{actualCola.numero}</span>}
              </h2>
              <p className="text-neutral-500">
                {actualCola.presentacion.opciones_max === 1 ? 'Elegí una variedad' : `Elegí entre ${actualCola.presentacion.opciones_min} y ${actualCola.presentacion.opciones_max} ${actualCola ? etiquetaOpciones(actualCola.presentacion.id) : 'opciones'}`}
                {' '}<span className="font-bold" style={{ color: config.primary_color }}>({opcionesSeleccionadas.filter(o => { const g = grupos.find(gr => gr.id === o.grupo_id); return !g?.nombre.toLowerCase().includes('accesorio') }).length}/{actualCola.presentacion.opciones_max})</span>
              </p>
            </div>

            {actualCola.presentacion.opciones_max > 1 && (
              <div className="flex gap-2 mb-5 max-w-xs mx-auto">
                {Array.from({ length: actualCola.presentacion.opciones_max }).map((_, i) => (
                  <div key={i} className="h-2 flex-1 rounded-full transition-colors" style={{ backgroundColor: i < opcionesSeleccionadas.length ? config.primary_color : '#e5e7eb' }} />
                ))}
              </div>
            )}

            {opcionesSeleccionadas.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-5">
                {opcionesSeleccionadas.map(op => (
                  <button key={op.id} onClick={() => toggleOpcion(op)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-white text-sm font-medium shadow-sm active:opacity-80 transition-opacity"
                    style={{ backgroundColor: config.primary_color }}>
                    {op.imagen_url
                      ? <img src={op.imagen_url} alt={op.nombre} width={18} height={18} className="rounded-full object-cover" />
                      : op.emoji}
                    {op.nombre}<X className="h-3.5 w-3.5 opacity-70" />
                  </button>
                ))}
              </div>
            )}

            {gruposDeActual.length > 1 && (
              <div className="flex gap-2 mb-5 overflow-x-auto pb-1 justify-center">
                <button onClick={() => setGrupoActivo(null)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${!grupoActivo ? 'text-white shadow-sm' : 'bg-white text-neutral-400 border border-neutral-200'}`}
                  style={!grupoActivo ? { backgroundColor: config.primary_color } : {}}>Todos</button>
                {gruposDeActual.map(g => (
                  <button key={g.id} onClick={() => setGrupoActivo(grupoActivo === g.id ? null : g.id)}
                    className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${grupoActivo === g.id ? 'text-white shadow-sm' : 'bg-white text-neutral-400 border border-neutral-200'}`}
                    style={grupoActivo === g.id ? { backgroundColor: config.primary_color } : {}}>
                    {g.nombre}
                  </button>
                ))}
              </div>
            )}

            {/* Grid sabores — con imagen si existe */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[...opcionesFiltradas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(op => {
                const sel = opcionesSeleccionadas.find(o => o.id === op.id)
                const saboresSeleccionados = opcionesSeleccionadas.filter(o => { const g = grupos.find(gr => gr.id === o.grupo_id); return !g?.nombre.toLowerCase().includes('accesorio') })
                const maxAlcanzado = !esAccesorio(op) && saboresSeleccionados.length >= actualCola.presentacion.opciones_max
                const tieneImagen = !!op.imagen_url

                return (
                  <button key={op.id} onClick={() => toggleOpcion(op)} disabled={!sel && maxAlcanzado}
                    className={`relative flex flex-col rounded-2xl border-2 bg-white transition-all active:scale-95 overflow-hidden ${sel ? 'shadow-md' : 'border-neutral-100 hover:border-neutral-200'} disabled:opacity-30`}
                    style={sel ? { borderColor: config.primary_color } : {}}>

                    {/* Visual adaptativo: foto = tile completo (heladería con fotos);
                        emoji = tile más bajo; sin nada = card sobria solo texto
                        (gastronómico: "Punto jugoso", "Sin sal" — nunca un 🍦 ajeno) */}
                    {tieneImagen ? (
                      <div className="w-full aspect-square overflow-hidden bg-neutral-50">
                        <img src={op.imagen_url!} alt={op.nombre} width={200} height={200} className="object-cover w-full h-full" />
                      </div>
                    ) : op.emoji ? (
                      <div className="w-full h-20 flex items-center justify-center bg-neutral-50">
                        <span className="text-3xl">{op.emoji}</span>
                      </div>
                    ) : null}

                    {/* Check overlay */}
                    {sel && (
                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-md" style={{ backgroundColor: config.primary_color }}>
                        <Check className="h-4 w-4 text-white" />
                      </div>
                    )}

                    {/* Nombre */}
                    <div className={`p-2 text-center ${!tieneImagen && !op.emoji ? 'py-5 px-3' : ''}`}>
                      <p className={`text-neutral-800 font-semibold leading-tight ${!tieneImagen && !op.emoji ? 'text-base' : 'text-sm'}`}>{op.nombre}</p>
                      {op.descripcion && <p className="text-neutral-400 text-xs mt-0.5 line-clamp-1">{op.descripcion}</p>}
                      {(op.precio_adicional ?? 0) > 0 && <p className="text-xs font-bold mt-0.5" style={{ color: config.primary_color }}>+${Number(op.precio_adicional).toLocaleString('es-AR')}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Botón fijo — productos */}
      {paso === 'productos' && haySeleccion && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 pb-8 bg-white/90 backdrop-blur-sm border-t border-neutral-100" style={{ paddingBottom: "max(3.5rem, env(safe-area-inset-bottom, 3.5rem))" }}>
          <div className="max-w-md mx-auto">
            <button onClick={confirmarSeleccion}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-98 transition-all"
              style={{ backgroundColor: config.primary_color }}>
              {agregado ? <><Check className="h-5 w-5" /> ¡Agregado!</>
                : productos.filter(p => p.categoria_id === categoriaActiva?.id).some(prod =>
                    presentaciones.filter(p => p.producto_id === prod.id).some(p => p.permite_opciones && getCant(prod.id, p.id) > 0)
                  )
                  ? <>Elegir {actualCola ? etiquetaOpciones(actualCola.presentacion.id) : 'opciones'} → — {formatPrecio(totalSeleccionado)}</>
                  : <><ShoppingCart className="h-5 w-5" /> Agregar — {formatPrecio(totalSeleccionado)}</>}
            </button>
          </div>
        </div>
      )}

      {/* Botón fijo — opciones */}
      {paso === 'opciones' && actualCola && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 pb-8 bg-white/90 backdrop-blur-sm border-t border-neutral-100" style={{ paddingBottom: "max(3.5rem, env(safe-area-inset-bottom, 3.5rem))" }}>
          <div className="max-w-md mx-auto">
            <button onClick={confirmarSabores}
              disabled={(actualCola.presentacion.permite_opciones && opcionesSeleccionadas.length < actualCola.presentacion.opciones_min) || agregado}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl text-white font-bold text-lg shadow-lg active:scale-98 transition-all disabled:opacity-40"
              style={{ backgroundColor: config.primary_color }}>
              {agregado ? <><Check className="h-5 w-5" /> ¡Agregado!</>
                : colaIndex < cola.length - 1
                  ? <>Confirmar y siguiente →</>
                  : <><ShoppingCart className="h-5 w-5" /> Agregar — {formatPrecio(actualCola.presentacion.precio)}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
