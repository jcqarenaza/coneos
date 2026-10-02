'use client'

// ═══════════════════════════════════════════════════════════════
// COMPRAS/REMITOS V1 · T2 — Maestros: Proveedores + Artículos
// (GO CTO 29/09). Gate duro por modulos.compras. Todo por API
// server-side (/api/compras) con Bearer del admin — cero
// mutaciones desde el browser. Baja LÓGICA siempre.
// Slug por window.location.pathname (Next 16: params Promise).
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Pencil, Package, Truck, Boxes, Download } from 'lucide-react'

interface Proveedor { id: string; nombre: string; razon_social: string | null; cuit: string | null; telefono: string | null; email: string | null; direccion: string | null; observaciones: string | null; activo: boolean }
interface Articulo { id: string; nombre: string; tipo: string; unidad_stock: string; producto_id: string | null; controla_stock: boolean; activo: boolean }
interface Presentacion { id: string; articulo_id: string; nombre: string; factor: number; activo: boolean }
interface ProductoVenta { id: string; nombre: string }
interface Sucursal { id: string; nombre: string }
interface OC { id: string; numero: number; proveedor_id: string; sucursal_id: string | null; estado: string; fecha: string; observaciones: string | null }
interface OCItem { id: string; orden_compra_id: string; articulo_id: string; presentacion_id: string | null; cantidad: number; costo_previsto: number | null }
interface RenglonForm { articulo_id: string; presentacion_id: string; cantidad: string; costo_previsto: string }
interface Remito { id: string; numero: number; numero_proveedor: string | null; proveedor_id: string; sucursal_id: string; orden_compra_id: string | null; tipo: string; fecha: string; estado: string; confirmado_at: string | null; observaciones: string | null }
interface RemitoItem { id: string; remito_id: string; articulo_id: string; presentacion_id: string | null; cantidad: number; factor_snap: number; cantidad_operativa: number; costo_unitario: number; cantidad_pedida: number | null }

const TIPOS = [
  { value: 'mercaderia', label: 'Mercadería' },
  { value: 'insumo', label: 'Insumo' },
  { value: 'material', label: 'Material' },
]
const UNIDADES = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro']

