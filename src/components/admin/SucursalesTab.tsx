'use client'

// ═══════════════════════════════════════════════════════════════
// CICLO SUCURSALES (orden CTO 23/09) — IDENTIDAD PURA
// · Modelo de tres estados: EXISTE (id/nombre/slug) · ACTIVA (opera)
//   · CONFIGURADA (canales/dispositivos). "Activa pero incompleta" es válido.
// · La baja ES desactivar: sin tacho, sin delete_sucursal, sin borrado
//   físico desde la operación. Reactivar devuelve todo sin reconstruir.
// · Alta = contrato actual EXACTO: insert sucursales + sucursal_pagos
//   mínima. Nace muda. Sin validaciones bloqueantes: checklist informativa.
// · Slug: autogenerado del nombre, editable SOLO al crear, sellado después.
// · Pagos / TA / Delivery NO se editan acá (una sola casa: Cobros y la grilla).
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Pencil, Store } from 'lucide-react'
import { colorSucursal } from '@/components/admin/SucursalColor'

interface SucursalRow {
  id: string; nombre: string; slug: string; direccion: string | null; activo: boolean; rubro: string | null
  delivery_config: { activo: boolean } | { activo: boolean }[] | null
  takeaway_config: { activo: boolean } | { activo: boolean }[] | null
  dispositivos: { id: string }[] | null
}

function slugify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function uno(v: { activo: boolean } | { activo: boolean }[] | null): boolean {
  if (!v) return false
  return Array.isArray(v) ? v.some(x => x.activo) : v.activo === true
}

export default function SucursalesTab() {
  const { ctx } = useEmpresa()
  const supabase = createClient()
  const [data, setData] = useState<SucursalRow[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [form, setForm] = useState({ nombre: '', slug: '', direccion: '', rubro: 'HELADERIA' })

  const cargar = useCallback(async () => {
    if (!ctx?.empresaId) return
    const { data: rows } = await supabase.from('sucursales')
      .select('id, nombre, slug, direccion, activo, rubro, delivery_config(activo), takeaway_config(activo), dispositivos(id)')
      .eq('empresa_id', ctx.empresaId).order('created_at')
    setData((rows ?? []) as unknown as SucursalRow[])
    setCargando(false)
  }, [ctx?.empresaId, supabase])
  useEffect(() => { cargar() }, [cargar])

  function openNew() { setForm({ nombre: '', slug: '', direccion: '', rubro: 'HELADERIA' }); setEditId(null); setModal(true) }
  function openEdit(s: SucursalRow) { setForm({ nombre: s.nombre, slug: s.slug, direccion: s.direccion ?? '', rubro: s.rubro ?? 'HELADERIA' }); setEditId(s.id); setModal(true) }

  async function guardar() {
    if (!ctx?.empresaId || !form.nombre.trim() || !form.slug.trim()) return
    setGuardando(true)
    if (editId) {
      // IDENTIDAD PURA: nombre/dirección/rubro. El slug NO se escribe (sellado).
      await supabase.from('sucursales')
        .update({ nombre: form.nombre.trim(), direccion: form.direccion.trim() || null, rubro: form.rubro || 'HELADERIA' })
        .eq('id', editId)
    } else {
      // ALTA = CONTRATO ACTUAL EXACTO: sucursal + sucursal_pagos mínima. Nace muda.
      const { data: nueva } = await supabase.from('sucursales')
        .insert({ nombre: form.nombre.trim(), slug: form.slug.trim(), direccion: form.direccion.trim() || null, activo: true, rubro: form.rubro || 'HELADERIA', empresa_id: ctx.empresaId })
        .select('id').single()
      if (nueva) await supabase.from('sucursal_pagos').insert({ sucursal_id: nueva.id, empresa_id: ctx.empresaId })
    }
    setGuardando(false); setModal(false); cargar()
  }

  // LA BAJA: desactivar/reactivar. Jamás borrar.
  async function toggleActivo(s: SucursalRow) {
    await supabase.from('sucursales').update({ activo: !s.activo }).eq('id', s.id)
    cargar()
  }

  if (cargando) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-neutral-300" /></div>

  return (
    <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-neutral-800 flex items-center gap-2"><Store size={18} /> Sucursales</h3>
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nueva sucursal</ConeButton>
      </div>
      <p className="text-xs text-neutral-400 mb-4">La identidad de cada punto de venta. Sus servicios se configuran en las otras pestañas; sus medios de pago, en Cobros. Dar de baja = desactivar — nada se borra.</p>

      <div className="divide-y divide-neutral-50">
        {data.map(s => {
          const faltantes: string[] = []
          if (!s.direccion) faltantes.push('dirección')
          if ((s.dispositivos ?? []).length === 0) faltantes.push('dispositivos')
          if (!uno(s.delivery_config) && !uno(s.takeaway_config)) faltantes.push('canal online (Delivery/TA)')
          return (
            <div key={s.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorSucursal(s.id).dot}`} title="El color de esta sucursal en toda la app" />
                  <p className="font-bold text-neutral-800">{s.nombre}</p>
                  <span className="text-xs font-mono text-neutral-400">/{s.slug}</span>
                  <ConeBadge active={s.activo} />
                </div>
                <p className="text-xs text-neutral-400 truncate">{s.direccion ?? 'Sin dirección'}</p>
                {s.activo && faltantes.length > 0 && (
                  <p className="text-[11px] font-semibold text-amber-600 mt-0.5">⚠ Activa pero incompleta — falta: {faltantes.join(' · ')}</p>
                )}
              </div>
              <button onClick={() => openEdit(s)} title="Editar identidad"
                className="p-2 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50"><Pencil size={16} /></button>
              <button onClick={() => toggleActivo(s)}
                title={s.activo ? 'Desactivar: deja de operar en TODAS sus puertas (QRs, App, kiosk). Reversible.' : 'Reactivar: vuelve a operar tal como estaba.'}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${s.activo ? 'border-neutral-200 text-neutral-500 hover:border-red-300 hover:text-red-500' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {s.activo ? 'Desactivar' : 'Reactivar'}
              </button>
            </div>
          )
        })}
        {data.length === 0 && <p className="py-8 text-center text-sm text-neutral-400">Sin sucursales</p>}
      </div>

      <ConeModal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar sucursal' : 'Nueva sucursal'}
        footer={<><ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton><ConeButton onClick={guardar} loading={guardando} disabled={!form.nombre.trim() || !form.slug.trim()}>{editId ? 'Guardar' : 'Crear sucursal'}</ConeButton></>}>
        <div className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <Input value={form.nombre} autoFocus placeholder="Federal"
              onChange={e => { const nombre = e.target.value; setForm(f => ({ ...f, nombre, slug: editId ? f.slug : slugify(nombre) })) }} />
          </div>
          <div>
            <Label>Slug (identificador de links y QR)</Label>
            {editId ? (
              <div className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl font-mono text-sm text-neutral-400 select-none">{form.slug}</div>
            ) : (
              <Input value={form.slug} className="font-mono text-sm" placeholder="federal"
                onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))} />
            )}
            <p className="text-[11px] text-neutral-400 mt-1">El slug identifica los links y QR impresos de esta sucursal. Cambiarlo puede romper accesos existentes{editId ? ' — por eso queda sellado.' : ', por eso solo se elige al crearla.'}</p>
          </div>
          <div>
            <Label>Dirección</Label>
            <Input value={form.direccion} placeholder="Calle 448 Nro 483"
              onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} />
            <p className="text-[11px] text-neutral-400 mt-1">Se imprime en el ticket y el comprobante de Take Away.</p>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
