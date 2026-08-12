'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2, Pencil, Trash2, Upload, X, ImageIcon, ChevronDown, ChevronRight } from 'lucide-react'
import Image from 'next/image'

interface Categoria { id: string; nombre: string; orden: number; activo: boolean; icono_url: string | null }
interface Producto { id: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria_id: string; codigo: string | null; orden: number; activo: boolean; visible_kiosk: boolean }
interface Presentacion { id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; orden: number; activo: boolean; producto_id: string; imagen_url: string | null; visible_kiosk: boolean }
interface GrupoOpciones { id: string; nombre: string; orden: number; activo: boolean }
interface Opcion { id: string; nombre: string; descripcion: string | null; emoji: string | null; imagen_url: string | null; grupo_id: string; orden: number; activo: boolean; visible_kiosk: boolean }
interface PresGrupo { presentacion_id: string; grupo_id: string }

function ImageUpload({ value, onChange, folder = 'productos' }: {
  value: string | null; onChange: (url: string | null) => void; folder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(file: File) {
    setUploading(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop()
    const path = `${folder}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('productos').getPublicUrl(path)
      onChange(data.publicUrl)
    }
    setUploading(false)
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative w-full h-32 rounded-xl overflow-hidden border border-neutral-200 bg-neutral-50 group">
          <Image src={value} alt="Preview" fill className="object-cover" />
          <button onClick={() => onChange(null)} className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full h-28 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-300 transition-colors flex flex-col items-center justify-center gap-2 text-neutral-400 disabled:opacity-50">
          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-5 w-5" />}
          <span className="text-sm font-medium">{uploading ? 'Subiendo...' : 'Subir imagen'}</span>
          <span className="text-xs text-neutral-300">JPG, PNG, WEBP</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
    </div>
  )
}

export default function CatalogoPage() {
  const { ctx } = useEmpresa()
  const [loading, setLoading] = useState(true)

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [grupos, setGrupos] = useState<GrupoOpciones[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [presGrupos, setPresGrupos] = useState<PresGrupo[]>([])

  // Tabs
  const [vistaActiva, setVistaActiva] = useState<'catalogo' | 'sabores' | 'disponibilidad'>('catalogo')
  const [sucursales, setSucursales] = useState<{id: string; nombre: string}[]>([])
  const [sucursalDispo, setSucursalDispo] = useState<string>('')
  const [disponibilidad, setDisponibilidad] = useState<Record<string, boolean>>({})
  const [loadingDispo, setLoadingDispo] = useState(false)
  const [savingDispo, setSavingDispo] = useState<string | null>(null)
  const [saboresCatExpandidas, setSaboresCatExpandidas] = useState<Set<string>>(new Set())
  const [busquedaSabor, setBusquedaSabor] = useState('')
  function toggleSaboresCat(id: string) { setSaboresCatExpandidas(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }

  // Expandidos
  const [catExpandidas, setCatExpandidas] = useState<Set<string>>(new Set())
  const [prodExpandidos, setProdExpandidos] = useState<Set<string>>(new Set())

  // Modales
  const [modalCat, setModalCat] = useState(false)
  const [modalProd, setModalProd] = useState(false)
  const [modalPres, setModalPres] = useState(false)
  const [modalGrupo, setModalGrupo] = useState(false)
  const [modalOp, setModalOp] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Context para modal presentación/sabor
  const [contextCatId, setContextCatId] = useState<string | null>(null)
  const [contextProdId, setContextProdId] = useState<string | null>(null)

  const [formCat, setFormCat] = useState({ nombre: '', orden: 1, activo: true, icono_url: null as string | null })
  const [formProd, setFormProd] = useState({ nombre: '', descripcion: '', imagen_url: null as string | null, categoria_id: '', codigo: '', orden: 1, activo: true, visible_kiosk: true })
  const [formPres, setFormPres] = useState({ nombre: '', precio: 0, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1, activo: true, producto_id: '', imagen_url: null as string | null, visible_kiosk: true })
  const [gruposSeleccionados, setGruposSeleccionados] = useState<string[]>([])
  const [formGrupo, setFormGrupo] = useState({ nombre: '', orden: 1, activo: true })
  const [formOp, setFormOp] = useState({ nombre: '', descripcion: '', emoji: '', imagen_url: null as string | null, grupo_id: '', orden: 1, activo: true, visible_kiosk: true })

  async function load(mantenerEstado = false) {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: cats }, { data: prods }, { data: pres }, { data: grps }, { data: ops }, { data: pg }] = await Promise.all([
      supabase.from('categorias').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('productos').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('presentaciones').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('grupos_opciones').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('opciones').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('presentacion_grupos').select('presentacion_id, grupo_id'),
    ])
    setCategorias((cats ?? []) as Categoria[])
    setProductos((prods ?? []) as Producto[])
    setPresentaciones((pres ?? []) as Presentacion[])
    setGrupos((grps ?? []) as GrupoOpciones[])
    setOpciones((ops ?? []) as Opcion[])
    setPresGrupos((pg ?? []) as PresGrupo[])
    // Solo resetear expandidos en la carga inicial
    if (!mantenerEstado) setCatExpandidas(new Set())
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  useEffect(() => {
    if (!ctx) return
    createClient().from('sucursales').select('id, nombre').eq('empresa_id', ctx.empresaId).eq('activo', true).order('nombre')
      .then(({ data }) => {
        const suc = (data ?? []) as {id: string; nombre: string}[]
        setSucursales(suc)
        if (suc.length > 0 && !sucursalDispo) setSucursalDispo(suc[0].id)
      })
  }, [ctx])

  async function cargarDisponibilidad(sucId?: string) {
    if (!ctx) return
    const sid = sucId ?? sucursalDispo
    if (!sid) return
    setLoadingDispo(true)
    const { data } = await createClient()
      .from('sucursal_catalogo_config')
      .select('entidad_id, disponible')
      .eq('empresa_id', ctx.empresaId)
      .eq('sucursal_id', sid)
    const map: Record<string, boolean> = {}
    ;(data ?? []).forEach((r: {entidad_id: string; disponible: boolean}) => { map[r.entidad_id] = r.disponible })
    setDisponibilidad(map)
    setLoadingDispo(false)
  }

  async function toggleDisponibilidad(entidadId: string, entidadTipo: string, actual: boolean) {
    if (!ctx || !sucursalDispo) return
    setSavingDispo(entidadId)
    const supabase = createClient()
    const nuevo = !actual
    await supabase.from('sucursal_catalogo_config').upsert({
      empresa_id: ctx.empresaId,
      sucursal_id: sucursalDispo,
      entidad_tipo: entidadTipo,
      entidad_id: entidadId,
      disponible: nuevo,
    }, { onConflict: 'sucursal_id,entidad_id' })
    setDisponibilidad(prev => ({ ...prev, [entidadId]: nuevo }))
    setSavingDispo(null)
  }

  function isDisponible(id: string): boolean {
    return disponibilidad[id] !== false // undefined = disponible por defecto
  }

  function toggleCat(id: string) { setCatExpandidas(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleProd(id: string) { setProdExpandidos(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }

  // Helpers para obtener grupos de sabores de una categoría (via presentaciones)
  function getGruposDeCat(catId: string): GrupoOpciones[] {
    const prods = productos.filter(p => p.categoria_id === catId)
    const presIds = presentaciones.filter(p => prods.some(pr => pr.id === p.producto_id)).map(p => p.id)
    const grupoIds = new Set(presGrupos.filter(pg => presIds.includes(pg.presentacion_id)).map(pg => pg.grupo_id))
    return grupos.filter(g => grupoIds.has(g.id))
  }

  function getSaboresDeCat(catId: string): Opcion[] {
    const grupoIds = new Set(getGruposDeCat(catId).map(g => g.id))
    return opciones.filter(o => grupoIds.has(o.grupo_id))
  }

  function getGruposDeProd(prodId: string): GrupoOpciones[] {
    const presIds = presentaciones.filter(p => p.producto_id === prodId).map(p => p.id)
    const grupoIds = new Set(presGrupos.filter(pg => presIds.includes(pg.presentacion_id)).map(pg => pg.grupo_id))
    return grupos.filter(g => grupoIds.has(g.id))
  }

  function getSaboresDeProd(prodId: string): Opcion[] {
    const grupoIds = new Set(getGruposDeProd(prodId).map(g => g.id))
    return opciones.filter(o => grupoIds.has(o.grupo_id))
  }

  // Categorías
  function openNewCat() { setFormCat({ nombre: '', orden: categorias.length + 1, activo: true, icono_url: null }); setEditId(null); setModalCat(true) }
  function openEditCat(c: Categoria) { setFormCat({ nombre: c.nombre, orden: c.orden, activo: c.activo, icono_url: c.icono_url }); setEditId(c.id); setModalCat(true) }
  async function saveCat() {
    if (!ctx || !formCat.nombre) return
    setSaving(true)
    const supabase = createClient()
    if (editId) await supabase.from('categorias').update({ nombre: formCat.nombre, orden: formCat.orden, activo: formCat.activo, icono_url: formCat.icono_url }).eq('id', editId)
    else await supabase.from('categorias').insert({ nombre: formCat.nombre, orden: formCat.orden, activo: formCat.activo, icono_url: formCat.icono_url, empresa_id: ctx.empresaId })
    setSaving(false); setModalCat(false); load(true)
  }
  async function deleteCat(id: string) {
    if (!confirm('¿Eliminar categoría?')) return
    await createClient().from('categorias').delete().eq('id', id)
    load(true)
  }

  // Productos
  function openNewProd(catId: string) { setFormProd({ nombre: '', descripcion: '', imagen_url: null, categoria_id: catId, codigo: '', orden: productos.filter(p => p.categoria_id === catId).length + 1, activo: true, visible_kiosk: true }); setEditId(null); setModalProd(true) }
  function openEditProd(p: Producto) { setFormProd({ nombre: p.nombre, descripcion: p.descripcion ?? '', imagen_url: p.imagen_url, categoria_id: p.categoria_id, codigo: p.codigo ?? '', orden: p.orden, activo: p.activo, visible_kiosk: p.visible_kiosk }); setEditId(p.id); setModalProd(true) }
  async function saveProd() {
    if (!ctx || !formProd.nombre) return
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: formProd.nombre, descripcion: formProd.descripcion || null, imagen_url: formProd.imagen_url, categoria_id: formProd.categoria_id, codigo: formProd.codigo || null, orden: formProd.orden, activo: formProd.activo, visible_kiosk: formProd.visible_kiosk }
    if (editId) await supabase.from('productos').update(payload).eq('id', editId)
    else await supabase.from('productos').insert({ ...payload, empresa_id: ctx.empresaId })
    setSaving(false); setModalProd(false); load(true)
  }
  async function deleteProd(id: string) {
    if (!confirm('¿Eliminar producto?')) return
    await createClient().from('productos').delete().eq('id', id)
    load(true)
  }

  // Presentaciones
  function openNewPres(prodId: string) { setFormPres({ nombre: '', precio: 0, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1, activo: true, producto_id: prodId, imagen_url: null, visible_kiosk: true }); setGruposSeleccionados([]); setEditId(null); setModalPres(true) }
  function openEditPres(p: Presentacion) { setFormPres({ nombre: p.nombre, precio: p.precio, permite_opciones: p.permite_opciones, opciones_min: p.opciones_min, opciones_max: p.opciones_max, orden: p.orden, activo: p.activo, producto_id: p.producto_id, imagen_url: p.imagen_url, visible_kiosk: p.visible_kiosk }); setGruposSeleccionados(presGrupos.filter(pg => pg.presentacion_id === p.id).map(pg => pg.grupo_id)); setEditId(p.id); setModalPres(true) }
  async function savePres() {
    if (!ctx || !formPres.nombre || !formPres.producto_id) return
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: formPres.nombre, precio: formPres.precio, permite_opciones: formPres.permite_opciones, opciones_min: formPres.opciones_min, opciones_max: formPres.opciones_max, orden: formPres.orden, activo: formPres.activo, producto_id: formPres.producto_id, imagen_url: formPres.imagen_url, visible_kiosk: formPres.visible_kiosk }
    if (editId) await supabase.from('presentaciones').update(payload).eq('id', editId)
    else await supabase.from('presentaciones').insert({ ...payload, empresa_id: ctx.empresaId })
    setSaving(false); setModalPres(false); load(true)
  }
  async function deletePres(id: string) {
    if (!confirm('¿Eliminar presentación?')) return
    await createClient().from('presentaciones').delete().eq('id', id)
    load(true)
  }

  // Grupos
  function openNewGrupo(catId?: string, prodId?: string) { setContextCatId(catId ?? null); setContextProdId(prodId ?? null); setFormGrupo({ nombre: '', orden: grupos.length + 1, activo: true }); setEditId(null); setModalGrupo(true) }
  function openEditGrupo(g: GrupoOpciones) { setFormGrupo({ nombre: g.nombre, orden: g.orden, activo: g.activo }); setEditId(g.id); setModalGrupo(true) }
  async function saveGrupo() {
    if (!ctx || !formGrupo.nombre) return
    setSaving(true)
    const supabase = createClient()
    if (editId) await supabase.from('grupos_opciones').update(formGrupo).eq('id', editId)
    else await supabase.from('grupos_opciones').insert({ ...formGrupo, empresa_id: ctx.empresaId })
    setSaving(false); setModalGrupo(false); load(true)
  }

  // Sabores
  function openNewOp(grupoId?: string) { setFormOp({ nombre: '', descripcion: '', emoji: '', imagen_url: null, grupo_id: grupoId ?? grupos[0]?.id ?? '', orden: 1, activo: true, visible_kiosk: true }); setEditId(null); setModalOp(true) }
  function openEditOp(o: Opcion) { setFormOp({ nombre: o.nombre, descripcion: o.descripcion ?? '', emoji: o.emoji ?? '', imagen_url: o.imagen_url, grupo_id: o.grupo_id, orden: o.orden, activo: o.activo, visible_kiosk: o.visible_kiosk }); setEditId(o.id); setModalOp(true) }
  async function saveOp() {
    if (!ctx || !formOp.nombre || !formOp.grupo_id) return
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: formOp.nombre, descripcion: formOp.descripcion || null, emoji: formOp.emoji || null, imagen_url: formOp.imagen_url, grupo_id: formOp.grupo_id, orden: formOp.orden, activo: formOp.activo, visible_kiosk: formOp.visible_kiosk }
    if (editId) await supabase.from('opciones').update(payload).eq('id', editId)
    else await supabase.from('opciones').insert({ ...payload, empresa_id: ctx.empresaId })
    setSaving(false); setModalOp(false); load(true)
  }
  async function deleteOp(id: string) {
    if (!confirm('¿Eliminar sabor?')) return
    await createClient().from('opciones').delete().eq('id', id)
    load(true)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div>
      <ConePageHeader title="Catálogo" description="Productos, presentaciones y sabores" />

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl mb-6 w-fit">
        <button onClick={() => setVistaActiva('catalogo')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${vistaActiva === 'catalogo' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
          Catálogo
        </button>
        <button onClick={() => setVistaActiva('sabores')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${vistaActiva === 'sabores' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
          Sabores <span className="ml-1 text-xs opacity-60">{opciones.length}</span>
        </button>
        <button onClick={() => { setVistaActiva('disponibilidad'); cargarDisponibilidad() }}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${vistaActiva === 'disponibilidad' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
          Disponibilidad
        </button>
      </div>

      {vistaActiva === 'catalogo' && <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNewCat} icon={<Plus className="h-4 w-4" />}>Nueva categoría</ConeButton>
      </div>
      <div className="space-y-3">
        {categorias.map(cat => {
          const catProds = productos.filter(p => p.categoria_id === cat.id)
          const catExpandida = catExpandidas.has(cat.id)


          return (
            <div key={cat.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
              {/* Header categoría */}
              <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-neutral-50/50 transition-colors"
                onClick={() => toggleCat(cat.id)}>
                <div className="flex items-center gap-3">
                  <button className="text-neutral-300 hover:text-neutral-500 transition-colors">
                    {catExpandida ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="w-9 h-9 rounded-xl bg-neutral-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {cat.icono_url ? <Image src={cat.icono_url} alt={cat.nombre} width={36} height={36} className="object-cover w-full h-full" /> : <span className="text-lg">📁</span>}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-neutral-900">{cat.nombre}</span>
                      <ConeBadge active={cat.activo} />
                    </div>
                    <p className="text-xs text-neutral-400">{catProds.length} productos</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                  <button onClick={() => openNewProd(cat.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-neutral-500 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors">
                    <Plus className="h-3 w-3" /> Producto
                  </button>
                  <button onClick={() => openEditCat(cat)} className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => deleteCat(cat.id)} className="p-1.5 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>

              {catExpandida && (
                <div className="border-t border-neutral-50">
                  {/* Productos */}
                  {catProds.map(prod => {
                    const prodPres = presentaciones.filter(p => p.producto_id === prod.id)
                    const prodExpandido = prodExpandidos.has(prod.id)
                    const saboresProd = getSaboresDeProd(prod.id)

                    return (
                      <div key={prod.id} className="border-b border-neutral-50 last:border-0">
                        {/* Header producto */}
                        <div className="flex items-center justify-between pl-12 pr-5 py-3 hover:bg-neutral-50/30 cursor-pointer transition-colors"
                          onClick={() => toggleProd(prod.id)}>
                          <div className="flex items-center gap-3">
                            <button className="text-neutral-300 hover:text-neutral-500">
                              {prodExpandido ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                            <div className="w-8 h-8 rounded-lg bg-neutral-50 border border-neutral-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                              {prod.imagen_url ? <Image src={prod.imagen_url} alt={prod.nombre} width={32} height={32} className="object-cover w-full h-full" /> : <ImageIcon className="h-3.5 w-3.5 text-neutral-300" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-neutral-800 text-sm">📦 {prod.nombre}</span>
                                <ConeBadge active={prod.activo} />
                              </div>
                              <p className="text-xs text-neutral-400">{prodPres.length} presentaciones · {saboresProd.length} sabores</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            <button onClick={() => openNewPres(prod.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors">
                              <Plus className="h-3 w-3" /> Presentación
                            </button>
                            <button onClick={() => openEditProd(prod)} className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                            <button onClick={() => deleteProd(prod.id)} className="p-1.5 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>

                        {prodExpandido && (
                          <div className="pl-24 pr-5 pb-3 space-y-1.5">
                            {/* Presentaciones */}
                            {prodPres.map(pres => (
                              <div key={pres.id} className="flex items-center justify-between bg-neutral-50 rounded-xl px-4 py-2.5">
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-lg bg-white border border-neutral-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                                    {pres.imagen_url ? <Image src={pres.imagen_url} alt={pres.nombre} width={28} height={28} className="object-cover w-full h-full" /> : <span className="text-xs">💰</span>}
                                  </div>
                                  <div>
                                    <span className="text-neutral-700 text-sm font-semibold">{pres.nombre}</span>
                                    <span className="text-neutral-400 text-xs ml-2">${Number(pres.precio).toLocaleString('es-AR')}</span>
                                    {pres.permite_opciones && <span className="text-amber-600 text-xs ml-2">{pres.opciones_min}–{pres.opciones_max} sabores</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => openEditPres(pres)} className="p-1 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                                  <button onClick={() => deletePres(pres.id)} className="p-1 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                                </div>
                              </div>
                            ))}

                            {/* Sabores del producto */}
                            {saboresProd.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Sabores</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {[...saboresProd].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(op => (
                                    <div key={op.id} className="flex items-center gap-1.5 bg-white border border-neutral-100 rounded-full px-3 py-1">
                                      {op.imagen_url
                                        ? <Image src={op.imagen_url} alt={op.nombre} width={16} height={16} className="rounded-full object-cover" />
                                        : <span className="text-sm">{op.emoji || '🍦'}</span>}
                                      <span className="text-xs font-medium text-neutral-600">{op.nombre}</span>
                                      <button onClick={() => openEditOp(op)} className="text-neutral-400 hover:text-neutral-700 transition-colors"><Pencil className="h-3 w-3" /></button>
                                    </div>
                                  ))}
                                  <button onClick={() => { const g = getGruposDeProd(prod.id)[0]; if (g) openNewOp(g.id) }}
                                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-full hover:border-neutral-300 hover:text-neutral-600 transition-colors">
                                    <Plus className="h-3 w-3" /> Sabor
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {catProds.length === 0 && (
                    <div className="pl-12 pr-5 py-4 text-neutral-300 text-xs">Sin productos — usá el botón + Producto para agregar</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      </div>}

      {vistaActiva === 'sabores' && <div className="mt-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-neutral-400">{opciones.length} sabores</p>
          <ConeButton onClick={() => openNewOp()} icon={<Plus className="h-4 w-4" />}>Nuevo sabor</ConeButton>
        </div>
        <div className="relative mb-5">
          <input
            value={busquedaSabor}
            onChange={e => setBusquedaSabor(e.target.value)}
            placeholder="Buscar sabor..."
            className="w-full px-4 py-2.5 pl-9 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400 bg-white"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
          {busquedaSabor && <button onClick={() => setBusquedaSabor('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 text-lg leading-none">&times;</button>}
        </div>
        {categorias.map(cat => {
          const saboresCat = getSaboresDeCat(cat.id)
            .filter(op => !busquedaSabor || op.nombre.toLowerCase().includes(busquedaSabor.toLowerCase()))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
          if (saboresCat.length === 0) return null
          const expandida = saboresCatExpandidas.has(cat.id)
          return (
            <div key={cat.id} className="mb-3">
              <button onClick={() => toggleSaboresCat(cat.id)}
                className="w-full flex items-center gap-2 mb-2 p-3 bg-white rounded-xl border border-neutral-100 hover:bg-neutral-50 transition-colors shadow-sm">
                <ChevronRight className={`h-4 w-4 text-neutral-400 transition-transform ${expandida ? 'rotate-90' : ''}`} />
                <div className="w-6 h-6 rounded-lg bg-neutral-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {cat.icono_url ? <Image src={cat.icono_url} alt={cat.nombre} width={24} height={24} className="object-cover w-full h-full" /> : <span className="text-xs">📁</span>}
                </div>
                <h3 className="font-bold text-neutral-700">{cat.nombre}</h3>
                <span className="text-xs text-neutral-400">{saboresCat.length} sabores</span>
              </button>
              {expandida && <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
                {saboresCat.map(op => (
                  <div key={op.id} className="bg-white rounded-xl border border-neutral-100 overflow-hidden shadow-sm">
                    {op.imagen_url ? (
                      <div className="w-full h-20 overflow-hidden bg-neutral-50">
                        <Image src={op.imagen_url} alt={op.nombre} width={200} height={80} className="object-cover w-full h-full" />
                      </div>
                    ) : (
                      <div className="w-full h-20 bg-neutral-50 flex items-center justify-center">
                        <span className="text-3xl">{op.emoji || '🍦'}</span>
                      </div>
                    )}
                    <div className="p-2 flex items-center justify-between gap-1">
                      <p className="text-neutral-800 text-xs font-semibold truncate">{op.nombre}</p>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => openEditOp(op)} className="p-1 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg transition-colors"><Pencil className="h-3 w-3" /></button>
                        <button onClick={() => deleteOp(op.id)} className="p-1 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          )
        })}
      </div>}

      {vistaActiva === 'disponibilidad' && (
        <div className="mt-0">
          {/* Selector sucursal */}
          <div className="flex items-center gap-3 mb-6">
            <p className="text-sm font-semibold text-neutral-700">Sucursal:</p>
            <div className="flex gap-2">
              {sucursales.map(s => (
                <button key={s.id}
                  onClick={() => { setSucursalDispo(s.id); cargarDisponibilidad(s.id) }}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${sucursalDispo === s.id ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
                  {s.nombre}
                </button>
              ))}
            </div>
          </div>

          {loadingDispo ? (
            <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
          ) : (
            <div className="space-y-3">
              {categorias.map(cat => {
                const catProds = productos.filter(p => p.categoria_id === cat.id)
                return (
                  <div key={cat.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
                    {catProds.map((prod, pi) => {
                      const prodPres = presentaciones.filter(p => p.producto_id === prod.id)
                      return (
                        <div key={prod.id} className={pi < catProds.length - 1 ? 'border-b border-neutral-50' : ''}>
                          {/* Producto header */}
                          <div className="flex items-center justify-between px-5 py-3 bg-neutral-50/50">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                                {prod.imagen_url ? <Image src={prod.imagen_url} alt={prod.nombre} width={28} height={28} className="object-cover w-full h-full" /> : <ImageIcon className="h-3.5 w-3.5 text-neutral-300" />}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-neutral-800">{prod.nombre}</p>
                                <p className="text-xs text-neutral-400">{cat.nombre}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => toggleDisponibilidad(prod.id, 'producto', isDisponible(prod.id))}
                              disabled={savingDispo === prod.id}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDisponible(prod.id) ? 'bg-green-500' : 'bg-neutral-200'} disabled:opacity-50`}>
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isDisponible(prod.id) ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                          </div>
                          {/* Presentaciones */}
                          {prodPres.map(pres => (
                            <div key={pres.id} className="flex items-center justify-between pl-16 pr-5 py-2.5 border-t border-neutral-50">
                              <div className="flex items-center gap-2">
                                <span className="text-neutral-600 text-sm">{pres.nombre}</span>
                                <span className="text-neutral-400 text-xs">${Number(pres.precio).toLocaleString('es-AR')}</span>
                              </div>
                              <button
                                onClick={() => toggleDisponibilidad(pres.id, 'presentacion', isDisponible(pres.id))}
                                disabled={savingDispo === pres.id}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isDisponible(pres.id) ? 'bg-green-500' : 'bg-neutral-200'} disabled:opacity-50`}>
                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isDisponible(pres.id) ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                    {catProds.length === 0 && (
                      <div className="px-5 py-3 text-neutral-300 text-xs">Sin productos</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal Categoría */}
      <ConeModal open={modalCat} onClose={() => setModalCat(false)} title={editId ? 'Editar categoría' : 'Nueva categoría'}
        footer={<><ConeButton variant="outline" onClick={() => setModalCat(false)}>Cancelar</ConeButton><ConeButton onClick={saveCat} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formCat.nombre} onChange={e => setFormCat({ ...formCat, nombre: e.target.value })} placeholder="Helados por Kilo" autoFocus /></div>
          <div className="space-y-1.5"><Label>Orden</Label><Input type="number" value={formCat.orden} onChange={e => setFormCat({ ...formCat, orden: Number(e.target.value) })} className="w-24" /></div>
          <div className="space-y-1.5"><Label>Ícono</Label><ImageUpload value={formCat.icono_url} onChange={url => setFormCat({ ...formCat, icono_url: url })} folder="categorias" /></div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formCat.activo} onChange={e => setFormCat({ ...formCat, activo: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-neutral-700">Activo</span></label>
        </div>
      </ConeModal>

      {/* Modal Producto */}
      <ConeModal open={modalProd} onClose={() => setModalProd(false)} title={editId ? 'Editar producto' : 'Nuevo producto'}
        footer={<><ConeButton variant="outline" onClick={() => setModalProd(false)}>Cancelar</ConeButton><ConeButton onClick={saveProd} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formProd.nombre} onChange={e => setFormProd({ ...formProd, nombre: e.target.value })} placeholder="Bombón Suizo" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Categoría *</Label>
            <Select value={formProd.categoria_id} onValueChange={v => setFormProd({ ...formProd, categoria_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
              <SelectContent>{categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Descripción</Label><Input value={formProd.descripcion} onChange={e => setFormProd({ ...formProd, descripcion: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Imagen</Label><ImageUpload value={formProd.imagen_url} onChange={url => setFormProd({ ...formProd, imagen_url: url })} /></div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formProd.activo} onChange={e => setFormProd({ ...formProd, activo: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-neutral-700">Activo</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formProd.visible_kiosk} onChange={e => setFormProd({ ...formProd, visible_kiosk: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-neutral-700">Visible en kiosk</span></label>
          </div>
        </div>
      </ConeModal>

      {/* Modal Presentación */}
      <ConeModal open={modalPres} onClose={() => setModalPres(false)} title={editId ? 'Editar presentación' : 'Nueva presentación'}
        footer={<><ConeButton variant="outline" onClick={() => setModalPres(false)}>Cancelar</ConeButton><ConeButton onClick={savePres} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formPres.nombre} onChange={e => setFormPres({ ...formPres, nombre: e.target.value })} placeholder="Porción / x8 / x20" autoFocus /></div>
          <div className="space-y-1.5"><Label>Precio *</Label><Input type="number" value={formPres.precio} onChange={e => setFormPres({ ...formPres, precio: Number(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label>Orden</Label><Input type="number" value={formPres.orden} onChange={e => setFormPres({ ...formPres, orden: Number(e.target.value) })} className="w-24" /><p className="text-xs text-neutral-400">1 = primero en el listado</p></div>
          <div className="space-y-1.5"><Label>Imagen</Label><ImageUpload value={formPres.imagen_url} onChange={url => setFormPres({ ...formPres, imagen_url: url })} folder="presentaciones" /></div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={formPres.visible_kiosk} onChange={e => setFormPres({ ...formPres, visible_kiosk: e.target.checked })} className="w-4 h-4 rounded" />
            <span className="text-sm text-neutral-700">Visible en kiosk</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={formPres.permite_opciones} onChange={e => setFormPres({ ...formPres, permite_opciones: e.target.checked, opciones_min: e.target.checked ? 1 : 0, opciones_max: e.target.checked ? 1 : 0 })} className="w-4 h-4 rounded" />
            <span className="text-sm text-neutral-700">Permite selección de sabores</span>
          </label>
          {formPres.permite_opciones && (
            <div className="space-y-3 ml-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Mínimo</Label><Input type="number" value={formPres.opciones_min} onChange={e => setFormPres({ ...formPres, opciones_min: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label>Máximo</Label><Input type="number" value={formPres.opciones_max} onChange={e => setFormPres({ ...formPres, opciones_max: Number(e.target.value) })} /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Grupo de sabores</Label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-neutral-100 rounded-xl p-2 bg-neutral-50">
                  {grupos.map(g => (
                    <label key={g.id} className="flex items-center gap-2 cursor-pointer px-2 py-1.5 hover:bg-white rounded-lg transition-colors">
                      <input type="checkbox"
                        checked={gruposSeleccionados.includes(g.id)}
                        onChange={e => setGruposSeleccionados(prev => e.target.checked ? [...prev, g.id] : prev.filter(id => id !== g.id))}
                        className="w-4 h-4 rounded" />
                      <span className="text-sm text-neutral-700">{g.nombre}</span>
                      <span className="text-xs text-neutral-400 ml-auto">{opciones.filter(o => o.grupo_id === g.id).length} sabores</span>
                    </label>
                  ))}
                </div>
                {gruposSeleccionados.length === 0 && <p className="text-xs text-amber-600">Seleccioná al menos un grupo de sabores</p>}
              </div>
            </div>
          )}
        </div>
      </ConeModal>

      {/* Modal Grupo */}
      <ConeModal open={modalGrupo} onClose={() => setModalGrupo(false)} title={editId ? 'Editar grupo' : 'Nuevo grupo de sabores'}
        footer={<><ConeButton variant="outline" onClick={() => setModalGrupo(false)}>Cancelar</ConeButton><ConeButton onClick={saveGrupo} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formGrupo.nombre} onChange={e => setFormGrupo({ ...formGrupo, nombre: e.target.value })} placeholder="Variedades Bombón" autoFocus /></div>
          <div className="space-y-1.5"><Label>Orden</Label><Input type="number" value={formGrupo.orden} onChange={e => setFormGrupo({ ...formGrupo, orden: Number(e.target.value) })} className="w-24" /></div>
        </div>
      </ConeModal>

      {/* Modal Sabor */}
      <ConeModal open={modalOp} onClose={() => setModalOp(false)} title={editId ? 'Editar sabor' : 'Nuevo sabor'}
        footer={<><ConeButton variant="outline" onClick={() => setModalOp(false)}>Cancelar</ConeButton><ConeButton onClick={saveOp} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Grupo *</Label>
            <Select value={formOp.grupo_id} onValueChange={v => setFormOp({ ...formOp, grupo_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
              <SelectContent>{grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formOp.nombre} onChange={e => setFormOp({ ...formOp, nombre: e.target.value })} placeholder="Chocolate" autoFocus /></div>
          <div className="space-y-1.5"><Label>Emoji</Label><Input value={formOp.emoji} onChange={e => setFormOp({ ...formOp, emoji: e.target.value })} placeholder="🍫" className="text-xl w-24" /></div>
          <div className="space-y-1.5"><Label>Imagen</Label><ImageUpload value={formOp.imagen_url} onChange={url => setFormOp({ ...formOp, imagen_url: url })} folder="sabores" /></div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formOp.visible_kiosk} onChange={e => setFormOp({ ...formOp, visible_kiosk: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-neutral-700">Visible en kiosk</span></label>
          <div className="space-y-1.5"><Label>Descripción</Label><Input value={formOp.descripcion} onChange={e => setFormOp({ ...formOp, descripcion: e.target.value })} placeholder="Descripción corta" /></div>
        </div>
      </ConeModal>
    </div>
  )
}
