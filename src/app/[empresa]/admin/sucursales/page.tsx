'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2, Store, CreditCard, Banknote, Smartphone, Pencil, Trash2 } from 'lucide-react'

interface Horario { desde: string; hasta: string }
// CICLO A — techo de la sucursal (null = sin restricción)

interface DeliveryConfig { activo: boolean; costo_envio: number; horarios: Horario[]; mensaje_fuera_horario: string; pausado?: boolean; mensaje_pausa?: string; tolerancia_cierre?: number }
interface TakeawayConfig { activo: boolean; horarios: Horario[]; mensaje_fuera_horario: string; tolerancia_cierre?: number }
interface SucursalPagos {
  acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean; acepta_mp_kiosk: boolean; acepta_mp_delivery: boolean; acepta_mp_mesa: boolean; acepta_mp_takeaway: boolean
  // F-C: llaves por canal para efectivo y transferencia (espejo del modelo MP)
  acepta_efectivo_kiosk: boolean; acepta_efectivo_delivery: boolean; acepta_efectivo_mesa: boolean; acepta_efectivo_takeaway: boolean
  acepta_transferencia_kiosk: boolean; acepta_transferencia_delivery: boolean; acepta_transferencia_mesa: boolean; acepta_transferencia_takeaway: boolean
  cbu_transferencia: string | null; titular_transferencia: string | null
  mp_alias?: string | null; mp_public_key?: string | null
}
interface Sucursal {
  id: string; nombre: string; slug: string; direccion: string | null; activo: boolean; rubro?: string; pagos?: SucursalPagos; delivery?: DeliveryConfig; takeaway?: TakeawayConfig
}

const RUBROS: [string, string][] = [
  ['HELADERIA', '🍦 Heladería'], ['HAMBURGUESERIA', '🍔 Hamburguesería'], ['RESTAURANTE', '🍝 Restaurante'],
  ['BAR', '🍺 Bar'], ['PIZZERIA', '🍕 Pizzería'], ['SUSHI', '🍣 Sushi'],
  ['CAFETERIA', '☕ Cafetería'], ['PARRILLA', '🥩 Parrilla'], ['OTRO', '🏪 Otro'],
]

