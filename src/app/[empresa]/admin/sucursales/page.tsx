'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Store, CreditCard, Banknote, Smartphone, Pencil, Trash2 } from 'lucide-react'

interface Horario { desde: string; hasta: string }
interface DeliveryConfig { activo: boolean; costo_envio: number; horarios: Horario[]; mensaje_fuera_horario: string; pausado?: boolean; mensaje_pausa?: string; tolerancia_cierre?: number }
interface SucursalPagos {
  acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean; acepta_mp_kiosk: boolean; acepta_mp_delivery: boolean
  cbu_transferencia: string | null; titular_transferencia: string | null
  mp_alias?: string | null; mp_public_key?: string | null
}
interface Sucursal {
  id: string; nombre: string; slug: string; direccion: string | null; activo: boolean; pagos?: SucursalPagos; delivery?: DeliveryConfig
}

const emptyPagos = (): SucursalPagos => ({ acepta_efectivo: true, acepta_transferencia: true, acepta_mp: false, acepta_mp_kiosk: true, acepta_mp_delivery: true, cbu_transferencia: '', titular_transferencia: '', mp_alias: '', mp_public_key: '' })
const emptyDelivery = (): DeliveryConfig => ({ activo: false, costo_envio: 0, horarios: [{ desde: '20:00', hasta: '23:59' }], mensaje_fuera_horario: 'El delivery no está disponible en este momento. ¡Volvemos pronto!' })
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
  const [delivery, setDelivery] = useState<DeliveryConfig>(emptyDelivery())

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const { data: suc } = await supabase
      .from('sucursales')
      .select('id, nombre, slug, direccion, activo, sucursal_pagos(acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_kiosk, acepta_mp_delivery, cbu_transferencia, titular_transferencia), delivery_config(activo, costo_envio, horarios, mensaje_fuera_horario, pausado, mensaje_pausa, tolerancia_cierre)')
      .eq('empresa_id', ctx.empresaId).order('nombre')
    setData((suc ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      pagos: Array.isArray(s.sucursal_pagos) ? (s.sucursal_pagos[0] ?? emptyPagos()) : (s.sucursal_pagos ?? emptyPagos()),
      delivery: Array.isArray(s.delivery_config) ? (s.delivery_config[0] ?? emptyDelivery()) : (s.delivery_config ?? emptyDelivery()),
    })) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function slugify(text: string) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  }

  function openNew() { setForm(emptySucursal()); setPagos(emptyPagos()); setDelivery(emptyDelivery()); setEditId(null); setModal(true) }
  function openEdit(s: Sucursal) { setForm({ nombre: s.nombre, slug: s.slug, direccion: s.direccion, activo: s.activo }); setPagos(s.pagos ?? emptyPagos()); setDelivery(s.delivery ?? emptyDelivery()); setEditId(s.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre || !form.slug) return
    setSaving(true)
    const supabase = createClient()
    if (editId) {
      await supabase.from('sucursales').update({ nombre: form.nombre, slug: form.slug, direccion: form.direccion || null, activo: form.activo ?? true }).eq('id', editId)
      await supabase.from('sucursal_pagos').upsert({ sucursal_id: editId, empresa_id: ctx.empresaId, acepta_efectivo: pagos.acepta_efectivo, acepta_transferencia: pagos.acepta_transferencia, acepta_mp: pagos.acepta_mp, acepta_mp_kiosk: pagos.acepta_mp_kiosk, acepta_mp_delivery: pagos.acepta_mp_delivery, cbu_transferencia: pagos.cbu_transferencia || null, titular_transferencia: pagos.titular_transferencia || null }, { onConflict: 'sucursal_id' })
    } else {
      const { data: nueva } = await supabase.from('sucursales').insert({ nombre: form.nombre, slug: form.slug, direccion: form.direccion || null, activo: true, empresa_id: ctx.empresaId }).select('id').single()
      if (nueva) await supabase.from('sucursal_pagos').insert({ sucursal_id: nueva.id, empresa_id: ctx.empresaId, acepta_efectivo: pagos.acepta_efectivo, acepta_transferencia: pagos.acepta_transferencia, acepta_mp: pagos.acepta_mp, acepta_mp_kiosk: pagos.acepta_mp_kiosk, acepta_mp_delivery: pagos.acepta_mp_delivery, cbu_transferencia: pagos.cbu_transferencia || null, titular_transferencia: pagos.titular_transferencia || null })
    }
    // Guardar delivery_config
    const sucursalId = editId ?? null
    if (sucursalId) {
      await supabase.from('delivery_config').upsert({
        sucursal_id: sucursalId, empresa_id: ctx.empresaId,
        activo: delivery.activo, costo_envio: delivery.costo_envio,
        horarios: delivery.horarios, mensaje_fuera_horario: delivery.mensaje_fuera_horario,
        pausado: delivery.pausado ?? false, mensaje_pausa: delivery.mensaje_pausa || null,
        tolerancia_cierre: delivery.tolerancia_cierre ?? 5,
      }, { onConflict: 'sucursal_id' })
    }
    setSaving(false); setModal(false); load()
  }

  async function handleDelete(s: Sucursal) {
    if (!confirm(`¿Eliminar la sucursal "${s.nombre}"? Esta acción no se puede deshacer.`)) return
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_sucursal', { p_id: s.id })
    if (error) {
      alert('No se pudo eliminar: ' + error.message)
      return
    }
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
            {!editId && (
              <div className="space-y-1.5">
                <Label>Slug *</Label>
                <Input value={form.slug ?? ''} onChange={e => setForm({ ...form, slug: slugify(e.target.value) })} placeholder="federal" className="font-mono text-sm" />
              </div>
            )}
            {editId && (
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <div className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl font-mono text-sm text-neutral-400 select-none">{form.slug}</div>
                <p className="text-xs text-neutral-400">El slug no se puede modificar desde acá.</p>
              </div>
            )}
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
              {pagos.acepta_transferencia && <div className="ml-6 space-y-2"><div><Label>CBU / Alias</Label><Input value={pagos.cbu_transferencia ?? ''} onChange={e => setPagos({ ...pagos, cbu_transferencia: e.target.value })} placeholder="tu.alias" className="font-mono text-sm mt-1" /></div><div><Label>Titular de la cuenta</Label><Input value={pagos.titular_transferencia ?? ''} onChange={e => setPagos({ ...pagos, titular_transferencia: e.target.value })} placeholder="Lucía Pérez" className="text-sm mt-1" /></div></div>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2"><input type="checkbox" id="mp" checked={pagos.acepta_mp} onChange={e => setPagos({ ...pagos, acepta_mp: e.target.checked })} className="w-4 h-4 rounded" /><Label htmlFor="mp" className="cursor-pointer flex items-center gap-1.5"><Smartphone className="h-4 w-4 text-neutral-400" /> Mercado Pago</Label></div>
              {pagos.acepta_mp && (
                <div className="ml-6 space-y-2">
                  <p className="text-xs text-neutral-400">La cuenta se conecta desde Configuración → Mercado Pago. Acá elegís dónde se ofrece:</p>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="mp-kiosk" checked={pagos.acepta_mp_kiosk} onChange={e => setPagos({ ...pagos, acepta_mp_kiosk: e.target.checked })} className="w-4 h-4 rounded" />
                    <Label htmlFor="mp-kiosk" className="cursor-pointer text-sm">Habilitar en Kiosk</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="mp-delivery" checked={pagos.acepta_mp_delivery} onChange={e => setPagos({ ...pagos, acepta_mp_delivery: e.target.checked })} className="w-4 h-4 rounded" />
                    <Label htmlFor="mp-delivery" className="cursor-pointer text-sm">Habilitar en Delivery</Label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {editId && (
            <div className="space-y-3 pt-2 border-t border-neutral-100">
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Delivery</p>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="del" checked={delivery.activo} onChange={e => setDelivery({ ...delivery, activo: e.target.checked })} className="w-4 h-4 rounded" />
                <Label htmlFor="del" className="cursor-pointer">Delivery activo</Label>
              </div>
              {delivery.activo && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Costo de envío ($)</Label>
                    <Input type="number" value={delivery.costo_envio} onChange={e => setDelivery({ ...delivery, costo_envio: Number(e.target.value) })} placeholder="4000" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Horarios de delivery</Label>
                      <button type="button" onClick={() => setDelivery({ ...delivery, horarios: [...delivery.horarios, { desde: '20:00', hasta: '23:59' }] })}
                        className="text-xs text-blue-600 font-semibold">+ Agregar franja</button>
                    </div>
                    {delivery.horarios.map((h, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input type="time" value={h.desde} onChange={e => { const hs = [...delivery.horarios]; hs[i] = { ...hs[i], desde: e.target.value }; setDelivery({ ...delivery, horarios: hs }) }} className="flex-1 text-sm" />
                        <span className="text-neutral-400 text-sm">a</span>
                        <Input type="time" value={h.hasta} onChange={e => { const hs = [...delivery.horarios]; hs[i] = { ...hs[i], hasta: e.target.value }; setDelivery({ ...delivery, horarios: hs }) }} className="flex-1 text-sm" />
                        {delivery.horarios.length > 1 && (
                          <button type="button" onClick={() => setDelivery({ ...delivery, horarios: delivery.horarios.filter((_, j) => j !== i) })}
                            className="text-red-400 text-xs font-semibold">✕</button>
                        )}
                      </div>
                    ))}
                    <p className="text-xs text-neutral-400">Para horarios que cruzan la medianoche (ej: 20:00 a 01:00) usá 01:00 como hora de cierre.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mensaje fuera de horario</Label>
                    <textarea value={delivery.mensaje_fuera_horario} onChange={e => setDelivery({ ...delivery, mensaje_fuera_horario: e.target.value })} placeholder="El delivery no está disponible..." rows={3} className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:border-neutral-400 resize-y" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tolerancia de cierre (minutos)</Label>
                    <Input type="number" min={0} max={60} value={delivery.tolerancia_cierre ?? 5} onChange={e => setDelivery({ ...delivery, tolerancia_cierre: Number(e.target.value) })} className="w-28" />
                    <p className="text-xs text-neutral-400">Quien ya está pidiendo puede confirmar hasta estos minutos después del cierre.</p>
                  </div>
                  <div className="pt-2 border-t border-neutral-100 space-y-2">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id="del-pausado" checked={delivery.pausado} onChange={e => setDelivery({ ...delivery, pausado: e.target.checked })} className="w-4 h-4 rounded" />
                      <Label htmlFor="del-pausado" className="cursor-pointer">🌧️ Pausar por mal tiempo</Label>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Mensaje de pausa</Label>
                      <textarea value={delivery.mensaje_pausa ?? ''} onChange={e => setDelivery({ ...delivery, mensaje_pausa: e.target.value })} rows={3} className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:border-neutral-400 resize-y" />
                      <p className="text-xs text-neutral-400">También se puede pausar/reactivar desde la caja con un click.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ConeModal>
    </div>
  )
}
