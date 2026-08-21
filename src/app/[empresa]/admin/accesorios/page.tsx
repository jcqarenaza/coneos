'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeCard } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Pencil, Trash2, X, Upload } from 'lucide-react'

interface Accesorio {
  id: string
  nombre: string
  precio_adicional: number
  imagen_url: string | null
  emoji: string | null
  activo: boolean
}

const GRUPO_KEY = 'accesorio' // los grupos cuyo nombre contiene esto son de accesorios

export default function AccesoriosPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [grupoId, setGrupoId] = useState<string | null>(null)
  const [items, setItems] = useState<Accesorio[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<{ nombre: string; precio: number; imagen_url: string | null; activo: boolean }>({ nombre: '', precio: 0, imagen_url: null, activo: true })
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  const load = useCallback(async () => {
    if (!ctx) return
    setLoading(true)
    const supabase = createClient()

    // Buscar (o crear) el grupo Accesorios de la empresa
    let { data: grupo } = await supabase
      .from('grupos_opciones')
      .select('id')
      .eq('empresa_id', ctx.empresaId)
      .ilike('nombre', `%${GRUPO_KEY}%`)
      .limit(1)
      .maybeSingle()

    if (!grupo) {
      const { data: nuevo } = await supabase
        .from('grupos_opciones')
        .insert({ empresa_id: ctx.empresaId, nombre: 'Accesorios', activo: true })
        .select('id')
        .single()
      grupo = nuevo
    }

    if (!grupo) { setLoading(false); return }
    setGrupoId(grupo.id)

    const { data } = await supabase
      .from('opciones')
      .select('id, nombre, precio_adicional, imagen_url, emoji, activo')
      .eq('grupo_id', grupo.id)
      .is('deleted_at', null)
      .order('nombre')

    setItems((data ?? []).map(o => ({ ...o, precio_adicional: Number(o.precio_adicional) })))
    setLoading(false)
  }, [ctx])

  useEffect(() => { load() }, [load])

  function openNew() {
    setForm({ nombre: '', precio: 0, imagen_url: null, activo: true })
    setEditId(null)
    setModal(true)
  }

  function openEdit(a: Accesorio) {
    setForm({ nombre: a.nombre, precio: a.precio_adicional, imagen_url: a.imagen_url, activo: a.activo })
    setEditId(a.id)
    setModal(true)
  }

  async function handleImagen(file: File) {
    if (!ctx) return
    setSubiendo(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `accesorios/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(path, file)
    if (!error) {
      const { data } = supabase.storage.from('productos').getPublicUrl(path)
      setForm(f => ({ ...f, imagen_url: data.publicUrl }))
    }
    setSubiendo(false)
  }

  async function save() {
    if (!ctx || !grupoId || !form.nombre.trim()) return
    setGuardando(true)
    const supabase = createClient()

    if (editId) {
      await supabase.from('opciones').update({
        nombre: form.nombre.trim(),
        precio_adicional: form.precio,
        imagen_url: form.imagen_url,
        activo: form.activo,
      }).eq('id', editId)
    } else {
      await supabase.from('opciones').insert({
        empresa_id: ctx.empresaId,
        grupo_id: grupoId,
        nombre: form.nombre.trim(),
        precio_adicional: form.precio,
        imagen_url: form.imagen_url,
        activo: form.activo,
      })
    }
    setGuardando(false)
    setModal(false)
    load()
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este accesorio?')) return
    const supabase = createClient()
    await supabase.from('opciones').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  if (ctxLoading || loading) return (
    <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <ConePageHeader title="Accesorios" subtitle="Agregados opcionales que se ofrecen al finalizar el pedido (cucuruchos, toppings, etc.)" />
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo accesorio</ConeButton>
      </div>

      {items.length === 0 ? (
        <ConeCard><p className="text-neutral-400 text-sm text-center py-8">Sin accesorios todavía. Creá el primero.</p></ConeCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map(a => (
            <div key={a.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-4 flex items-center gap-4">
              {a.imagen_url
                ? <img src={a.imagen_url} alt={a.nombre} className="w-16 h-16 object-cover rounded-xl" />
                : <div className="w-16 h-16 rounded-xl bg-neutral-50 flex items-center justify-center text-3xl">{a.emoji ?? '🍦'}</div>
              }
              <div className="flex-1 min-w-0">
                <p className="font-bold text-neutral-800 text-sm truncate">{a.nombre}</p>
                <p className="text-sm font-semibold text-neutral-500">${Number(a.precio_adicional).toLocaleString('es-AR')}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${a.activo ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-400'}`}>
                  {a.activo ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => openEdit(a)} className="p-2 text-neutral-300 hover:text-neutral-600 transition-colors"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => eliminar(a.id)} className="p-2 text-neutral-300 hover:text-red-400 transition-colors"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <button onClick={() => setModal(false)} className="absolute top-4 right-4 p-1 text-neutral-400 hover:text-neutral-600"><X className="h-5 w-5" /></button>
            <h3 className="font-bold text-neutral-900 text-lg mb-5">{editId ? 'Editar accesorio' : 'Nuevo accesorio'}</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Cucurucho x 6" />
              </div>
              <div className="space-y-1.5">
                <Label>Precio ($)</Label>
                <Input type="number" value={form.precio} onChange={e => setForm({ ...form, precio: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Imagen</Label>
                {form.imagen_url ? (
                  <div className="flex items-center gap-3">
                    <img src={form.imagen_url} alt="" className="w-14 h-14 object-cover rounded-xl border border-neutral-100" />
                    <button onClick={() => setForm({ ...form, imagen_url: null })} className="text-xs text-neutral-400 hover:text-red-400">Quitar</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 px-4 py-2.5 border border-neutral-200 rounded-xl cursor-pointer hover:bg-neutral-50 transition-colors w-fit">
                    {subiendo ? <Loader2 className="h-4 w-4 animate-spin text-neutral-400" /> : <Upload className="h-4 w-4 text-neutral-400" />}
                    <span className="text-sm text-neutral-600">{subiendo ? 'Subiendo...' : 'Subir imagen'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImagen(f) }} />
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="acc-activo" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded" />
                <Label htmlFor="acc-activo" className="cursor-pointer">Activo</Label>
              </div>
              <ConeButton onClick={save} disabled={guardando || !form.nombre.trim()} className="w-full">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
              </ConeButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