const emptyPagos = (): SucursalPagos => ({ acepta_efectivo: true, acepta_transferencia: true, acepta_mp: false, acepta_mp_kiosk: true, acepta_mp_delivery: true, acepta_mp_mesa: true, acepta_mp_takeaway: true, acepta_efectivo_kiosk: true, acepta_efectivo_delivery: true, acepta_efectivo_mesa: true, acepta_efectivo_takeaway: true, acepta_transferencia_kiosk: true, acepta_transferencia_delivery: true, acepta_transferencia_mesa: true, acepta_transferencia_takeaway: true, cbu_transferencia: '', titular_transferencia: '', mp_alias: '', mp_public_key: '' })
const emptyDelivery = (): DeliveryConfig => ({ activo: false, costo_envio: 0, horarios: [{ desde: '20:00', hasta: '23:59' }], mensaje_fuera_horario: 'El delivery no está disponible en este momento. ¡Volvemos pronto!' })
const emptyTakeaway = (): TakeawayConfig => ({ activo: false, horarios: [{ desde: '19:00', hasta: '23:30' }], mensaje_fuera_horario: 'El take away no está disponible en este momento. ¡Volvemos pronto!', tolerancia_cierre: 5 })
const emptySucursal = (): Partial<Sucursal> => ({ nombre: '', slug: '', direccion: '', activo: true, rubro: 'HELADERIA' })

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
  const [takeaway, setTakeaway] = useState<TakeawayConfig>(emptyTakeaway())

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const { data: suc } = await supabase
      .from('sucursales')
      .select('id, nombre, slug, direccion, activo, horario_general, mensaje_cerrado, tolerancia_cierre, sucursal_pagos(acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_kiosk, acepta_mp_delivery, acepta_mp_mesa, acepta_mp_takeaway, acepta_efectivo_kiosk, acepta_efectivo_delivery, acepta_efectivo_mesa, acepta_efectivo_takeaway, acepta_transferencia_kiosk, acepta_transferencia_delivery, acepta_transferencia_mesa, acepta_transferencia_takeaway, cbu_transferencia, titular_transferencia), takeaway_config(activo, horarios, mensaje_fuera_horario, tolerancia_cierre), delivery_config(activo, costo_envio, horarios, mensaje_fuera_horario, pausado, mensaje_pausa, tolerancia_cierre), rubro')
      .eq('empresa_id', ctx.empresaId).order('nombre')
    setData((suc ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      pagos: Array.isArray(s.sucursal_pagos) ? (s.sucursal_pagos[0] ?? emptyPagos()) : (s.sucursal_pagos ?? emptyPagos()),
      delivery: Array.isArray(s.delivery_config) ? (s.delivery_config[0] ?? emptyDelivery()) : (s.delivery_config ?? emptyDelivery()),
      takeaway: Array.isArray(s.takeaway_config) ? (s.takeaway_config[0] ?? emptyTakeaway()) : (s.takeaway_config ?? emptyTakeaway()),
    })) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function slugify(text: string) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  }

  function openNew() { setForm(emptySucursal()); setPagos(emptyPagos()); setDelivery(emptyDelivery()); setEditId(null); setModal(true) }
  function openEdit(s: Sucursal) { setForm({ nombre: s.nombre, slug: s.slug, direccion: s.direccion, activo: s.activo }); setPagos(s.pagos ?? emptyPagos()); setDelivery(s.delivery ?? emptyDelivery()); setTakeaway(s.takeaway ?? emptyTakeaway()); const sx = s as Sucursal & { horario_general?: Horario[] | null; mensaje_cerrado?: string | null; tolerancia_cierre?: number | null }; setHorarioGeneral(sx.horario_general ?? null); setMensajeCerrado(sx.mensaje_cerrado ?? ''); setTolGeneral(sx.tolerancia_cierre ?? 0); setEditId(s.id); setModal(true) }

  // CICLO A — coherencia canal vs techo (aviso, jamás bloqueo: el techo manda)
  function minutosAbiertos(franjas: Horario[]): boolean[] {
    const m = new Array<boolean>(1440).fill(false)
    for (const { desde, hasta } of franjas) {
      const [dh, dm] = desde.split(':').map(Number)
      const [hh2, hm2] = hasta.split(':').map(Number)
      const d = dh * 60 + dm
      let h = hh2 * 60 + hm2
      if (h <= d) h += 1440 // cruza medianoche: pertenece al día de inicio
      for (let i = d; i < h; i++) m[i % 1440] = true
    }
    return m
  }
  function canalFueraDeTecho(canal: Horario[]): boolean {
    if (!horarioGeneral || horarioGeneral.length === 0) return false
    const techo = minutosAbiertos(horarioGeneral)
    const c = minutosAbiertos(canal)
    for (let i = 0; i < 1440; i++) if (c[i] && !techo[i]) return true
    return false
  }
  const AvisoTecho = ({ canal }: { canal: string }) => (
    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      ⚠️ Parte del horario de {canal} queda FUERA del horario del local — en ese rango el local
      cerrado manda y no van a entrar pedidos. Ajustá el canal o ampliá el horario del local.
    </p>
  )

  // CICLO A — estado del techo
  const [horarioGeneral, setHorarioGeneral] = useState<Horario[] | null>(null)
  const [mensajeCerrado, setMensajeCerrado] = useState('')
  const [tolGeneral, setTolGeneral] = useState<number>(0)

  async function handleSave() {
    if (!ctx || !form.nombre || !form.slug) return
    setSaving(true)
    const supabase = createClient()
    if (editId) {
      // CICLO 3: horario_general/mensaje_cerrado/tolerancia se editan en Servicios y horarios — este update ya no los escribe (evita pisadas con datos viejos abiertos en el modal)
      await supabase.from('sucursales').update({ nombre: form.nombre, slug: form.slug, direccion: form.direccion || null, activo: form.activo ?? true, rubro: form.rubro ?? 'HELADERIA' }).eq('id', editId)
      // CICLO 1: guardar la sucursal ya NO toca sucursal_pagos (prueba explícita del ciclo)
      // CICLO 3: tampoco toca takeaway_config ni delivery_config — su único escritor de UI es Servicios y horarios
    } else {
      const { data: nueva } = await supabase.from('sucursales').insert({ nombre: form.nombre, slug: form.slug, direccion: form.direccion || null, activo: true, rubro: form.rubro ?? 'HELADERIA', empresa_id: ctx.empresaId }).select('id').single()
      if (nueva) await supabase.from('sucursal_pagos').insert({ sucursal_id: nueva.id, empresa_id: ctx.empresaId }) // Ciclo 1: fila mínima, defaults de DB; la config vive en Cuentas y cobros
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
      <ConePageHeader title="Sucursales" description="Gestión de sucursales y puntos de venta" action={{ label: 'Nueva sucursal', onClick: openNew }} />

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
            <div className="space-y-1.5">
              <Label>Tipo de negocio</Label>
              <Select value={form.rubro ?? 'HELADERIA'} onValueChange={v => setForm({ ...form, rubro: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RUBROS.map(([valor, etiqueta]) => <SelectItem key={valor} value={valor}>{etiqueta}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-neutral-400">El tipo de negocio nos permite adaptar la experiencia de ConeOS y sugerir categorías y configuraciones iniciales. Podés cambiar todo después.</p>
            </div>
          </div>
          <div className="space-y-3 pt-2 border-t border-neutral-100">
            {/* CICLO 1 — poda (decisión CTO): los medios de pago tienen UNA casa.
                Este modal ya no lee ni escribe la configuración de pagos. */}
            <div className="bg-neutral-50 border border-neutral-100 rounded-xl p-3">
              <p className="text-xs text-neutral-500">💳 Los medios de pago y las cuentas de esta sucursal se configuran en <b>Cuentas y cobros</b>.</p>
            </div>
          </div>

          {/* CICLO 3: las secciones Take Away y Delivery (servicios, horarios,
              costos y mensajes) se PODARON de este modal — su casa es
              "Servicios y horarios". Igual que la poda de pagos del Ciclo 1. */}
          {editId && (
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <p className="text-xs text-neutral-500">🕗 Los servicios (Take Away, Delivery), sus horarios, costos y mensajes — y el horario del negocio que rige el Kiosk — se configuran en <b>Servicios y horarios</b>.</p>
            </div>
          )}
        </div>
      </ConeModal>
    </div>
  )
}
