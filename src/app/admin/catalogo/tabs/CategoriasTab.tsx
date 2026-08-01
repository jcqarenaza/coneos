'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeTable, ConeModal, ConeButton, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2 } from 'lucide-react'

interface Categoria {
  id: string
  nombre: string
  orden: number
  activo: boolean
  [key: string]: unknown
}

interface CategoriaForm {
  nombre: string
  orden: number
  activo: boolean
}

const empty = (): CategoriaForm => ({ nombre: '', orden: 0, activo: true })

export default function CategoriasTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<CategoriaForm>(empty())
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const { data: rows } = await supabase
      .from('categorias')
      .select('id, nombre, orden, activo')
      .eq('empresa_id', ctx.empresaId)
      .is('deleted_at', null)
      .order('orden')
    setData((rows ?? []) as Categoria[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm(empty()); setEditId(null); setModal(true) }
  function openEdit(row: Categoria) {
    setForm({ nombre: row.nombre, orden: row.orden, activo: row.activo })
    setEditId(row.id)
    setModal(true)
  }

  async function handleSave() {
    if (!ctx || !form.nombre) return
    setSaving(true)
    const supabase = createClient()

    const payload = {
      nombre: form.nombre,
      orden: form.orden,
      activo: form.activo,
      empresa_id: ctx.empresaId,
    }

    if (editId) {
      await supabase.from('categorias').update(payload).eq('id', editId)
    } else {
      await supabase.from('categorias').insert(payload)
    }

    setSaving(false)
    setModal(false)
    load()
  }

  async function handleDelete(row: Categoria) {
    if (!confirm(`¿Eliminar "${row.nombre}"?`)) return
    const supabase = createClient()
    await supabase.from('categorias').update({ deleted_at: new Date().toISOString(), activo: false }).eq('id', row.id)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nueva categoría</ConeButton>
      </div>

      <ConeTable
        data={data}
        columns={[
          { key: 'nombre', label: 'Nombre' },
          { key: 'orden', label: 'Orden' },
          { key: 'activo', label: 'Estado', render: row => <ConeBadge active={row.activo as boolean} /> },
        ]}
        onEdit={openEdit}
        onDelete={handleDelete}
        emptyMessage="Sin categorías — creá la primera"
      />

      <ConeModal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Editar categoría' : 'Nueva categoría'}
        footer={
          <>
            <ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton>
            <ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Helados" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Orden</Label>
            <Input type="number" value={form.orden} onChange={e => setForm({ ...form, orden: Number(e.target.value) })} className="w-24" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="activo" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded" />
            <Label htmlFor="activo" className="cursor-pointer">Activa</Label>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
