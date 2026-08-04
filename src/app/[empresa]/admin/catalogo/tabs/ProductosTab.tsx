'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeTable, ConeModal, ConeButton, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2 } from 'lucide-react'

interface Categoria { id: string; nombre: string }
interface Producto {
  id: string
  nombre: string
  descripcion: string | null
  categoria_id: string
  categoria_nombre?: string
  orden: number
  activo: boolean
  visible_kiosk: boolean
  [key: string]: unknown
}

const empty = (): Partial<Producto> => ({
  nombre: '', descripcion: '', categoria_id: '', orden: 0, activo: true, visible_kiosk: true
})

export default function ProductosTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Partial<Producto>>(empty())
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: prods }, { data: cats }] = await Promise.all([
      supabase.from('productos')
        .select('id, nombre, descripcion, categoria_id, orden, activo, visible_kiosk, categorias(nombre)')
        .eq('empresa_id', ctx.empresaId)
        .is('deleted_at', null)
        .order('orden'),
      supabase.from('categorias')
        .select('id, nombre')
        .eq('empresa_id', ctx.empresaId)
        .eq('activo', true)
        .order('orden'),
    ])
    setData((prods ?? []).map((p: Record<string, unknown>) => ({
      ...p,
      categoria_nombre: (p.categorias as { nombre: string } | null)?.nombre ?? '',
    })) as Producto[])
    setCategorias((cats ?? []) as Categoria[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm(empty()); setEditId(null); setModal(true) }
  function openEdit(row: Producto) { setForm(row); setEditId(row.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre || !form.categoria_id) return
    setSaving(true)
    const supabase = createClient()
    const payload = {
      nombre: form.nombre,
      descripcion: form.descripcion || null,
      categoria_id: form.categoria_id,
      orden: form.orden ?? 0,
      activo: form.activo ?? true,
      visible_kiosk: form.visible_kiosk ?? true,
      empresa_id: ctx.empresaId,
    }
    if (editId) {
      await supabase.from('productos').update(payload).eq('id', editId)
    } else {
      await supabase.from('productos').insert(payload)
    }
    setSaving(false)
    setModal(false)
    load()
  }

  async function handleDelete(row: Producto) {
    if (!confirm(`¿Eliminar "${row.nombre}"?`)) return
    const supabase = createClient()
    await supabase.from('productos').update({ deleted_at: new Date().toISOString(), activo: false }).eq('id', row.id)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo producto</ConeButton>
      </div>

      <ConeTable
        data={data}
        columns={[
          { key: 'nombre', label: 'Producto' },
          { key: 'categoria_nombre', label: 'Categoría' },
          { key: 'orden', label: 'Orden' },
          { key: 'visible_kiosk', label: 'Kiosk', render: row => <ConeBadge active={row.visible_kiosk as boolean} labelOn="Visible" labelOff="Solo caja" /> },
          { key: 'activo', label: 'Estado', render: row => <ConeBadge active={row.activo as boolean} /> },
        ]}
        onEdit={openEdit}
        onDelete={handleDelete}
        emptyMessage="Sin productos — creá el primero"
      />

      <ConeModal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Editar producto' : 'Nuevo producto'}
        footer={
          <>
            <ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton>
            <ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Categoría *</Label>
            <Select value={form.categoria_id ?? ''} onValueChange={v => setForm({ ...form, categoria_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná una categoría" /></SelectTrigger>
              <SelectContent>
                {categorias.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input value={form.nombre ?? ''} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Helado artesanal" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Input value={form.descripcion ?? ''} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Opcional" />
          </div>
          <div className="space-y-1.5">
            <Label>Orden</Label>
            <Input type="number" value={form.orden ?? 0} onChange={e => setForm({ ...form, orden: Number(e.target.value) })} className="w-24" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="activo" checked={form.activo ?? true} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded" />
              <Label htmlFor="activo" className="cursor-pointer">Activo</Label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="visible_kiosk" checked={form.visible_kiosk ?? true} onChange={e => setForm({ ...form, visible_kiosk: e.target.checked })} className="w-4 h-4 rounded" />
              <Label htmlFor="visible_kiosk" className="cursor-pointer">Visible en Kiosk</Label>
            </div>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