export default function ComprasPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [moduloOn, setModuloOn] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'proveedores' | 'articulos' | 'ordenes' | 'remitos'>('proveedores')
  const [loading, setLoading] = useState(true)
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [productos, setProductos] = useState<ProductoVenta[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [ocs, setOcs] = useState<OC[]>([])
  const [ocItems, setOcItems] = useState<OCItem[]>([])
  const [remitos, setRemitos] = useState<Remito[]>([])
  const [remitoItems, setRemitoItems] = useState<RemitoItem[]>([])
  const [saving, setSaving] = useState(false)

  // Modales
  const [modalProv, setModalProv] = useState(false)
  const [provEdit, setProvEdit] = useState<string | null>(null)
  const [fProv, setFProv] = useState({ nombre: '', razon_social: '', cuit: '', telefono: '', email: '', direccion: '', observaciones: '' })
  const [modalArt, setModalArt] = useState(false)
  const [artEdit, setArtEdit] = useState<string | null>(null)
  const [fArt, setFArt] = useState({ nombre: '', tipo: 'insumo', unidad_stock: 'unidad', controla_stock: true, producto_id: '' })
  const [modalRemito, setModalRemito] = useState(false)
  const [remitoAbierto, setRemitoAbierto] = useState<string | null>(null)   // id del remito en pantalla
  const [fRem, setFRem] = useState({ proveedor_id: '', sucursal_id: '', orden_compra_id: '', numero_proveedor: '', observaciones: '' })
  const [lineaForm, setLineaForm] = useState<{ item_id: string | null; articulo_id: string; presentacion_id: string; cantidad: string; costo_bulto: string } | null>(null)
  const [modalOC, setModalOC] = useState(false)
  const [ocDetalle, setOcDetalle] = useState<OC | null>(null)
  const [fOC, setFOC] = useState<{ proveedor_id: string; sucursal_id: string; observaciones: string; renglones: RenglonForm[] }>({ proveedor_id: '', sucursal_id: '', observaciones: '', renglones: [] })
  const [modalImport, setModalImport] = useState(false)
  const [importSel, setImportSel] = useState<string[]>([])
  const [modalPres, setModalPres] = useState<{ articuloId: string; articuloNombre: string } | null>(null)
  const [presEdit, setPresEdit] = useState<string | null>(null)
  const [fPres, setFPres] = useState({ nombre: '', factor: '' })

  const api = useCallback(async (payload: Record<string, unknown>) => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sesión vencida — recargá la página')
    const res = await fetch('/api/compras', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => null)
    if (!res.ok) throw new Error(d?.error ?? 'Error')
    return d
  }, [])

  // Gate del módulo + carga inicial
  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    supabase.from('empresa_config').select('modulos').eq('empresa_id', ctx.empresaId).maybeSingle()
      .then(async ({ data }) => {
        const on = ((data?.modulos ?? {}) as Record<string, boolean>).compras === true
        setModuloOn(on)
        if (!on) { setLoading(false); return }
        try {
          const d = await api({ accion: 'listar' })
          setProveedores(d.proveedores ?? []); setArticulos(d.articulos ?? [])
          setPresentaciones(d.presentaciones ?? []); setProductos(d.productos ?? [])
          setSucursales(d.sucursales ?? []); setOcs(d.ocs ?? []); setOcItems(d.oc_items ?? [])
          setRemitos(d.remitos ?? []); setRemitoItems(d.remito_items ?? [])
        } catch { /* la página muestra vacío; las acciones reintentarán */ }
        setLoading(false)
      })
  }, [ctx, api])

  async function recargar() {
    try {
      const d = await api({ accion: 'listar' })
      setProveedores(d.proveedores ?? []); setArticulos(d.articulos ?? [])
      setPresentaciones(d.presentaciones ?? []); setProductos(d.productos ?? [])
      setSucursales(d.sucursales ?? []); setOcs(d.ocs ?? []); setOcItems(d.oc_items ?? [])
      setRemitos(d.remitos ?? []); setRemitoItems(d.remito_items ?? [])
    } catch { /* siguiente acción reintenta */ }
  }

  // ── Acciones ──
  async function guardarProveedor() {
    if (!fProv.nombre.trim()) return
    setSaving(true)
    try {
      await api({ accion: 'proveedor_guardar', id: provEdit, ...fProv })
      setModalProv(false); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function toggleProveedor(p: Proveedor) {
    try { await api({ accion: 'proveedor_toggle', id: p.id, activo: !p.activo }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar') }
  }
  async function guardarArticulo() {
    if (!fArt.nombre.trim()) return
    setSaving(true)
    try {
      await api({ accion: 'articulo_guardar', id: artEdit, ...fArt, producto_id: fArt.producto_id || null })
      setModalArt(false); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function toggleArticulo(a: Articulo) {
    try { await api({ accion: 'articulo_toggle', id: a.id, activo: !a.activo }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar') }
  }
  async function crearOC() {
    setSaving(true)
    try {
      const d = await api({ accion: 'oc_crear', proveedor_id: fOC.proveedor_id, sucursal_id: fOC.sucursal_id || null,
        observaciones: fOC.observaciones, items: fOC.renglones.filter(rCompleto).map(r => ({
          articulo_id: r.articulo_id, presentacion_id: r.presentacion_id || null,
          cantidad: r.cantidad, costo_previsto: r.costo_previsto,
        })) })
      setModalOC(false); await recargar()
      alert(`Orden de compra OC-${String(d.numero).padStart(4, '0')} creada`)
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo crear') } finally { setSaving(false) }
  }
  async function anularOC(id: string) {
    if (!confirm('¿Anular esta orden de compra? No se puede volver a abrir.')) return
    try { await api({ accion: 'oc_anular', id }); setOcDetalle(null); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo anular') }
  }
  async function crearRemito() {
    setSaving(true)
    try {
      const d = await api({ accion: 'remito_crear', proveedor_id: fRem.proveedor_id, sucursal_id: fRem.sucursal_id,
        orden_compra_id: fRem.orden_compra_id || null, numero_proveedor: fRem.numero_proveedor, observaciones: fRem.observaciones })
      setModalRemito(false); await recargar()
      if (d.id) setRemitoAbierto(String(d.id))
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo crear') } finally { setSaving(false) }
  }
  async function guardarLinea() {
    if (!lineaForm || !remitoAbierto) return
    setSaving(true)
    try {
      await api({ accion: 'remito_item_guardar', remito_id: remitoAbierto, item_id: lineaForm.item_id,
        articulo_id: lineaForm.articulo_id, presentacion_id: lineaForm.presentacion_id || null,
        cantidad: lineaForm.cantidad, costo_bulto: lineaForm.costo_bulto || '0' })
      setLineaForm(null); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function borrarLinea(itemId: string) {
    if (!remitoAbierto) return
    try { await api({ accion: 'remito_item_borrar', remito_id: remitoAbierto, item_id: itemId }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo borrar') }
  }
  async function descartarRemito(id: string) {
    if (!confirm('¿Descartar este borrador? Se pierde lo cargado.')) return
    try { await api({ accion: 'remito_borrar', id }); setRemitoAbierto(null); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo descartar') }
  }
  async function importarCatalogo() {
    if (!importSel.length) return
    setSaving(true)
    try {
      const d = await api({ accion: 'importar_catalogo', producto_ids: importSel })
      setModalImport(false); setImportSel([]); await recargar()
      if (d.rechazados?.length) alert(`Importados: ${d.creados}. Ya tenían artículo (los importó otro usuario): ${d.rechazados.join(', ')}`)
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo importar') } finally { setSaving(false) }
  }
  async function guardarPresentacion() {
    if (!modalPres || !fPres.nombre.trim()) return
    setSaving(true)
    try {
      await api({ accion: 'presentacion_guardar', id: presEdit, articulo_id: modalPres.articuloId, nombre: fPres.nombre, factor: fPres.factor })
      setPresEdit(null); setFPres({ nombre: '', factor: '' }); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function borrarPresentacion(id: string) {
    try { await api({ accion: 'presentacion_borrar', id }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo borrar') }
  }
  async function togglePresentacion(pr: Presentacion) {
    try { await api({ accion: 'presentacion_toggle', id: pr.id, activo: !pr.activo }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar') }
  }

  const nombreProducto = (id: string | null) => id ? (productos.find(p => p.id === id)?.nombre ?? '—') : null
  const nombreArticulo = (id: string) => articulos.find(a => a.id === id)?.nombre ?? '—'
  const nombrePresentacion = (id: string | null) => id ? (presentaciones.find(p => p.id === id)?.nombre ?? '—') : null
  const factorPresentacion = (id: string | null) => id ? (presentaciones.find(p => p.id === id)?.factor ?? 1) : 1
  const nombreProveedor = (id: string) => proveedores.find(p => p.id === id)?.nombre ?? '—'
  const nombreSucursal = (id: string | null) => id ? (sucursales.find(s => s.id === id)?.nombre ?? '—') : '🏢 Central'
  const ESTADOS_OC: Record<string, { label: string; cls: string }> = {
    abierta: { label: 'Abierta', cls: 'bg-blue-50 text-blue-600' },
    parcial: { label: 'Parcial', cls: 'bg-amber-50 text-amber-600' },
    recibida: { label: 'Recibida', cls: 'bg-green-50 text-green-600' },
    anulada: { label: 'Anulada', cls: 'bg-neutral-100 text-neutral-400' },
  }
  const ESTADOS_REMITO: Record<string, { label: string; cls: string }> = {
    borrador: { label: 'Borrador', cls: 'bg-amber-50 text-amber-600' },
    confirmado: { label: 'Confirmado', cls: 'bg-green-50 text-green-600' },
    anulado: { label: 'Anulado', cls: 'bg-neutral-100 text-neutral-400' },
  }
  const itemsDe = (remitoId: string) => remitoItems.filter(i => i.remito_id === remitoId)
  const totalRemito = (remitoId: string) => itemsDe(remitoId).reduce((a, i) => a + Number(i.cantidad_operativa) * Number(i.costo_unitario), 0)
  // Validación VIVA del modal OC (JC 30/09): el cartel no espera al Guardar.
  // Vacío total = se ignora; a medias = incompleto (marca roja al instante).
  const rVacio = (r: RenglonForm) => !r.articulo_id && !r.presentacion_id && !r.cantidad && !r.costo_previsto
  const rCompleto = (r: RenglonForm) => !!r.articulo_id && isFinite(Number(r.cantidad)) && Number(r.cantidad) > 0
  const rIncompleto = (r: RenglonForm) => !rVacio(r) && !rCompleto(r)
  const ocLista = fOC.renglones.some(rCompleto) && !fOC.renglones.some(rIncompleto) && !!fOC.proveedor_id
  const totalPrevisto = (ocId: string) => ocItems.filter(i => i.orden_compra_id === ocId)
    .reduce((a, i) => a + (i.costo_previsto ?? 0) * Number(i.cantidad), 0)
  // Importador: SOLO productos sin artículo vinculado (regla 1 del CTO)
  const productosLibres = productos.filter(p => !articulos.some(a => a.producto_id === p.id))
  // El selector excluye productos ya vinculados a OTRO artículo (sello 1↔1)
  const productosDisponibles = productos.filter(p =>
    !articulos.some(a => a.producto_id === p.id && a.id !== artEdit))

  if (ctxLoading || loading) return (
    <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  if (moduloOn === false) return (
    <div className="max-w-lg mx-auto text-center py-20">
      <Package className="h-10 w-10 text-neutral-200 mx-auto mb-4" />
      <h2 className="font-black text-neutral-800 text-lg mb-1">Compras no disponible</h2>
      <p className="text-neutral-400 text-sm">Este módulo no está activo para tu empresa.</p>
    </div>
  )

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Compras</h1>
          <p className="text-sm text-neutral-400">Proveedores y artículos de compra</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'remitos' && (
            <ConeButton onClick={() => { setFRem({ proveedor_id: '', sucursal_id: '', orden_compra_id: '', numero_proveedor: '', observaciones: '' }); setModalRemito(true) }} icon={<Plus className="h-4 w-4" />}>
              Nuevo remito
            </ConeButton>
          )}
          {tab === 'ordenes' && (
            <ConeButton onClick={() => { setFOC({ proveedor_id: '', sucursal_id: '', observaciones: '', renglones: [{ articulo_id: '', presentacion_id: '', cantidad: '', costo_previsto: '' }] }); setModalOC(true) }} icon={<Plus className="h-4 w-4" />}>
              Nueva orden
            </ConeButton>
          )}
          {tab === 'articulos' && (
            <button onClick={() => { setImportSel([]); setModalImport(true) }}
              className="px-4 py-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-bold hover:border-neutral-400 transition-colors flex items-center gap-2">
              <Download className="h-4 w-4" /> Importar del catálogo
            </button>
          )}
          {tab !== 'ordenes' && (
            <ConeButton onClick={() => {
              if (tab === 'proveedores') { setFProv({ nombre: '', razon_social: '', cuit: '', telefono: '', email: '', direccion: '', observaciones: '' }); setProvEdit(null); setModalProv(true) }
              else { setFArt({ nombre: '', tipo: 'insumo', unidad_stock: 'unidad', controla_stock: true, producto_id: '' }); setArtEdit(null); setModalArt(true) }
            }} icon={<Plus className="h-4 w-4" />}>
              {tab === 'proveedores' ? 'Nuevo proveedor' : 'Nuevo artículo'}
            </ConeButton>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-neutral-100 rounded-xl p-1 w-fit">
        <button onClick={() => setTab('proveedores')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'proveedores' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Truck className="h-4 w-4" /> Proveedores
        </button>
        <button onClick={() => setTab('articulos')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'articulos' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Boxes className="h-4 w-4" /> Artículos
        </button>
        <button onClick={() => setTab('ordenes')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'ordenes' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Package className="h-4 w-4" /> Órdenes
        </button>
        <button onClick={() => setTab('remitos')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'remitos' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Truck className="h-4 w-4" /> Remitos
        </button>
      </div>

      {/* ── PROVEEDORES ── */}
      {tab === 'proveedores' && (
        <div className="space-y-2">
          {proveedores.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin proveedores. Cargá el primero con el botón de arriba.</div>}
          {proveedores.map(p => (
            <div key={p.id} className={`bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm ${!p.activo ? 'opacity-55 grayscale' : ''}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-900 truncate">{p.nombre}</span>
                  {p.cuit && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-600">CUIT {p.cuit}</span>}
                </div>
                <p className="text-xs text-neutral-400 mt-0.5 truncate">
                  {[p.razon_social, p.telefono, p.email, p.direccion].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => toggleProveedor(p)} title={p.activo ? 'Desactivar (baja lógica — el historial queda)' : 'Activar'}
                  className={`relative w-11 h-6 rounded-full transition-colors ${p.activo ? 'bg-green-500' : 'bg-neutral-200'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${p.activo ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <button onClick={() => { setFProv({ nombre: p.nombre, razon_social: p.razon_social ?? '', cuit: p.cuit ?? '', telefono: p.telefono ?? '', email: p.email ?? '', direccion: p.direccion ?? '', observaciones: p.observaciones ?? '' }); setProvEdit(p.id); setModalProv(true) }}
                  className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ARTÍCULOS ── */}
      {tab === 'articulos' && (
        <div className="space-y-2">
          {articulos.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin artículos. Cargá el primero con el botón de arriba.</div>}
          {articulos.map(a => {
            const pres = presentaciones.filter(pr => pr.articulo_id === a.id)
            const vinculo = nombreProducto(a.producto_id)
            return (
              <div key={a.id} className={`bg-white rounded-2xl border border-neutral-100 px-5 py-4 shadow-sm ${!a.activo ? 'opacity-55 grayscale' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-neutral-900">{a.nombre}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-600">{TIPOS.find(t => t.value === a.tipo)?.label ?? a.tipo}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-600">{a.unidad_stock}</span>
                      {!a.controla_stock && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-600">Sin control de stock</span>}
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {vinculo ? <>Ficha del producto de venta: <span className="font-semibold text-neutral-500">{vinculo}</span></> : 'Sin vínculo a producto de venta'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => toggleArticulo(a)} title={a.activo ? 'Desactivar (baja lógica — el historial queda)' : 'Activar'}
                      className={`relative w-11 h-6 rounded-full transition-colors ${a.activo ? 'bg-green-500' : 'bg-neutral-200'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${a.activo ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                    <button onClick={() => { setFArt({ nombre: a.nombre, tipo: a.tipo, unidad_stock: a.unidad_stock, controla_stock: a.controla_stock, producto_id: a.producto_id ?? '' }); setArtEdit(a.id); setModalArt(true) }}
                      className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
                  </div>
                </div>
                {/* Presentaciones de COMPRA (vocabulario de la casa: jamás "presentación" a secas) */}
                <div className="mt-3 pt-3 border-t border-neutral-50 flex items-center gap-2 flex-wrap">
                  {pres.map(pr => (
                    <button key={pr.id}
                      onClick={() => { setModalPres({ articuloId: a.id, articuloNombre: a.nombre }); setPresEdit(pr.id); setFPres({ nombre: pr.nombre, factor: String(pr.factor) }) }}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition-colors ${pr.activo ? 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-neutral-400' : 'bg-white border-neutral-100 text-neutral-300 line-through'}`}
                      title="Editar presentación de compra">
                      {pr.nombre} × {pr.factor}
                    </button>
                  ))}
                  <button onClick={() => { setModalPres({ articuloId: a.id, articuloNombre: a.nombre }); setPresEdit(null); setFPres({ nombre: '', factor: '' }) }}
                    className="text-xs px-2.5 py-1 rounded-full font-semibold border border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors">
                    + Presentación de compra
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── REMITOS (T4-A): el BORRADOR es documento editable — CERO
          stock. ingresar_remito_stock (T4-B) será el único escritor. ── */}
      {tab === 'remitos' && !remitoAbierto && (
        <div className="space-y-2">
          {remitos.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin remitos. Registrá la primera recepción con el botón de arriba.</div>}
          {remitos.map(r => {
            const est = ESTADOS_REMITO[r.estado] ?? { label: r.estado, cls: 'bg-neutral-100 text-neutral-500' }
            const tot = totalRemito(r.id)
            const oc = r.orden_compra_id ? ocs.find(o => o.id === r.orden_compra_id) : null
            return (
              <button key={r.id} onClick={() => setRemitoAbierto(r.id)}
                className={`w-full text-left bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm hover:border-neutral-300 transition-colors ${r.estado === 'anulado' ? 'opacity-55' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-neutral-900">REM-{String(r.numero).padStart(4, '0')}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${est.cls}`}>{est.label}</span>
                    {oc && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-500">OC-{String(oc.numero).padStart(4, '0')}</span>}
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5 truncate">
                    {nombreProveedor(r.proveedor_id)} · 📍 {nombreSucursal(r.sucursal_id)} · {r.fecha}{r.numero_proveedor ? ` · Nº prov. ${r.numero_proveedor}` : ''}
                  </p>
                </div>
                <span className="font-bold text-neutral-700 text-sm flex-shrink-0">{tot > 0 ? `$${tot.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '—'}</span>
              </button>
            )
          })}
        </div>
      )}

      {tab === 'remitos' && remitoAbierto && (() => {
        const r = remitos.find(x => x.id === remitoAbierto)
        if (!r) return null
        const esBorrador = r.estado === 'borrador'
        const lineas = itemsDe(r.id)
        const est = ESTADOS_REMITO[r.estado] ?? { label: r.estado, cls: '' }
        return (
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setRemitoAbierto(null)} className="text-neutral-300 hover:text-neutral-600 font-bold">←</button>
                  <h2 className="font-black text-lg text-neutral-900">REM-{String(r.numero).padStart(4, '0')}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${est.cls}`}>{est.label}</span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {nombreProveedor(r.proveedor_id)} · 📍 {nombreSucursal(r.sucursal_id)} · {r.fecha}{r.numero_proveedor ? ` · Nº prov. ${r.numero_proveedor}` : ''}
                </p>
              </div>
              {esBorrador && (
                <button onClick={() => descartarRemito(r.id)}
                  className="px-3 py-1.5 rounded-xl border border-red-200 text-red-500 text-xs font-bold hover:bg-red-50 transition-colors">Descartar borrador</button>
              )}
            </div>

            <div className="space-y-1.5">
              {lineas.length === 0 && <p className="text-sm text-neutral-400 text-center py-4">Sin líneas. Agregá lo que llegó en el camión.</p>}
              {lineas.map(li => (
                <div key={li.id} className="flex items-center justify-between bg-neutral-50 rounded-xl px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-800 truncate">{nombreArticulo(li.articulo_id)}</p>
                    <p className="text-xs text-neutral-400">
                      {Number(li.cantidad)} × {nombrePresentacion(li.presentacion_id) ?? 'unidad suelta'} = <span className="font-bold text-neutral-600">{Number(li.cantidad_operativa)} u.</span>
                      {Number(li.costo_unitario) > 0 ? ` · $${Number(li.costo_unitario).toLocaleString('es-AR', { maximumFractionDigits: 2 })}/u.` : ''}
                      {li.cantidad_pedida != null ? ` · pedido: ${Number(li.cantidad_pedida)}` : ''}
                    </p>
                  </div>
                  {esBorrador && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => setLineaForm({ item_id: li.id, articulo_id: li.articulo_id, presentacion_id: li.presentacion_id ?? '', cantidad: String(li.cantidad), costo_bulto: String(Number(li.costo_unitario) * Number(li.factor_snap)) })}
                        className="text-neutral-300 hover:text-neutral-600 p-1"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => borrarLinea(li.id)} className="text-neutral-300 hover:text-red-500 font-bold px-1.5">✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {esBorrador && !lineaForm && (
              <button onClick={() => setLineaForm({ item_id: null, articulo_id: '', presentacion_id: '', cantidad: '', costo_bulto: '' })}
                className="text-xs px-3 py-1.5 rounded-full font-semibold border border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors">
                + Agregar línea
              </button>
            )}

            {esBorrador && lineaForm && (() => {
              const presDeArt = presentaciones.filter(pr => pr.articulo_id === lineaForm.articulo_id && pr.activo)
              const f = lineaForm.presentacion_id ? Number(presentaciones.find(x => x.id === lineaForm.presentacion_id)?.factor ?? 1) : 1
              const q = Number(lineaForm.cantidad)
              const cb = Number(lineaForm.costo_bulto)
              return (
                <div className="bg-neutral-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select value={lineaForm.articulo_id}
                      onChange={e => setLineaForm({ ...lineaForm, articulo_id: e.target.value, presentacion_id: '' })}
                      className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Artículo...</option>
                      {articulos.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                    <button onClick={() => setLineaForm(null)} className="text-neutral-300 hover:text-neutral-500 font-bold px-2">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select value={lineaForm.presentacion_id}
                      onChange={e => setLineaForm({ ...lineaForm, presentacion_id: e.target.value })}
                      className="px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Unidad suelta</option>
                      {presDeArt.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre} ×{pr.factor}</option>)}
                    </select>
                    <Input value={lineaForm.cantidad} placeholder="Bultos"
                      onChange={e => setLineaForm({ ...lineaForm, cantidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} inputMode="decimal" />
                    <Input value={lineaForm.costo_bulto} placeholder="$ por bulto"
                      onChange={e => setLineaForm({ ...lineaForm, costo_bulto: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} inputMode="decimal" />
                  </div>
                  {lineaForm.articulo_id && q > 0 && (
                    <p className="text-[11px] text-neutral-400">
                      = <span className="font-bold">{q * f} unidades</span>{isFinite(cb) && cb > 0 ? ` · $${(cb / f).toLocaleString('es-AR', { maximumFractionDigits: 2 })} por unidad` : ''} — el factor se congela recién al confirmar
                    </p>
                  )}
                  <div className="flex justify-end">
                    <ConeButton onClick={guardarLinea} loading={saving} disabled={!lineaForm.articulo_id || !(q > 0)}>
                      {lineaForm.item_id ? 'Guardar línea' : 'Agregar'}
                    </ConeButton>
                  </div>
                </div>
              )
            })()}

            {totalRemito(r.id) > 0 && (
              <div className="flex justify-between font-black text-neutral-900 px-1">
                <span>Total</span><span>${totalRemito(r.id).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
            )}
            {esBorrador && (
              <p className="text-[11px] text-neutral-400 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                📋 Borrador: todavía no movió stock. La confirmación de la recepción llega en la próxima tanda (T4-B) — un solo acto, todo o nada.
              </p>
            )}
          </div>
        )
      })()}

      {/* ── Modal nuevo remito ── */}
      <ConeModal open={modalRemito} onClose={() => setModalRemito(false)} title="Nuevo remito de recepción"
        footer={<><ConeButton variant="outline" onClick={() => setModalRemito(false)}>Cancelar</ConeButton>
          <ConeButton onClick={crearRemito} loading={saving} disabled={!fRem.proveedor_id || !fRem.sucursal_id}>Crear borrador</ConeButton></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Proveedor *</Label>
              <select value={fRem.proveedor_id} onChange={e => setFRem({ ...fRem, proveedor_id: e.target.value, orden_compra_id: '' })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">Elegí...</option>
                {proveedores.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Sucursal que recibe *</Label>
              <select value={fRem.sucursal_id} onChange={e => setFRem({ ...fRem, sucursal_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">Elegí...</option>
                {sucursales.map(su => <option key={su.id} value={su.id}>{su.nombre}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Contra orden de compra (opcional)</Label>
            <select value={fRem.orden_compra_id} onChange={e => setFRem({ ...fRem, orden_compra_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
              <option value="">Sin OC — recepción directa</option>
              {ocs.filter(o => o.proveedor_id === fRem.proveedor_id && (o.estado === 'abierta' || o.estado === 'parcial')).map(o =>
                <option key={o.id} value={o.id}>OC-{String(o.numero).padStart(4, '0')} · {o.fecha}</option>)}
            </select>
            <p className="text-[11px] text-neutral-400">Con OC: se precargan las líneas pendientes (editables — cargá lo que REALMENTE llegó).</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Nº remito del proveedor</Label><Input value={fRem.numero_proveedor} onChange={e => setFRem({ ...fRem, numero_proveedor: e.target.value })} placeholder="0001-00012345" /></div>
            <div className="space-y-1.5"><Label>Observaciones</Label><Input value={fRem.observaciones} onChange={e => setFRem({ ...fRem, observaciones: e.target.value })} placeholder="Llegó sin frío..." /></div>
          </div>
        </div>
      </ConeModal>

      {/* ── ÓRDENES DE COMPRA (T3): la OC NO mueve stock — expresa
          "quiero comprar esto"; el movimiento nace en T4 con el remito ── */}
      {tab === 'ordenes' && (
        <div className="space-y-2">
          {ocs.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin órdenes de compra. Creá la primera con el botón de arriba.</div>}
          {ocs.map(oc => {
            const est = ESTADOS_OC[oc.estado] ?? { label: oc.estado, cls: 'bg-neutral-100 text-neutral-500' }
            const tot = totalPrevisto(oc.id)
            return (
              <button key={oc.id} onClick={() => setOcDetalle(oc)}
                className={`w-full text-left bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm hover:border-neutral-300 transition-colors ${oc.estado === 'anulada' ? 'opacity-55' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-neutral-900">OC-{String(oc.numero).padStart(4, '0')}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${est.cls}`}>{est.label}</span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5 truncate">
                    {nombreProveedor(oc.proveedor_id)} · {nombreSucursal(oc.sucursal_id)} · {oc.fecha}
                  </p>
                </div>
                <span className="font-bold text-neutral-700 text-sm flex-shrink-0">{tot > 0 ? `$${tot.toLocaleString('es-AR')}` : '—'}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Modal nueva OC ── */}
      <ConeModal open={modalOC} onClose={() => setModalOC(false)} title="Nueva orden de compra"
        footer={<><ConeButton variant="outline" onClick={() => setModalOC(false)}>Cancelar</ConeButton>
          <ConeButton onClick={crearOC} loading={saving} disabled={!ocLista}>Crear orden</ConeButton></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Proveedor *</Label>
              <select value={fOC.proveedor_id} onChange={e => setFOC({ ...fOC, proveedor_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">Elegí...</option>
                {proveedores.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Destino *</Label>
              <select value={fOC.sucursal_id} onChange={e => setFOC({ ...fOC, sucursal_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">🏢 Central (todas)</option>
                {sucursales.map(su => <option key={su.id} value={su.id}>{su.nombre}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Renglones — en presentaciones de COMPRA</Label>
            {fOC.renglones.map((r, i) => {
              const presDeArt = presentaciones.filter(pr => pr.articulo_id === r.articulo_id && pr.activo)
              const f = factorPresentacion(r.presentacion_id || null)
              const q = Number(r.cantidad)
              return (
                <div key={i} className="bg-neutral-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select value={r.articulo_id}
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, articulo_id: e.target.value, presentacion_id: '' } : x) })}
                      className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Artículo...</option>
                      {articulos.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                    <button onClick={() => setFOC({ ...fOC, renglones: fOC.renglones.filter((_, j) => j !== i) })}
                      className="text-neutral-300 hover:text-red-500 font-bold px-2">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select value={r.presentacion_id}
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, presentacion_id: e.target.value } : x) })}
                      className="px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Unidad suelta</option>
                      {presDeArt.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre} ×{pr.factor}</option>)}
                    </select>
                    <Input value={r.cantidad} placeholder="Cant."
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') } : x) })} inputMode="decimal" />
                    <Input value={r.costo_previsto} placeholder="$ c/u previsto"
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, costo_previsto: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') } : x) })} inputMode="decimal" />
                  </div>
                  {r.articulo_id && q > 0 && (
                    <p className="text-[11px] text-neutral-400">
                      = {q * f} {r.presentacion_id ? 'unidades operativas' : 'unidades'}{r.costo_previsto ? ` · previsto $${(q * Number(r.costo_previsto)).toLocaleString('es-AR')}` : ''}
                    </p>
                  )}
                  {rIncompleto(r) && (
                    <p className="text-[11px] font-semibold text-red-500">
                      {!r.articulo_id ? 'Elegí el artículo' : 'Poné la cantidad (mayor a 0)'} — o dejá el renglón vacío y se ignora
                    </p>
                  )}
                </div>
              )
            })}
            <button onClick={() => setFOC({ ...fOC, renglones: [...fOC.renglones, { articulo_id: '', presentacion_id: '', cantidad: '', costo_previsto: '' }] })}
              className="text-xs px-3 py-1.5 rounded-full font-semibold border border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors">
              + Agregar renglón
            </button>
          </div>
          <div className="space-y-1.5"><Label>Observaciones</Label><Input value={fOC.observaciones} onChange={e => setFOC({ ...fOC, observaciones: e.target.value })} placeholder="Entregar por la mañana..." /></div>
        </div>
      </ConeModal>

      {/* ── Modal detalle OC ── */}
      <ConeModal open={!!ocDetalle} onClose={() => setOcDetalle(null)}
        title={ocDetalle ? `OC-${String(ocDetalle.numero).padStart(4, '0')} · ${ESTADOS_OC[ocDetalle.estado]?.label ?? ocDetalle.estado}` : ''}
        footer={<>
          {ocDetalle?.estado === 'abierta' && (
            <button onClick={() => anularOC(ocDetalle.id)}
              className="px-4 py-2 rounded-xl border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 transition-colors">Anular</button>
          )}
          <ConeButton variant="outline" onClick={() => setOcDetalle(null)}>Cerrar</ConeButton>
        </>}>
        {ocDetalle && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">
              <span className="font-bold text-neutral-800">{nombreProveedor(ocDetalle.proveedor_id)}</span> · {nombreSucursal(ocDetalle.sucursal_id)} · {ocDetalle.fecha}
            </p>
            <div className="space-y-1.5">
              {ocItems.filter(i => i.orden_compra_id === ocDetalle.id).map(i => (
                <div key={i.id} className="flex items-center justify-between bg-neutral-50 rounded-xl px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-800 truncate">{nombreArticulo(i.articulo_id)}</p>
                    <p className="text-xs text-neutral-400">
                      {Number(i.cantidad)} × {nombrePresentacion(i.presentacion_id) ?? 'unidad suelta'}
                      {i.presentacion_id ? ` = ${Number(i.cantidad) * factorPresentacion(i.presentacion_id)} u.` : ''}
                    </p>
                  </div>
                  <span className="font-bold text-neutral-700 flex-shrink-0">{i.costo_previsto != null ? `$${(Number(i.cantidad) * Number(i.costo_previsto)).toLocaleString('es-AR')}` : '—'}</span>
                </div>
              ))}
            </div>
            {totalPrevisto(ocDetalle.id) > 0 && (
              <div className="flex justify-between font-black text-neutral-900 px-1">
                <span>Total previsto</span><span>${totalPrevisto(ocDetalle.id).toLocaleString('es-AR')}</span>
              </div>
            )}
            {ocDetalle.observaciones && <p className="text-xs text-neutral-400">📝 {ocDetalle.observaciones}</p>}
            <p className="text-[11px] text-neutral-400">La orden no mueve stock — el ingreso real nace con el remito (próximamente).</p>
          </div>
        )}
      </ConeModal>

      {/* ── Modal proveedor ── */}
      <ConeModal open={modalProv} onClose={() => setModalProv(false)} title={provEdit ? 'Editar proveedor' : 'Nuevo proveedor'}
        footer={<><ConeButton variant="outline" onClick={() => setModalProv(false)}>Cancelar</ConeButton><ConeButton onClick={guardarProveedor} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre de fantasía *</Label><Input value={fProv.nombre} onChange={e => setFProv({ ...fProv, nombre: e.target.value })} placeholder="Almacén Sur" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Razón social</Label>
            <Input value={fProv.razon_social} onChange={e => setFProv({ ...fProv, razon_social: e.target.value })} placeholder="Distribuidora Sur S.R.L." />
            <p className="text-[11px] text-neutral-400">La de los comprobantes. Vacía = se usa el nombre de fantasía.</p>
          </div>
          <div className="space-y-1.5"><Label>CUIT</Label><Input value={fProv.cuit} onChange={e => setFProv({ ...fProv, cuit: e.target.value.replace(/[^\d-]/g, '') })} placeholder="30-11122233-3" inputMode="numeric" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Teléfono</Label><Input value={fProv.telefono} onChange={e => setFProv({ ...fProv, telefono: e.target.value })} placeholder="2302..." /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input value={fProv.email} onChange={e => setFProv({ ...fProv, email: e.target.value })} placeholder="ventas@..." /></div>
          </div>
          <div className="space-y-1.5"><Label>Dirección</Label><Input value={fProv.direccion} onChange={e => setFProv({ ...fProv, direccion: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Observaciones</Label><Input value={fProv.observaciones} onChange={e => setFProv({ ...fProv, observaciones: e.target.value })} placeholder="Entrega los martes..." /></div>
        </div>
      </ConeModal>

      {/* ── Modal artículo ── */}
      <ConeModal open={modalArt} onClose={() => setModalArt(false)} title={artEdit ? 'Editar artículo' : 'Nuevo artículo'}
        footer={<><ConeButton variant="outline" onClick={() => setModalArt(false)}>Cancelar</ConeButton><ConeButton onClick={guardarArticulo} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={fArt.nombre} onChange={e => setFArt({ ...fArt, nombre: e.target.value })} placeholder="Dulce de leche x balde" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <select value={fArt.tipo} onChange={e => setFArt({ ...fArt, tipo: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Unidad de stock *</Label>
              <select value={fArt.unidad_stock} onChange={e => setFArt({ ...fArt, unidad_stock: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between py-1">
            <div>
              <Label>Controla stock</Label>
              <p className="text-[11px] text-neutral-400">Apagado: el artículo existe en remitos y facturas pero no lleva stock.</p>
            </div>
            <button type="button" onClick={() => setFArt({ ...fArt, controla_stock: !fArt.controla_stock })}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${fArt.controla_stock ? 'bg-green-500' : 'bg-neutral-200'}`}>
              <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${fArt.controla_stock ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <div className="space-y-1.5">
            <Label>Es reventa de un producto del catálogo</Label>
            <select value={fArt.producto_id} onChange={e => setFArt({ ...fArt, producto_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
              <option value="">Sin vínculo (insumo/material)</option>
              {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <p className="text-[11px] text-neutral-400">Solo si comprás EXACTAMENTE lo que vendés (la recepción suma en su stock de venta; un producto = un solo artículo). Los ingredientes de un producto elaborado van SIN vínculo — recetas: próximamente.</p>
          </div>
        </div>
      </ConeModal>

      {/* ── Modal importador de catálogo (herramienta de CARGA, GO CTO) ── */}
      <ConeModal open={modalImport} onClose={() => setModalImport(false)} title="Importar del catálogo"
        footer={<><ConeButton variant="outline" onClick={() => setModalImport(false)}>Cancelar</ConeButton>
          <ConeButton onClick={importarCatalogo} loading={saving} disabled={!importSel.length}>Importar {importSel.length > 0 ? `(${importSel.length})` : ''}</ConeButton></>}>
        <p className="text-xs text-neutral-400 mb-3">Crea artículos de REVENTA vinculados 1 a 1 (Mercadería · unidad · controla stock). Solo se ofrecen productos que aún no tienen artículo. No toca precios ni stock de venta; las presentaciones de compra se cargan después donde hagan falta.</p>
        {productosLibres.length === 0
          ? <div className="text-center py-8 text-neutral-400 text-sm">Todos los productos del catálogo ya tienen su artículo.</div>
          : <div className="space-y-1 max-h-80 overflow-y-auto">
              {productosLibres.map(p => (
                <label key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 cursor-pointer border border-transparent has-[:checked]:border-neutral-300 has-[:checked]:bg-neutral-50">
                  <input type="checkbox" className="h-4 w-4 rounded" checked={importSel.includes(p.id)}
                    onChange={e => setImportSel(sel => e.target.checked ? [...sel, p.id] : sel.filter(x => x !== p.id))} />
                  <span className="text-sm font-semibold text-neutral-700">{p.nombre}</span>
                </label>
              ))}
            </div>}
      </ConeModal>

      {/* ── Modal presentación de compra ── */}
      <ConeModal open={!!modalPres} onClose={() => { setModalPres(null); setPresEdit(null) }}
        title={presEdit ? `Editar presentación · ${modalPres?.articuloNombre ?? ''}` : `Nueva presentación de compra · ${modalPres?.articuloNombre ?? ''}`}
        footer={<>
          {presEdit && (() => { const pr = presentaciones.find(x => x.id === presEdit); return pr ? (<>
            <button onClick={async () => { await borrarPresentacion(pr.id); setModalPres(null); setPresEdit(null) }}
              className="px-4 py-2 rounded-xl border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 transition-colors">
              Borrar
            </button>
            <ConeButton variant="outline" onClick={() => { togglePresentacion(pr); setModalPres(null); setPresEdit(null) }}>{pr.activo ? 'Desactivar' : 'Activar'}</ConeButton>
          </>) : null })()}
          <ConeButton variant="outline" onClick={() => { setModalPres(null); setPresEdit(null) }}>Cancelar</ConeButton>
          <ConeButton onClick={async () => { await guardarPresentacion(); setModalPres(null) }} loading={saving}>Guardar</ConeButton>
        </>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={fPres.nombre} onChange={e => setFPres({ ...fPres, nombre: e.target.value })} placeholder="Caja x24 · Bolsa 25kg · Bidón 20L" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Factor * (unidades por bulto)</Label>
            <Input value={fPres.factor} onChange={e => setFPres({ ...fPres, factor: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} placeholder="24" inputMode="decimal" />
            <p className="text-[11px] text-neutral-400">Ej.: Caja ×24 → recibir 3 cajas suma 72 al stock. Debe ser mayor a 0.</p>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
