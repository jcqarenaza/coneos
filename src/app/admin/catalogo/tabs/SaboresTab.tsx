'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeTable, ConeModal, ConeButton, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2 } from 'lucide-react'

interface Grupo { id: string; nombre: string }
interface Opcion {
  id: string
  nombre: string
  descripcion: string | null
  color: string | null
  emoji: string | null
  grupo_id: string
  grupo_nombre?: string
  orden: number
  activo: boolean
  [key: string]: unknown
}

const emptyOpcion = (): Partial<Opcion> => ({
  nombre: '', descripcion: '', color: '#000000', emoji: '', grupo_id: '', orden: 0, activo: true
})

export default function SaboresTab() {
  const { ctx } = useEmpresa()
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [grupoModal, setGrupoModal] = useState(false)
  const [form, setForm] = useState<Partial<Opcion>>(emptyOpcion())
  const [grupoNombre, setGrupoNombre] = useState('')
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [filtroGrupo, setFiltroGrupo] = useState('todos')

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: ops }, { data: grps }] = await Promise.all([
      supabase.from('opciones')
        .select('id, nombre, descripcion, color, emoji, grupo_id, orden, activo, grupos_opciones(nombre)')
        .eq('empresa_id', ctx.empresaId)
        .is('deleted_at', null)
        .order('orden'),
      supabase.from('grupos_opciones')
        .select('id, nombre')
        .eq('empresa_id', ctx.empresaId)
        .eq('activo', true)
        .order('nombre'),
    ])
    setOpciones((ops ?? []).map((o: Record<string, unknown>) => ({
      ...o,
      grupo_nombre: (o.grupos_opciones as { nombre: string } | null)?.nombre ?? '',
    })) as Opcion[])
    setGrupos((grps ?? []) as Grupo[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm(emptyOpcion()); setEditId(null); setModal(true) }
  function openEdit(row: Opcion) { setForm(row); setEditId(row.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre || !form.grupo_id) return
    setSaving(true)
    const supabase = createClient()
    const payload = {
      nombre: form.nombre,
      descripcion: form.descripcion || null,
      color: form.color || null,
      emoji: form.emoji || null,
      grupo_id: form.grupo_id,
      orden: form.orden ?? 0,
      activo: form.activo ?? true,
      empresa_id: ctx.empresaId,
    }
    if (editId) {
      await supabase.from('opciones').update(payload).eq('id', editId)
    } else {
      await supabase.from('opciones').insert(payload)
    }
    setSaving(false)
    setModal(false)
    load()
  }

  async function handleSaveGrupo() {
    if (!ctx || !grupoNombre) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('grupos_opciones').insert({ nombre: grupoNombre, empresa_id: ctx.empresaId })
    setGrupoNombre('')
    setSaving(false)
    setGrupoModal(false)
    load()
  }

  async function handleDelete(row: Opcion) {
    if (!confirm(`¿Eliminar "${row.nombre}"?`)) return
    const supabase = createClient()
    await supabase.from('opciones').update({ deleted_at: new Date().toISOString(), activo: false }).eq('id', row.id)
    load()
  }

  const filtrados = filtroGrupo === 'todos' ? opciones : opciones.filter(o => o.grupo_id === filtroGrupo)

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Todos los grupos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los grupos</SelectItem>
              {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <ConeButton variant="outline" onClick={() => setGrupoModal(true)} icon={<Plus className="h-4 w-4" />}>
            Nuevo grupo
          </ConeButton>
          <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo sabor</ConeButton>
        </div>
      </div>

      <ConeTable
        data={filtrados}
        columns={[
          { key: 'emoji', label: '', render: row => <span className="text-xl">{row.emoji as string || '🍦'}</span> },
          { key: 'nombre', label: 'Sabor' },
          { key: 'descripcion', label: 'Descripción', render: row => <span className="text-neutral-400 text-xs">{row.descripcion as string || '—'}</span> },
          { key: 'grupo_nombre', label: 'Grupo' },
          { key: 'color', label: 'Color', render: row => row.color ? (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full border border-neutral-200" style={{ backgroundColor: row.color as string }} />
              <span className="text-xs font-mono text-neutral-400">{row.color as string}</span>
            </div>
          ) : <span className="text-neutral-300">—</span> },
          { key: 'activo', label: 'Estado', render: row => <ConeBadge active={row.activo as boolean} /> },
        ]}
        onEdit={openEdit}
        onDelete={handleDelete}
        emptyMessage="Sin sabores — creá el primero"
      />

      {/* Modal nuevo sabor */}
      <ConeModal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Editar sabor' : 'Nuevo sabor'}
        footer={
          <>
            <ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton>
            <ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Grupo *</Label>
            <Select value={form.grupo_id ?? ''} onValueChange={v => setForm({ ...form, grupo_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná un grupo" /></SelectTrigger>
              <SelectContent>
                {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={form.nombre ?? ''} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Dulce de leche" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Emoji</Label>
              <Input value={form.emoji ?? ''} onChange={e => setForm({ ...form, emoji: e.target.value })} placeholder="🍦" className="text-center text-lg" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Input value={form.descripcion ?? ''} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Descripción para el kiosk" />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2 items-center">
              <input type="color" value={form.color ?? '#000000'} onChange={e => setForm({ ...form, color: e.target.value })} className="w-10 h-10 rounded cursor-pointer border border-neutral-200" />
              <Input value={form.color ?? ''} onChange={e => setForm({ ...form, color: e.target.value })} className="font-mono text-sm" maxLength={7} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Orden</Label>
              <Input type="number" value={form.orden ?? 0} onChange={e => setForm({ ...form, orden: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="activoS" checked={form.activo ?? true} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded" />
            <Label htmlFor="activoS" className="cursor-pointer">Activo</Label>
          </div>
        </div>
      </ConeModal>

      {/* Modal nuevo grupo */}
      <ConeModal
        open={grupoModal}
        onClose={() => setGrupoModal(false)}
        title="Nuevo grupo de opciones"
        footer={
          <>
            <ConeButton variant="outline" onClick={() => setGrupoModal(false)}>Cancelar</ConeButton>
            <ConeButton onClick={handleSaveGrupo} loading={saving}>Crear grupo</ConeButton>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label>Nombre del grupo *</Label>
          <Input value={grupoNombre} onChange={e => setGrupoNombre(e.target.value)} placeholder="Sabores, Coberturas, Extras..." autoFocus />
        </div>
      </ConeModal>
    </div>
  )
}
