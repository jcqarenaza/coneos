'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react'

interface Colaborador { id: string; nombre: string; rol: string; activo: boolean }

const ROLES = [
  { value: 'cadete', label: '🛵 Cadete' },
  { value: 'otro',   label: '👤 Otro' },
]

export default function ColaboradoresTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Colaborador[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ nombre: '', rol: 'cadete' })
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const { data: rows } = await supabase.from('colaboradores')
      .select('id, nombre, rol, activo')
      .eq('empresa_id', ctx.empresaId)
      .order('nombre')
    setData((rows ?? []) as Colaborador[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm({ nombre: '', rol: 'cadete' }); setEditId(null); setModal(true) }
  function openEdit(row: Colaborador) { setForm({ nombre: row.nombre, rol: row.rol }); setEditId(row.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre.trim()) return
    setSaving(true)
    const supabase = createClient()
    if (editId) {
      await supabase.from('colaboradores').update({ nombre: form.nombre, rol: form.rol }).eq('id', editId)
    } else {
      await supabase.from('colaboradores').insert({ nombre: form.nombre, rol: form.rol, empresa_id: ctx.empresaId })
    }
    setSaving(false); setModal(false); load()
  }

  async function toggleActivo(row: Colaborador) {
    const supabase = createClient()
    await supabase.from('colaboradores').update({ activo: !row.activo }).eq('id', row.id)
    load()
  }

  async function handleDelete(row: Colaborador) {
    if (!confirm(`¿Eliminar a "${row.nombre}"?`)) return
    const supabase = createClient()
    await supabase.from('colaboradores').delete().eq('id', row.id)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo colaborador</ConeButton>
      </div>
      <div className="space-y-2">
        {data.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin colaboradores</div>}
        {data.map(row => (
          <div key={row.id} className="bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-xl">
                {row.rol === 'cadete' ? '🛵' : '👤'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-900">{row.nombre}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-600">
                    {ROLES.find(r => r.value === row.rol)?.label ?? row.rol}
                  </span>
                </div>
                <button onClick={() => toggleActivo(row)}
                  className={`text-xs font-semibold mt-0.5 ${row.activo ? 'text-green-600' : 'text-neutral-400'}`}>
                  {row.activo ? '● Activo' : '○ Inactivo'}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => openEdit(row)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(row)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <ConeModal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar colaborador' : 'Nuevo colaborador'}
        footer={<><ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton><ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="María García" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Rol *</Label>
            <div className="flex gap-2">
              {ROLES.map(r => (
                <button key={r.value} type="button" onClick={() => setForm({ ...form, rol: r.value })}
                  className={`flex-1 py-3 rounded-xl border text-sm font-semibold transition-colors ${form.rol === r.value ? 'border-neutral-800 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
