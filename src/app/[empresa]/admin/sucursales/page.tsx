'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Store, CreditCard, Banknote, Smartphone, Pencil, Trash2 } from 'lucide-react'

interface SucursalPagos {
  acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean
  cbu_transferencia: string | null; mp_access_token: string | null
  mp_alias?: string | null; mp_public_key?: string | null
}
interface Sucursal {
  id: string; nombre: string; slug: string; direccion: string | null; activo: boolean; pagos?: SucursalPagos
}

const emptyPagos = (): SucursalPagos => ({ acepta_efectivo: true, acepta_transferencia: true, acepta_mp: false, cbu_transferencia: '', mp_access_token: '', mp_alias: '', mp_public_key: '' })
const emptySucursal = (): Partial<Sucursal> => ({ nombre: '', slug: '', direccion: '', activo: true })

export default function SucursalesPage() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Sucursal[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Partial<Sucursal>>(emptySucursal())
  const [pagos, setPagos] = useState<SucursalPagos>(emptyPagos())
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const { data: suc } = await supabase
      .from('sucursales')
      .select('id, nombre, slug, direccion, activo, sucursal_pagos(acepta_efectivo, acepta_transferencia, acepta_mp, cbu_transferencia, mp_access_token)')
      .eq('empresa_id', ctx.empresaId).order('nombre')
    setData((suc ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      pagos: Array.isArray(s.sucursal_pagos) ? (s.sucursal_pagos[0] ?? emptyPagos()) : (s.sucursal_pagos ?? emptyPagos()),
    })) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function slugify(text: string) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  }

  function openNew() { setForm(emptySucursal()); setPagos(emptyPagos()); setEditId(null); setModal(true) }
  function openEdit(s: Sucursal) { setForm({ nombre: s.nombre, slug: s.slug, direccion: s.direccion, activo: s.activo }); setPagos(s.pagos ?? emptyPagos()); setEditId(s.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre || !form.slug) return
    setSaving(true)
    const supabase = createClient()
    if (editId) {
      await supabase.from('sucursales').update({ nombre: form.nombre, slug: form.slug, direccion: form.direccion || null, activo: form.activo ?? true }).eq('id', editId)
      await supabase.from('sucursal_pagos').upsert({ sucursal_id: editId, empresa_id: ctx.empresaId, acepta_efectivo: pagos.acepta_efectivo, acepta_transferencia: pagos.acepta_transferencia, acepta_mp: pagos.acepta_mp, cbu_transferencia: pagos.cbu_transferencia || null, mp_access_token: pagos.mp_access_token || null }, { onConflict: 'sucursal_id' })
    } else {
      const { data: nueva } = await supabase.from('sucursales').insert({ nombre: form.nombre, slug: form.slug, direccion: form.direccion || null, activo: true, empresa_id: ctx.empresaId }).select('id').single()
      if (nueva) await supabase.from('sucursal_pagos').insert({ sucursal_id: nueva.id, empresa_id: ctx.empresaId, acepta_efectivo: pagos.acepta_efectivo, acepta_transferencia: pagos.acepta_transferencia, acepta_mp: pagos.acepta_mp, cbu_transferencia: pagos.cbu_transferencia || null, mp_access_token: pagos.mp_access_token || null })
    }
    setSaving(false); setModal(false); load()
  }

  async function handleDelete(s: Sucursal) {
    if (!confirm(`¿Eliminar la sucursal "${s.nombre}"? Esta acción no se puede deshacer.`)) return
    const supabase = createClient()
    await supabase.from('sucursal_pagos').delete().eq('sucursal_id', s.id)
    await supabase.from('sucursales').delete().eq('id', s.id)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div>
      <ConePageHeader title="Sucursales" description="Gestión de sucursales y métodos de pago" action={{ label: 'Nueva sucursal', onClick: openNew }} />

      <div className="space-y-3">
        {data.length === 0 && (
          <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin sucursales — creá la primera</div>
        )}
        {data.map(s => (
          <div key={s.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center">
                  <Store className="h-5 w-5 text-neutral-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-neutral-900">{s.nombre}</span>
                    <span className="text-xs font-mono text-neutral-400">/{s.slug}</span>
                    <ConeBadge active={s.activo} />
                  </div>
                  {s.direccion && <p className="text-xs text-neutral-400 mt-0.5">{s.direccion}</p>}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {s.pagos?.acepta_efectivo && <span className="flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full"><Banknote className="h-3 w-3" /> Efectivo</span>}
                    {s.pagos?.acepta_transferencia && <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full"><CreditCard className="h-3 w-3" /> Transferencia</span>}
                    {s.pagos?.acepta_mp && <span className="flex items-center gap-1 text-xs bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full"><Smartphone className="h-3 w-3" /> MP</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(s)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(s)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConeModal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar sucursal' : 'Nueva sucursal'}
        footer={<><ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton><ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Datos de la sucursal</p>
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={form.nombre ?? ''} onChange={e => { const nombre = e.target.value; setForm({ ...form, nombre, slug: editId ? form.slug : slugify(nombre) }) }} placeholder="Federal" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Slug *</Label>
              <Input value={form.slug ?? ''} onChange={e => setForm({ ...form, slug: slugify(e.target.value) })} placeholder="federal" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Dirección</Label>
              <Input value={form.direccion ?? ''} onChange={e => setForm({ ...form, direccion: e.target.value })} placeholder="Av. San Martín 123" />
            </div>
          </div>
          <div className="space-y-3 pt-2 border-t border-neutral-100">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Métodos de pago</p>
            <div className="flex items-center gap-2"><input type="checkbox" id="ef" checked={pagos.acepta_efectivo} onChange={e => setPagos({ ...pagos, acepta_efectivo: e.target.checked })} className="w-4 h-4 rounded" /><Label htmlFor="ef" className="cursor-pointer flex items-center gap-1.5"><Banknote className="h-4 w-4 text-neutral-400" /> Efectivo</Label></div>
            <div className="space-y-2">
              <div className="flex items-center gap-2"><input type="checkbox" id="tr" checked={pagos.acepta_transferencia} onChange={e => setPagos({ ...pagos, acepta_transferencia: e.target.checked })} className="w-4 h-4 rounded" /><Label htmlFor="tr" className="cursor-pointer flex items-center gap-1.5"><CreditCard className="h-4 w-4 text-neutral-400" /> Transferencia</Label></div>
              {pagos.acepta_transferencia && <div className="ml-6"><Label>CBU / Alias</Label><Input value={pagos.cbu_transferencia ?? ''} onChange={e => setPagos({ ...pagos, cbu_transferencia: e.target.value })} placeholder="cecchetto.helados" className="font-mono text-sm mt-1" /></div>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2"><input type="checkbox" id="mp" checked={pagos.acepta_mp} onChange={e => setPagos({ ...pagos, acepta_mp: e.target.checked })} className="w-4 h-4 rounded" /><Label htmlFor="mp" className="cursor-pointer flex items-center gap-1.5"><Smartphone className="h-4 w-4 text-neutral-400" /> Mercado Pago</Label></div>
              {pagos.acepta_mp && (
                <div className="ml-6 space-y-3">
                  <div className="p-3 bg-sky-50 border border-sky-100 rounded-xl"><p className="text-xs text-sky-700">Integración MP disponible próximamente. Podés pre-cargar los datos.</p></div>
                  <div className="space-y-1.5"><Label>Access Token</Label><Input value={pagos.mp_access_token ?? ''} onChange={e => setPagos({ ...pagos, mp_access_token: e.target.value })} placeholder="APP_USR-..." type="password" /></div>
                  <div className="space-y-1.5"><Label>Public Key</Label><Input value={pagos.mp_public_key ?? ''} onChange={e => setPagos({ ...pagos, mp_public_key: e.target.value })} placeholder="APP_USR-..." /></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
