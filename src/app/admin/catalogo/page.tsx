'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2, Pencil, Trash2, Upload, X, ImageIcon } from 'lucide-react'
import Image from 'next/image'

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface Categoria { id: string; nombre: string; orden: number; activo: boolean; icono_url: string | null }
interface Producto { id: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria_id: string; codigo: string | null; orden: number; activo: boolean; visible_kiosk: boolean }
interface Presentacion { id: string; nombre: string; precio: number; permite_opciones: boolean; opciones_min: number; opciones_max: number; orden: number; activo: boolean; producto_id: string }
interface GrupoOpciones { id: string; nombre: string; orden: number; activo: boolean }
interface Opcion { id: string; nombre: string; descripcion: string | null; emoji: string | null; grupo_id: string; orden: number; activo: boolean }

type Tab = 'categorias' | 'productos' | 'presentaciones' | 'sabores'

// ─── ImageUpload ─────────────────────────────────────────────────────────────
function ImageUpload({ value, onChange, bucket = 'productos', folder = 'productos' }: {
  value: string | null; onChange: (url: string | null) => void; bucket?: string; folder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const supabase = createClient()

  async function handleFile(file: File) {
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${folder}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path)
      onChange(data.publicUrl)
    }
    setUploading(false)
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative w-full h-40 rounded-xl overflow-hidden border border-neutral-200 bg-neutral-50 group">
          <Image src={value} alt="Preview" fill className="object-cover" />
          <button onClick={() => onChange(null)}
            className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full h-40 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-300 transition-colors flex flex-col items-center justify-center gap-2 text-neutral-400 disabled:opacity-50">
          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
          <span className="text-sm">{uploading ? 'Subiendo...' : 'Subir imagen'}</span>
          <span className="text-xs text-neutral-300">JPG, PNG, WEBP</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CatalogoPage() {
  const { ctx } = useEmpresa()
  const [tab, setTab] = useState<Tab>('productos')
  const [loading, setLoading] = useState(true)

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [grupos, setGrupos] = useState<GrupoOpciones[]>([])
  const [opciones, setOpciones] = useState<Opcion[]>([])

  // Modales
  const [modalCat, setModalCat] = useState(false)
  const [modalProd, setModalProd] = useState(false)
  const [modalPres, setModalPres] = useState(false)
  const [modalGrupo, setModalGrupo] = useState(false)
  const [modalOp, setModalOp] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Forms
  const [formCat, setFormCat] = useState({ nombre: '', orden: 1, activo: true, icono_url: null as string | null })
  const [formProd, setFormProd] = useState({ nombre: '', descripcion: '', imagen_url: null as string | null, categoria_id: '', codigo: '', orden: 1, activo: true, visible_kiosk: true })
  const [formPres, setFormPres] = useState({ nombre: '', precio: 0, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1, activo: true, producto_id: '' })
  const [formGrupo, setFormGrupo] = useState({ nombre: '', orden: 1, activo: true })
  const [formOp, setFormOp] = useState({ nombre: '', descripcion: '', emoji: '', grupo_id: '', orden: 1, activo: true })

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: cats }, { data: prods }, { data: pres }, { data: grps }, { data: ops }] = await Promise.all([
      supabase.from('categorias').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('productos').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('presentaciones').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('grupos_opciones').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('opciones').select('*').eq('empresa_id', ctx.empresaId).order('orden'),
    ])
    setCategorias((cats ?? []) as Categoria[])
    setProductos((prods ?? []) as Producto[])
    setPresentaciones((pres ?? []) as Presentacion[])
    setGrupos((grps ?? []) as GrupoOpciones[])
    setOpciones((ops ?? []) as Opcion[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  // ── Categorías ──
  function openNewCat() { setFormCat({ nombre: '', orden: categorias.length + 1, activo: true, icono_url: null }); setEditId(null); setModalCat(true) }
  function openEditCat(c: Categoria) { setFormCat({ nombre: c.nombre, orden: c.orden, activo: c.activo, icono_url: c.icono_url }); setEditId(c.id); setModalCat(true) }
  async function saveCat() {
    if (!ctx || !formCat.nombre) return
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: formCat.nombre, orden: formCat.orden, activo: formCat.activo, icono_url: formCat.icono_url }
    if (editId) await supabase.from('categorias').update(payload).eq('id', editId)
    else await supabase.from('categorias').insert({ ...payload, empresa_id: ctx.empresaId })
    setSaving(false); setModalCat(false); load()
  }
  async function deleteCat(id: string) {
    if (!confirm('¿Eliminar categoría?')) return
    const supabase = createClient()
    await supabase.from('categorias').delete().eq('id', id)
    load()
  }

  // ── Productos ──
  function openNewProd() { setFormProd({ nombre: '', descripcion: '', imagen_url: null, categoria_id: categorias[0]?.id ?? '', codigo: '', orden: productos.length + 1, activo: true, visible_kiosk: true }); setEditId(null); setModalProd(true) }
  function openEditProd(p: Producto) { setFormProd({ nombre: p.nombre, descripcion: p.descripcion ?? '', imagen_url: p.imagen_url, categoria_id: p.categoria_id, codigo: p.codigo ?? '', orden: p.orden, activo: p.activo, visible_kiosk: p.visible_kiosk }); setEditId(p.id); setModalProd(true) }
  async function saveProd() {
    if (!ctx || !formProd.nombre) return
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: formProd.nombre, descripcion: formProd.descripcion || null, imagen_url: formProd.imagen_url, categoria_id: formProd.categoria_id, codigo: formProd.codigo || null, orden: formProd.orden, activo: formProd.activo, visible_kiosk: formProd.visible_kiosk }
    if (editId) await supabase.from('productos').update(payload).eq('id', editId)
    else await supabase.from('productos').insert({ ...payload, empresa_id: ctx.empresaId })
    setSaving(false); setModalProd(false); load()
  }
  async function deleteProd(id: string) {
    if (!confirm('¿Eliminar producto?')) return
    const supabase = createClient()
    await supabase.from('productos').delete().eq('id', id)
    load()
  }

  // ── Presentaciones ──
  function openNewPres() { setFormPres({ nombre: '', precio: 0, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1, activo: true, producto_id: productos[0]?.id ?? '' }); setEditId(null); setModalPres(true) }
  function openEditPres(p: Presentacion) { setFormPres({ nombre: p.nombre, precio: p.precio, permite_opciones: p.permite_opciones, opciones_min: p.opciones_min, opciones_max: p.opciones_max, orden: p.orden, activo: p.activo, producto_id: p.producto_id }); setEditId(p.id); setModalPres(true) }
  async function savePres() {
    if (!ctx || !formPres.nombre || !formPres.producto_id) return
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: formPres.nombre, precio: formPres.precio, permite_opciones: formPres.permite_opciones, opciones_min: formPres.opciones_min, opciones_max: formPres.opciones_max, orden: formPres.orden, activo: formPres.activo, producto_id: formPres.producto_id }
    if (editId) await supabase.from('presentaciones').update(payload).eq('id', editId)
    else await supabase.from('presentaciones').insert({ ...payload, empresa_id: ctx.empresaId })
    setSaving(false); setModalPres(false); load()
  }
  async function deletePres(id: string) {
    if (!confirm('¿Eliminar presentación?')) return
    const supabase = createClient()
    await supabase.from('presentaciones').delete().eq('id', id)
    load()
  }

  // ── Grupos ──
  function openNewGrupo() { setFormGrupo({ nombre: '', orden: grupos.length + 1, activo: true }); setEditId(null); setModalGrupo(true) }
  function openEditGrupo(g: GrupoOpciones) { setFormGrupo({ nombre: g.nombre, orden: g.orden, activo: g.activo }); setEditId(g.id); setModalGrupo(true) }
  async function saveGrupo() {
    if (!ctx || !formGrupo.nombre) return
    setSaving(true)
    const supabase = createClient()
    if (editId) await supabase.from('grupos_opciones').update(formGrupo).eq('id', editId)
    else await supabase.from('grupos_opciones').insert({ ...formGrupo, empresa_id: ctx.empresaId })
    setSaving(false); setModalGrupo(false); load()
  }

  // ── Opciones/Sabores ──
  function openNewOp() { setFormOp({ nombre: '', descripcion: '', emoji: '', grupo_id: grupos[0]?.id ?? '', orden: 1, activo: true }); setEditId(null); setModalOp(true) }
  function openEditOp(o: Opcion) { setFormOp({ nombre: o.nombre, descripcion: o.descripcion ?? '', emoji: o.emoji ?? '', grupo_id: o.grupo_id, orden: o.orden, activo: o.activo }); setEditId(o.id); setModalOp(true) }
  async function saveOp() {
    if (!ctx || !formOp.nombre || !formOp.grupo_id) return
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: formOp.nombre, descripcion: formOp.descripcion || null, emoji: formOp.emoji || null, grupo_id: formOp.grupo_id, orden: formOp.orden, activo: formOp.activo }
    if (editId) await supabase.from('opciones').update(payload).eq('id', editId)
    else await supabase.from('opciones').insert({ ...payload, empresa_id: ctx.empresaId })
    setSaving(false); setModalOp(false); load()
  }
  async function deleteOp(id: string) {
    if (!confirm('¿Eliminar sabor?')) return
    const supabase = createClient()
    await supabase.from('opciones').delete().eq('id', id)
    load()
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'productos', label: 'Productos', count: productos.length },
    { key: 'categorias', label: 'Categorías', count: categorias.length },
    { key: 'presentaciones', label: 'Presentaciones', count: presentaciones.length },
    { key: 'sabores', label: 'Sabores', count: opciones.length },
  ]

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div>
      <ConePageHeader title="Catálogo" description="Productos, categorías, presentaciones y sabores" />

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.key ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
            {t.label} <span className="ml-1 text-xs opacity-60">{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── Productos ── */}
      {tab === 'productos' && (
        <div>
          <div className="flex justify-end mb-4">
            <ConeButton onClick={openNewProd} icon={<Plus className="h-4 w-4" />}>Nuevo producto</ConeButton>
          </div>
          <div className="space-y-2">
            {productos.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin productos</div>}
            {productos.map(prod => {
              const cat = categorias.find(c => c.id === prod.categoria_id)
              const pres = presentaciones.filter(p => p.producto_id === prod.id)
              return (
                <div key={prod.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-4 p-4">
                    <div className="w-16 h-16 rounded-xl bg-neutral-50 border border-neutral-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {prod.imagen_url
                        ? <Image src={prod.imagen_url} alt={prod.nombre} width={64} height={64} className="object-cover w-full h-full" />
                        : <ImageIcon className="h-6 w-6 text-neutral-300" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-neutral-900">{prod.nombre}</span>
                        <ConeBadge active={prod.activo} />
                        {!prod.visible_kiosk && <span className="text-xs bg-neutral-100 text-neutral-400 px-2 py-0.5 rounded-full">Oculto en kiosk</span>}
                      </div>
                      {prod.descripcion && <p className="text-neutral-400 text-xs mt-0.5">{prod.descripcion}</p>}
                      <div className="flex items-center gap-2 mt-1.5">
                        {cat && <span className="text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">{cat.nombre}</span>}
                        {pres.map(p => <span key={p.id} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{p.nombre} ${Number(p.precio).toLocaleString('es-AR')}</span>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openEditProd(prod)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => deleteProd(prod.id)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Categorías ── */}
      {tab === 'categorias' && (
        <div>
          <div className="flex justify-end mb-4">
            <ConeButton onClick={openNewCat} icon={<Plus className="h-4 w-4" />}>Nueva categoría</ConeButton>
          </div>
          <div className="space-y-2">
            {categorias.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin categorías</div>}
            {categorias.map(cat => (
              <div key={cat.id} className="bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-neutral-50 border border-neutral-100 flex items-center justify-center overflow-hidden">
                    {cat.icono_url ? <Image src={cat.icono_url} alt={cat.nombre} width={40} height={40} className="object-cover w-full h-full" /> : <ImageIcon className="h-4 w-4 text-neutral-300" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-neutral-900">{cat.nombre}</span>
                      <ConeBadge active={cat.activo} />
                    </div>
                    <p className="text-xs text-neutral-400">Orden: {cat.orden} · {productos.filter(p => p.categoria_id === cat.id).length} productos</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => openEditCat(cat)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => deleteCat(cat.id)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Presentaciones ── */}
      {tab === 'presentaciones' && (
        <div>
          <div className="flex justify-end mb-4">
            <ConeButton onClick={openNewPres} icon={<Plus className="h-4 w-4" />}>Nueva presentación</ConeButton>
          </div>
          <div className="space-y-2">
            {presentaciones.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin presentaciones</div>}
            {presentaciones.map(pres => {
              const prod = productos.find(p => p.id === pres.producto_id)
              return (
                <div key={pres.id} className="bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-neutral-900">{prod?.nombre ?? '?'}</span>
                      <span className="text-neutral-400">→</span>
                      <span className="font-semibold text-neutral-700">{pres.nombre}</span>
                      <ConeBadge active={pres.activo} />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-neutral-700 font-bold">${Number(pres.precio).toLocaleString('es-AR')}</span>
                      {pres.permite_opciones && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">{pres.opciones_min}–{pres.opciones_max} sabores</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => openEditPres(pres)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => deletePres(pres.id)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Sabores ── */}
      {tab === 'sabores' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div className="flex gap-2">
              <ConeButton onClick={openNewGrupo} variant="outline" icon={<Plus className="h-4 w-4" />}>Nuevo grupo</ConeButton>
              <ConeButton onClick={openNewOp} icon={<Plus className="h-4 w-4" />}>Nuevo sabor</ConeButton>
            </div>
          </div>
          {grupos.map(grupo => {
            const ops = opciones.filter(o => o.grupo_id === grupo.id)
            return (
              <div key={grupo.id} className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-neutral-700">{grupo.nombre}</h3>
                    <span className="text-xs text-neutral-400">{ops.length} sabores</span>
                  </div>
                  <button onClick={() => openEditGrupo(grupo)} className="p-1.5 text-neutral-300 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {ops.map(op => (
                    <div key={op.id} className="bg-white rounded-xl border border-neutral-100 p-3 flex items-center justify-between shadow-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl flex-shrink-0">{op.emoji || '🍦'}</span>
                        <div className="min-w-0">
                          <p className="text-neutral-800 text-sm font-semibold truncate">{op.nombre}</p>
                          {op.descripcion && <p className="text-neutral-400 text-xs truncate">{op.descripcion}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
                        <button onClick={() => openEditOp(op)} className="p-1 text-neutral-300 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors"><Pencil className="h-3 w-3" /></button>
                        <button onClick={() => deleteOp(op.id)} className="p-1 text-neutral-200 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Categoría */}
      <ConeModal open={modalCat} onClose={() => setModalCat(false)} title={editId ? 'Editar categoría' : 'Nueva categoría'}
        footer={<><ConeButton variant="outline" onClick={() => setModalCat(false)}>Cancelar</ConeButton><ConeButton onClick={saveCat} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formCat.nombre} onChange={e => setFormCat({ ...formCat, nombre: e.target.value })} placeholder="Helados por Kilo" autoFocus /></div>
          <div className="space-y-1.5"><Label>Orden</Label><Input type="number" value={formCat.orden} onChange={e => setFormCat({ ...formCat, orden: Number(e.target.value) })} className="w-24" /></div>
          <div className="space-y-1.5"><Label>Ícono (imagen)</Label><ImageUpload value={formCat.icono_url} onChange={url => setFormCat({ ...formCat, icono_url: url })} folder="categorias" /></div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formCat.activo} onChange={e => setFormCat({ ...formCat, activo: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-neutral-700">Activo</span></label>
        </div>
      </ConeModal>

      {/* Modal Producto */}
      <ConeModal open={modalProd} onClose={() => setModalProd(false)} title={editId ? 'Editar producto' : 'Nuevo producto'}
        footer={<><ConeButton variant="outline" onClick={() => setModalProd(false)}>Cancelar</ConeButton><ConeButton onClick={saveProd} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formProd.nombre} onChange={e => setFormProd({ ...formProd, nombre: e.target.value })} placeholder="Helado artesanal" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Categoría *</Label>
            <Select value={formProd.categoria_id} onValueChange={v => setFormProd({ ...formProd, categoria_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
              <SelectContent>{categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Descripción</Label><Input value={formProd.descripcion} onChange={e => setFormProd({ ...formProd, descripcion: e.target.value })} placeholder="Descripción opcional" /></div>
          <div className="space-y-1.5"><Label>Código</Label><Input value={formProd.codigo} onChange={e => setFormProd({ ...formProd, codigo: e.target.value })} placeholder="00061" className="font-mono" /></div>
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
          <div className="space-y-1.5">
            <Label>Producto *</Label>
            <Select value={formPres.producto_id} onValueChange={v => setFormPres({ ...formPres, producto_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
              <SelectContent>{productos.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formPres.nombre} onChange={e => setFormPres({ ...formPres, nombre: e.target.value })} placeholder="1/4 Kg" autoFocus /></div>
          <div className="space-y-1.5"><Label>Precio *</Label><Input type="number" value={formPres.precio} onChange={e => setFormPres({ ...formPres, precio: Number(e.target.value) })} /></div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={formPres.permite_opciones} onChange={e => setFormPres({ ...formPres, permite_opciones: e.target.checked, opciones_min: e.target.checked ? 1 : 0, opciones_max: e.target.checked ? 1 : 0 })} className="w-4 h-4 rounded" />
            <span className="text-sm text-neutral-700">Permite selección de sabores</span>
          </label>
          {formPres.permite_opciones && (
            <div className="grid grid-cols-2 gap-3 ml-6">
              <div className="space-y-1.5"><Label>Mínimo</Label><Input type="number" value={formPres.opciones_min} onChange={e => setFormPres({ ...formPres, opciones_min: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Máximo</Label><Input type="number" value={formPres.opciones_max} onChange={e => setFormPres({ ...formPres, opciones_max: Number(e.target.value) })} /></div>
            </div>
          )}
        </div>
      </ConeModal>

      {/* Modal Grupo */}
      <ConeModal open={modalGrupo} onClose={() => setModalGrupo(false)} title={editId ? 'Editar grupo' : 'Nuevo grupo de sabores'}
        footer={<><ConeButton variant="outline" onClick={() => setModalGrupo(false)}>Cancelar</ConeButton><ConeButton onClick={saveGrupo} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={formGrupo.nombre} onChange={e => setFormGrupo({ ...formGrupo, nombre: e.target.value })} placeholder="Chocolates" autoFocus /></div>
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
          <div className="space-y-1.5"><Label>Descripción</Label><Input value={formOp.descripcion} onChange={e => setFormOp({ ...formOp, descripcion: e.target.value })} placeholder="Descripción corta del sabor" /></div>
        </div>
      </ConeModal>
    </div>
  )
}
