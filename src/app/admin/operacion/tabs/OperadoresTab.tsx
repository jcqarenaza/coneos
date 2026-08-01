'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeTable, ConeModal, ConeButton, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2, Eye, EyeOff } from 'lucide-react'

interface Sucursal { id: string; nombre: string }
interface Operador {
  id: string
  nombre: string
  sucursal_id: string | null
  sucursal_nombre?: string
  puede_cobrar: boolean
  puede_preparar: boolean
  activo: boolean
  [key: string]: unknown
}

const emptyForm = () => ({
  nombre: '',
  sucursal_id: '' as string | null,
  puede_cobrar: true,
  puede_preparar: true,
  activo: true,
  pin: '',
  pin_confirm: '',
})

export default function OperadoresTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Operador[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [showPin, setShowPin] = useState(false)
  const [pinError, setPinError] = useState('')

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: ops }, { data: suc }] = await Promise.all([
      supabase.from('operadores')
        .select('id, nombre, sucursal_id, puede_cobrar, puede_preparar, activo, sucursales(nombre)')
        .eq('empresa_id', ctx.empresaId)
        .order('nombre'),
      supabase.from('sucursales')
        .select('id, nombre')
        .eq('empresa_id', ctx.empresaId)
        .eq('activo', true)
        .order('nombre'),
    ])
    setData((ops ?? []).map((o: Record<string, unknown>) => ({
      ...o,
      sucursal_nombre: (o.sucursales as { nombre: string } | null)?.nombre ?? 'Todas',
    })) as Operador[])
    setSucursales((suc ?? []) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm(emptyForm()); setEditId(null); setPinError(''); setModal(true) }
  function openEdit(row: Operador) {
    setForm({ ...emptyForm(), nombre: row.nombre, sucursal_id: row.sucursal_id, puede_cobrar: row.puede_cobrar, puede_preparar: row.puede_preparar, activo: row.activo })
    setEditId(row.id)
    setPinError('')
    setModal(true)
  }

  async function handleSave() {
    if (!ctx || !form.nombre) return
    setPinError('')

    // Validar PIN solo en creación o si se ingresó uno nuevo
    if (!editId || form.pin) {
      if (form.pin.length !== 4 || !/^\d{4}$/.test(form.pin)) {
        setPinError('El PIN debe ser exactamente 4 dígitos numéricos')
        return
      }
      if (form.pin !== form.pin_confirm) {
        setPinError('Los PINs no coinciden')
        return
      }
    }

    setSaving(true)
    const supabase = createClient()

    // Hashear PIN via API route
    let pin_hash = 'PENDIENTE'
    if (!editId || form.pin) {
      const res = await fetch('/api/operador/hash-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: form.pin }),
      })
      const json = await res.json()
      pin_hash = json.hash
    }

    const payload: Record<string, unknown> = {
      nombre: form.nombre,
      sucursal_id: form.sucursal_id || null,
      puede_cobrar: form.puede_cobrar,
      puede_preparar: form.puede_preparar,
      activo: form.activo,
      empresa_id: ctx.empresaId,
    }
    if (!editId || form.pin) payload.pin_hash = pin_hash

    if (editId) {
      await supabase.from('operadores').update(payload).eq('id', editId)
    } else {
      await supabase.from('operadores').insert(payload)
    }

    setSaving(false)
    setModal(false)
    load()
  }

  async function handleDelete(row: Operador) {
    if (!confirm(`¿Desactivar a "${row.nombre}"?`)) return
    const supabase = createClient()
    await supabase.from('operadores').update({ activo: false }).eq('id', row.id)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo operador</ConeButton>
      </div>

      <ConeTable
        data={data}
        columns={[
          { key: 'nombre', label: 'Nombre' },
          { key: 'sucursal_nombre', label: 'Sucursal' },
          {
            key: 'roles', label: 'Permisos',
            render: row => (
              <div className="flex gap-1">
                {row.puede_cobrar && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Caja</span>}
                {row.puede_preparar && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">Preparación</span>}
              </div>
            )
          },
          { key: 'activo', label: 'Estado', render: row => <ConeBadge active={row.activo as boolean} /> },
        ]}
        onEdit={openEdit}
        onDelete={handleDelete}
        emptyMessage="Sin operadores — creá el primero"
      />

      <ConeModal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Editar operador' : 'Nuevo operador'}
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
            <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="María" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label>Sucursal</Label>
            <Select value={form.sucursal_id ?? 'todas'} onValueChange={v => setForm({ ...form, sucursal_id: v === 'todas' ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Todas las sucursales" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las sucursales</SelectItem>
                {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-neutral-400">Dejá vacío para que pueda operar en cualquier sucursal</p>
          </div>

          {/* Permisos */}
          <div className="space-y-2">
            <Label>Permisos</Label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="cobrar" checked={form.puede_cobrar} onChange={e => setForm({ ...form, puede_cobrar: e.target.checked })} className="w-4 h-4 rounded" />
                <Label htmlFor="cobrar" className="cursor-pointer font-normal">
                  <span className="text-blue-700 font-medium">Caja</span> — puede gestionar pagos y confirmar pedidos
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="preparar" checked={form.puede_preparar} onChange={e => setForm({ ...form, puede_preparar: e.target.checked })} className="w-4 h-4 rounded" />
                <Label htmlFor="preparar" className="cursor-pointer font-normal">
                  <span className="text-amber-700 font-medium">Preparación</span> — puede ver y preparar pedidos
                </Label>
              </div>
            </div>
          </div>

          {/* PIN */}
          <div className="space-y-2 pt-2 border-t border-neutral-100">
            <Label>{editId ? 'Cambiar PIN (dejá vacío para mantener el actual)' : 'PIN de acceso *'}</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-neutral-400">PIN (4 dígitos)</Label>
                <div className="relative">
                  <Input
                    type={showPin ? 'text' : 'password'}
                    value={form.pin}
                    onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    placeholder="••••"
                    maxLength={4}
                    className="font-mono tracking-widest pr-8"
                  />
                  <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400">
                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-neutral-400">Confirmar PIN</Label>
                <Input
                  type={showPin ? 'text' : 'password'}
                  value={form.pin_confirm}
                  onChange={e => setForm({ ...form, pin_confirm: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder="••••"
                  maxLength={4}
                  className="font-mono tracking-widest"
                />
              </div>
            </div>
            {pinError && <p className="text-xs text-red-500">{pinError}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="activoOp" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded" />
            <Label htmlFor="activoOp" className="cursor-pointer">Operador activo</Label>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
