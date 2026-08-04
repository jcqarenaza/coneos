'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeTable, ConeModal, ConeButton, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2 } from 'lucide-react'

interface Producto { id: string; nombre: string }
interface Presentacion {
  id: string
  nombre: string
  precio: number
  producto_id: string
  producto_nombre?: string
  permite_opciones: boolean
  opciones_min: number
  opciones_max: number
  orden: number
  activo: boolean
  [key: string]: unknown
}

const empty = (): Partial<Presentacion> => ({
  nombre: '', precio: 0, producto_id: '', permite_opciones: true,
  opciones_min: 1, opciones_max: 4, orden: 0, activo: true
})

export default function PresentacionesTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Presentacion[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Partial<Presentacion>>(empty())
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: pres }, { data: prods }] = await Promise.all([
      supabase.from('presentaciones')
        .select('id, nombre, precio, producto_id, permite_opciones, opciones_min, opciones_max, orden, activo, productos(nombre)')
        .eq('empresa_id', ctx.empresaId)
        .order('orden'),
      supabase.from('productos')
        .select('id, nombre')
        .eq('empresa_id', ctx.empresaId)
        .eq('activo', true)
        .is('deleted_at', null)
        .order('nombre'),
    ])
    setData((pres ?? []).map((p: Record<string, unknown>) => ({
      ...p,
      producto_nombre: (p.productos as { nombre: string } | null)?.nombre ?? '',
    })) as Presentacion[])
    setProductos((prods ?? []) as Producto[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm(empty()); setEditId(null); setModal(true) }
  function openEdit(row: Presentacion) { setForm(row); setEditId(row.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre || !form.producto_id) return
    setSaving(true)
    const supabase = createClient()
    const payload = {
      nombre: form.nombre,
      precio: form.precio ?? 0,
      producto_id: form.producto_id,
      permite_opciones: form.permite_opciones ?? true,
      opciones_min: form.opciones_min ?? 1,
      opciones_max: form.opciones_max ?? 4,
      orden: form.orden ?? 0,
      activo: form.activo ?? true,
      empresa_id: ctx.empresaId,
    }
    if (editId) {
      await supabase.from('presentaciones').update(payload).eq('id', editId)
    } else {
      await supabase.from('presentaciones').insert(payload)
    }
    setSaving(false)
    setModal(false)
    load()
  }

  async function handleDelete(row: Presentacion) {
    if (!confirm(`¿Eliminar "${row.nombre}"?`)) return
    const supabase = createClient()
    await supabase.from('presentaciones').update({ activo: false }).eq('id', row.id)
    load()
  }

  const formatPrecio = (n: number) => `$${Number(n).toLocaleString('es-AR')}`

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nueva presentación</ConeButton>
      </div>

      <ConeTable
        data={data}
        columns={[
          { key: 'producto_nombre', label: 'Producto' },
          { key: 'nombre', label: 'Presentación' },
          { key: 'precio', label: 'Precio', render: row => formatPrecio(row.precio as number) },
          { key: 'permite_opciones', label: 'Opciones', render: row => row.permite_opciones ? `${row.opciones_min}–${row.opciones_max} sabores` : 'Sin opciones' },
          { key: 'activo', label: 'Estado', render: row => <ConeBadge active={row.activo as boolean} /> },
        ]}
        onEdit={openEdit}
        onDelete={handleDelete}
        emptyMessage="Sin presentaciones — creá la primera"
      />

      <ConeModal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Editar presentación' : 'Nueva presentación'}
        footer={
          <>
            <ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton>
            <ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Producto *</Label>
            <Select value={form.producto_id ?? ''} onValueChange={v => setForm({ ...form, producto_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná un producto" /></SelectTrigger>
              <SelectContent>
                {productos.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={form.nombre ?? ''} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="1/2 Kg" />
            </div>
            <div className="space-y-1.5">
              <Label>Precio *</Label>
              <Input type="number" value={form.precio ?? 0} onChange={e => setForm({ ...form, precio: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="permite" checked={form.permite_opciones ?? true} onChange={e => setForm({ ...form, permite_opciones: e.target.checked })} className="w-4 h-4 rounded" />
            <Label htmlFor="permite" className="cursor-pointer">Permite elegir sabores</Label>
          </div>
          {form.permite_opciones && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Mínimo de sabores</Label>
                <Input type="number" min={1} value={form.opciones_min ?? 1} onChange={e => setForm({ ...form, opciones_min: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Máximo de sabores</Label>
                <Input type="number" min={1} value={form.opciones_max ?? 4} onChange={e => setForm({ ...form, opciones_max: Number(e.target.value) })} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Orden</Label>
            <Input type="number" value={form.orden ?? 0} onChange={e => setForm({ ...form, orden: Number(e.target.value) })} className="w-24" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="activoP" checked={form.activo ?? true} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded" />
            <Label htmlFor="activoP" className="cursor-pointer">Activa</Label>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
