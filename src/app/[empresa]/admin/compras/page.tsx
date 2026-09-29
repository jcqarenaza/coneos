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
import { Plus, Loader2, Pencil, Package, Truck, Boxes } from 'lucide-react'

interface Proveedor { id: string; nombre: string; cuit: string | null; telefono: string | null; email: string | null; direccion: string | null; observaciones: string | null; activo: boolean }
interface Articulo { id: string; nombre: string; tipo: string; unidad_stock: string; producto_id: string | null; controla_stock: boolean; activo: boolean }
interface Presentacion { id: string; articulo_id: string; nombre: string; factor: number; activo: boolean }
interface ProductoVenta { id: string; nombre: string }

const TIPOS = [
  { value: 'mercaderia', label: 'Mercadería' },
  { value: 'insumo', label: 'Insumo' },
  { value: 'material', label: 'Material' },
]
const UNIDADES = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro']

export default function ComprasPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [moduloOn, setModuloOn] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'proveedores' | 'articulos'>('proveedores')
  const [loading, setLoading] = useState(true)
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [productos, setProductos] = useState<ProductoVenta[]>([])
  const [saving, setSaving] = useState(false)

  // Modales
  const [modalProv, setModalProv] = useState(false)
  const [provEdit, setProvEdit] = useState<string | null>(null)
  const [fProv, setFProv] = useState({ nombre: '', cuit: '', telefono: '', email: '', direccion: '', observaciones: '' })
  const [modalArt, setModalArt] = useState(false)
  const [artEdit, setArtEdit] = useState<string | null>(null)
  const [fArt, setFArt] = useState({ nombre: '', tipo: 'insumo', unidad_stock: 'unidad', controla_stock: true, producto_id: '' })
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
        } catch { /* la página muestra vacío; las acciones reintentarán */ }
        setLoading(false)
      })
  }, [ctx, api])

  async function recargar() {
    try {
      const d = await api({ accion: 'listar' })
      setProveedores(d.proveedores ?? []); setArticulos(d.articulos ?? [])
      setPresentaciones(d.presentaciones ?? []); setProductos(d.productos ?? [])
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
  async function guardarPresentacion() {
    if (!modalPres || !fPres.nombre.trim()) return
    setSaving(true)
    try {
      await api({ accion: 'presentacion_guardar', id: presEdit, articulo_id: modalPres.articuloId, nombre: fPres.nombre, factor: fPres.factor })
      setPresEdit(null); setFPres({ nombre: '', factor: '' }); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function togglePresentacion(pr: Presentacion) {
    try { await api({ accion: 'presentacion_toggle', id: pr.id, activo: !pr.activo }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar') }
  }

  const nombreProducto = (id: string | null) => id ? (productos.find(p => p.id === id)?.nombre ?? '—') : null
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
        <ConeButton onClick={() => {
          if (tab === 'proveedores') { setFProv({ nombre: '', cuit: '', telefono: '', email: '', direccion: '', observaciones: '' }); setProvEdit(null); setModalProv(true) }
          else { setFArt({ nombre: '', tipo: 'insumo', unidad_stock: 'unidad', controla_stock: true, producto_id: '' }); setArtEdit(null); setModalArt(true) }
        }} icon={<Plus className="h-4 w-4" />}>
          {tab === 'proveedores' ? 'Nuevo proveedor' : 'Nuevo artículo'}
        </ConeButton>
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
                  {[p.telefono, p.email, p.direccion].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => toggleProveedor(p)} title={p.activo ? 'Desactivar (baja lógica — el historial queda)' : 'Activar'}
                  className={`relative w-11 h-6 rounded-full transition-colors ${p.activo ? 'bg-green-500' : 'bg-neutral-200'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${p.activo ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <button onClick={() => { setFProv({ nombre: p.nombre, cuit: p.cuit ?? '', telefono: p.telefono ?? '', email: p.email ?? '', direccion: p.direccion ?? '', observaciones: p.observaciones ?? '' }); setProvEdit(p.id); setModalProv(true) }}
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

      {/* ── Modal proveedor ── */}
      <ConeModal open={modalProv} onClose={() => setModalProv(false)} title={provEdit ? 'Editar proveedor' : 'Nuevo proveedor'}
        footer={<><ConeButton variant="outline" onClick={() => setModalProv(false)}>Cancelar</ConeButton><ConeButton onClick={guardarProveedor} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={fProv.nombre} onChange={e => setFProv({ ...fProv, nombre: e.target.value })} placeholder="Almacén Sur" autoFocus /></div>
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
            <Label>Producto de venta vinculado</Label>
            <select value={fArt.producto_id} onChange={e => setFArt({ ...fArt, producto_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
              <option value="">Sin vínculo (insumo/material)</option>
              {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <p className="text-[11px] text-neutral-400">Al recibir este artículo, el stock suma en el producto de venta. Un producto solo puede ser la ficha de UN artículo.</p>
          </div>
        </div>
      </ConeModal>

      {/* ── Modal presentación de compra ── */}
      <ConeModal open={!!modalPres} onClose={() => { setModalPres(null); setPresEdit(null) }}
        title={presEdit ? `Editar presentación · ${modalPres?.articuloNombre ?? ''}` : `Nueva presentación de compra · ${modalPres?.articuloNombre ?? ''}`}
        footer={<>
          {presEdit && (() => { const pr = presentaciones.find(x => x.id === presEdit); return pr ? (
            <ConeButton variant="outline" onClick={() => { togglePresentacion(pr); setModalPres(null); setPresEdit(null) }}>{pr.activo ? 'Desactivar' : 'Activar'}</ConeButton>
          ) : null })()}
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
