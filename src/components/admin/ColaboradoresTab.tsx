'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Pencil } from 'lucide-react'

// REPARTO V1: el cadete gana PUERTA — sucursal (null = todas) + PIN de 4
// dígitos hasheado en Postgres (RPC set_pin_colaborador, mismo bcrypt que
// operadores). El PIN JAMÁS se lee ni se muestra: solo se setea/cambia.
interface Colaborador { id: string; nombre: string; rol: string; activo: boolean; sucursal_id: string | null; pin_cargado?: boolean }
interface Sucursal { id: string; nombre: string }

const ROLES = [
  { value: 'cadete', label: '🛵 Cadete' },
  { value: 'mozo', label: '🍽️ Mozo' },
]

export default function ColaboradoresTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Colaborador[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ nombre: '', rol: 'cadete', sucursal_id: 'todas', pin: '' })
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: rows }, { data: sucs }] = await Promise.all([
      supabase.from('colaboradores')
        .select('id, nombre, rol, activo, sucursal_id, pin_hash')
        .eq('empresa_id', ctx.empresaId)
        .order('nombre'),
      supabase.from('sucursales').select('id, nombre').eq('empresa_id', ctx.empresaId).order('nombre'),
    ])
    // pin_hash no viaja al estado: solo el boolean (write-only)
    setData((rows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id, nombre: r.nombre, rol: r.rol, activo: r.activo,
      sucursal_id: r.sucursal_id ?? null, pin_cargado: !!r.pin_hash,
    })) as Colaborador[])
    setSucursales((sucs ?? []) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm({ nombre: '', rol: 'cadete', sucursal_id: 'todas', pin: '' }); setEditId(null); setModal(true) }
  function openEdit(row: Colaborador) { setForm({ nombre: row.nombre, rol: row.rol, sucursal_id: row.sucursal_id ?? 'todas', pin: '' }); setEditId(row.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre.trim()) return
    if (form.pin && !/^\d{4}$/.test(form.pin)) { alert('El PIN debe ser de 4 dígitos numéricos.'); return }
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: form.nombre.trim(), rol: form.rol, sucursal_id: form.sucursal_id === 'todas' ? null : form.sucursal_id }
    let id = editId
    if (editId) {
      await supabase.from('colaboradores').update(payload).eq('id', editId)
    } else {
      const { data: nuevo } = await supabase.from('colaboradores')
        .insert({ ...payload, empresa_id: ctx.empresaId }).select('id').single()
      id = nuevo?.id ?? null
    }
    // PIN: vacío = no pisar; con valor → hash EN POSTGRES (jamás plano)
    if (form.pin && id) {
      const { error: ePin } = await supabase.rpc('set_pin_colaborador', {
        p_colaborador: id, p_empresa: ctx.empresaId, p_pin: form.pin,
      })
      if (ePin) alert(`Colaborador guardado, pero el PIN no se pudo setear: ${ePin.message}`)
    }
    setSaving(false); setModal(false); load()
  }

  async function toggleActivo(row: Colaborador) {
    const supabase = createClient()
    const { error, data: upd } = await supabase.from('colaboradores')
      .update({ activo: !row.activo }).eq('id', row.id).select('id')
    if (error) { alert(`No se pudo actualizar: ${error.message}`); return }
    if (!upd || upd.length === 0) { alert('No se pudo actualizar (sin permisos o fila no encontrada). Probá recargar la página y reintentá.'); return }
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
          <div key={row.id} className={`bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm ${!row.activo ? "opacity-55 grayscale" : ""}`}>
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
                <span className={`text-xs font-semibold mt-0.5 ${row.activo ? 'text-green-600' : 'text-neutral-400'}`}>
                  {row.activo ? '● Activo' : '○ Inactivo'}
                  {row.rol === 'cadete' && <span className="text-neutral-400 font-normal"> · {sucursales.find(su => su.id === row.sucursal_id)?.nombre ?? 'Todas las sucursales'} · PIN {row.pin_cargado ? '✓' : '✗ sin cargar'}</span>}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleActivo(row)} title={row.activo ? 'Desactivar' : 'Activar'}
                className={`relative w-11 h-6 rounded-full transition-colors ${row.activo ? 'bg-green-500' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${row.activo ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              <button onClick={() => openEdit(row)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <ConeModal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar colaborador' : 'Nuevo colaborador'}
        footer={<><ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton><ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="María García" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Sucursal</Label>
            <select value={form.sucursal_id} onChange={e => setForm({ ...form, sucursal_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
              <option value="todas">Todas las sucursales</option>
              {sucursales.map(su => <option key={su.id} value={su.id}>{su.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>PIN de reparto (4 dígitos){editId ? ' — dejá vacío para conservar el actual' : ''}</Label>
            <Input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              placeholder="1234" inputMode="numeric" type="password" autoComplete="new-password" />
            <p className="text-[11px] text-neutral-400">Con este PIN el cadete entra a su app de reparto. Se guarda cifrado y no se puede volver a ver — solo cambiar.</p>
          </div>
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
