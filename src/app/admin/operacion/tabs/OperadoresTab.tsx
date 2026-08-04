'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react'

interface Sucursal { id: string; nombre: string }
interface Operador {
  id: string; nombre: string; sucursal_id: string | null; sucursal_nombre?: string
  puede_cobrar: boolean; puede_preparar: boolean; activo: boolean
}

export default function OperadoresTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Operador[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ nombre: '', sucursal_id: 'todas', pin: '', puede_cobrar: true, puede_preparar: true })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: ops }, { data: suc }] = await Promise.all([
      supabase.from('operadores').select('id, nombre, sucursal_id, puede_cobrar, puede_preparar, activo, sucursales(nombre)').eq('empresa_id', ctx.empresaId).order('nombre'),
      supabase.from('sucursales').select('id, nombre').eq('empresa_id', ctx.empresaId).eq('activo', true).order('nombre'),
    ])
    setData((ops ?? []).map((o: Record<string, unknown>) => ({ ...o, sucursal_nombre: (o.sucursales as { nombre: string } | null)?.nombre ?? 'Todas' })) as Operador[])
    setSucursales((suc ?? []) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm({ nombre: '', sucursal_id: 'todas', pin: '', puede_cobrar: true, puede_preparar: true }); setEditId(null); setModal(true) }
  function openEdit(op: Operador) { setForm({ nombre: op.nombre, sucursal_id: op.sucursal_id ?? 'todas', pin: '', puede_cobrar: op.puede_cobrar, puede_preparar: op.puede_preparar }); setEditId(op.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre) return
    setSaving(true)
    const supabase = createClient()
    let pin_hash = undefined
    if (form.pin) {
      const res = await fetch('/api/operador/hash-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: form.pin }) })
      const data = await res.json()
      pin_hash = data.hash
    }
    const payload: Record<string, unknown> = {
      nombre: form.nombre,
      sucursal_id: form.sucursal_id === 'todas' ? null : form.sucursal_id,
      puede_cobrar: form.puede_cobrar, puede_preparar: form.puede_preparar,
    }
    if (pin_hash) payload.pin_hash = pin_hash
    if (editId) { await supabase.from('operadores').update(payload).eq('id', editId) }
    else { await supabase.from('operadores').insert({ ...payload, empresa_id: ctx.empresaId, activo: true }) }
    setSaving(false); setModal(false); load()
  }

  async function toggleActivo(op: Operador) {
    const supabase = createClient()
    await supabase.from('operadores').update({ activo: !op.activo }).eq('id', op.id)
    load()
  }

  async function handleDelete(op: Operador) {
    if (!confirm(`¿Eliminar al operador "${op.nombre}"?`)) return
    const supabase = createClient()
    await supabase.from('operadores').delete().eq('id', op.id)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo operador</ConeButton>
      </div>

      <div className="space-y-2">
        {data.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin operadores</div>}
        {data.map(op => (
          <div key={op.id} className="bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neutral-800 flex items-center justify-center text-white font-bold">{op.nombre[0].toUpperCase()}</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-900">{op.nombre}</span>
                  <ConeBadge active={op.activo} />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-neutral-400">{op.sucursal_nombre ?? 'Todas'}</span>
                  {op.puede_cobrar && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">Caja</span>}
                  {op.puede_preparar && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">Preparación</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleActivo(op)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${op.activo ? 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                {op.activo ? 'Desactivar' : 'Activar'}
              </button>
              <button onClick={() => openEdit(op)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(op)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <ConeModal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar operador' : 'Nuevo operador'}
        footer={<><ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton><ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="María" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Sucursal</Label>
            <Select value={form.sucursal_id} onValueChange={v => setForm({ ...form, sucursal_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las sucursales</SelectItem>
                {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{editId ? 'Nuevo PIN (dejá vacío para no cambiar)' : 'PIN *'}</Label>
            <Input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value })} type="password" maxLength={4} placeholder="4 dígitos" />
          </div>
          <div className="space-y-2">
            <Label>Permisos</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.puede_cobrar} onChange={e => setForm({ ...form, puede_cobrar: e.target.checked })} className="w-4 h-4 rounded" />
                <span className="text-sm text-neutral-700">Caja</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.puede_preparar} onChange={e => setForm({ ...form, puede_preparar: e.target.checked })} className="w-4 h-4 rounded" />
                <span className="text-sm text-neutral-700">Preparación</span>
              </label>
            </div>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
