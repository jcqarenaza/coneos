'use client'

// ═══════════════════════════════════════════════════════════════════
// 🎁 PROMOCIONES V1 — E2 · CONSTRUCTOR (GO CTO 11/10)
// Crea/edita promociones y sus slots con las presentaciones reales
// que el cliente puede elegir. El precio del combo lo valida el
// SERVER (prorrateo en /api/pedidos + grupo en crear_pedido_stock
// v1.5.1): acá solo se define. El precio regular (tachado) NO se carga a
// mano: sale de la suma de los precios de lista de lo que se elige en los
// componentes (JC 13/10). El admin solo pone el precio de la promo. Eliminar una promo ya vendida no se
// puede (FK de pedido_items): cae a desactivar.
// ═══════════════════════════════════════════════════════════════════

import { avisar, confirmar } from '@/components/admin/ConeDialog'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeModal, ConeButton, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Pencil, Trash2, Upload, X } from 'lucide-react'

interface Producto { id: string; nombre: string; activo: boolean; categoria_id: string | null; orden: number | null }
interface Categoria { id: string; nombre: string; orden: number | null }
interface Presentacion { id: string; nombre: string; precio: number; producto_id: string; activo: boolean }
interface SlotForm { titulo: string; presentacion_ids: string[] }
interface Promo {
  id: string; nombre: string; descripcion: string | null; imagen_url: string | null
  precio: number; precio_regular: number | null
  vigencia_desde: string | null; vigencia_hasta: string | null
  visible_kiosk: boolean; visible_delivery: boolean; visible_mesa: boolean; visible_takeaway: boolean
  es_novedad: boolean; activo: boolean
  promo_slots: { id: string; orden: number; titulo: string; promo_slot_presentaciones: { presentacion_id: string }[] }[]
}

const emptyForm = () => ({
  nombre: '', descripcion: '', imagen_url: null as string | null,
  precio: '',
  vigencia_desde: '', vigencia_hasta: '',
  visible_kiosk: true, visible_delivery: true, visible_mesa: true, visible_takeaway: true,
  es_novedad: false, activo: true,
})

function fmt(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default function PromocionesTab() {
  const { ctx } = useEmpresa()
  const [promos, setPromos] = useState<Promo[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [slots, setSlots] = useState<SlotForm[]>([{ titulo: '', presentacion_ids: [] }])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: ps }, { data: prods }, { data: pres }, { data: cats }] = await Promise.all([
      supabase.from('promociones')
        .select('*, promo_slots(id, orden, titulo, promo_slot_presentaciones(presentacion_id))')
        .eq('empresa_id', ctx.empresaId)
        .order('created_at', { ascending: false }),
      supabase.from('productos').select('id, nombre, activo, categoria_id, orden').eq('empresa_id', ctx.empresaId).is('deleted_at', null).order('orden'),
      supabase.from('presentaciones').select('id, nombre, precio, producto_id, activo').eq('empresa_id', ctx.empresaId).order('orden'),
      supabase.from('categorias').select('id, nombre, orden').eq('empresa_id', ctx.empresaId).is('deleted_at', null).order('orden'),
    ])
    setPromos(((ps ?? []) as Promo[]).map(p => ({ ...p, promo_slots: [...(p.promo_slots ?? [])].sort((a, b) => a.orden - b.orden) })))
    setProductos((prods ?? []) as Producto[])
    setCategorias((cats ?? []) as Categoria[])
    setPresentaciones((pres ?? []) as Presentacion[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])  // eslint-disable-line react-hooks/exhaustive-deps

  // Suma de lista mínima/máxima informativa según lo elegido en cada slot
  function rangoLista(): { min: number; max: number } | null {
    let min = 0, max = 0
    for (const s of slots) {
      const precios = s.presentacion_ids.map(id => Number(presentaciones.find(p => p.id === id)?.precio ?? 0)).filter(n => n > 0)
      if (precios.length === 0) return null
      min += Math.min(...precios); max += Math.max(...precios)
    }
    return { min, max }
  }

  async function subirImagen(file: File) {
    setUploading(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop()
    const path = `promos/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('productos').getPublicUrl(path)
      setForm(f => ({ ...f, imagen_url: data.publicUrl }))
    } else avisar('No se pudo subir la imagen: ' + error.message)
    setUploading(false)
  }

  function abrirNueva() {
    setEditId(null); setForm(emptyForm()); setSlots([{ titulo: '', presentacion_ids: [] }]); setModal(true)
  }

  function abrirEditar(p: Promo) {
    setEditId(p.id)
    setForm({
      nombre: p.nombre, descripcion: p.descripcion ?? '', imagen_url: p.imagen_url,
      precio: String(p.precio),
      vigencia_desde: p.vigencia_desde ?? '', vigencia_hasta: p.vigencia_hasta ?? '',
      visible_kiosk: p.visible_kiosk, visible_delivery: p.visible_delivery, visible_mesa: p.visible_mesa, visible_takeaway: p.visible_takeaway,
      es_novedad: p.es_novedad, activo: p.activo,
    })
    setSlots(p.promo_slots.map(s => ({ titulo: s.titulo ?? '', presentacion_ids: s.promo_slot_presentaciones.map(x => x.presentacion_id) })))
    setModal(true)
  }

  function togglePres(slotIdx: number, presId: string) {
    setSlots(prev => prev.map((s, i) => i !== slotIdx ? s
      : s.presentacion_ids.includes(presId)
        ? { ...s, presentacion_ids: s.presentacion_ids.filter(x => x !== presId) }
        : { ...s, presentacion_ids: [...s.presentacion_ids, presId] }))
  }

  async function guardar() {
    if (!ctx) return
    const rango = rangoLista()
    const precio = Number(form.precio)
    // Tachado automático: suma de lista de los componentes (la más baja posible si
    // hay opciones con distinto precio → jamás promete un ahorro mayor al real).
    // Solo se muestra si de verdad hay ahorro (suma de lista > precio de la promo).
    const precioRegular = rango && rango.min > precio ? rango.min : null
    if (!form.nombre.trim()) { avisar('Poné un nombre a la promo.'); return }
    if (!Number.isFinite(precio) || precio <= 0) { avisar('El precio del combo debe ser mayor a 0.'); return }
    if (form.vigencia_desde && form.vigencia_hasta && form.vigencia_hasta < form.vigencia_desde) { avisar('La vigencia "hasta" no puede ser anterior a "desde".'); return }
    if (slots.length === 0) { avisar('El combo necesita al menos un componente.'); return }
    if (slots.some(s => s.presentacion_ids.length === 0)) { avisar('Cada componente necesita al menos una presentación permitida.'); return }

    setSaving(true)
    const supabase = createClient()
    const body = {
      empresa_id: ctx.empresaId,
      nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null, imagen_url: form.imagen_url,
      precio, precio_regular: precioRegular,
      vigencia_desde: form.vigencia_desde || null, vigencia_hasta: form.vigencia_hasta || null,
      visible_kiosk: form.visible_kiosk, visible_delivery: form.visible_delivery, visible_mesa: form.visible_mesa, visible_takeaway: form.visible_takeaway,
      es_novedad: form.es_novedad, activo: form.activo,
    }

    let promoId = editId
    if (editId) {
      const { error } = await supabase.from('promociones').update(body).eq('id', editId)
      if (error) { avisar('No se pudo guardar: ' + error.message); setSaving(false); return }
    } else {
      const { data, error } = await supabase.from('promociones').insert(body).select('id').single()
      if (error || !data) { avisar('No se pudo crear: ' + (error?.message ?? 'sin datos')); setSaving(false); return }
      promoId = data.id
    }

    // Slots: se reescriben enteros (cascade limpia las permitidas).
    // pedido_items solo referencia la PROMO, no los slots → seguro.
    if (editId) {
      const { error } = await supabase.from('promo_slots').delete().eq('promo_id', editId)
      if (error) { avisar('No se pudieron actualizar los componentes: ' + error.message); setSaving(false); return }
    }
    for (let i = 0; i < slots.length; i++) {
      const { data: slotRow, error: e1 } = await supabase.from('promo_slots')
        .insert({ empresa_id: ctx.empresaId, promo_id: promoId, orden: i + 1, titulo: slots[i].titulo.trim() || `Componente ${i + 1}` })
        .select('id').single()
      if (e1 || !slotRow) { avisar('No se pudo guardar un componente: ' + (e1?.message ?? 'sin datos')); setSaving(false); return }
      const { error: e2 } = await supabase.from('promo_slot_presentaciones')
        .insert(slots[i].presentacion_ids.map(pid => ({ empresa_id: ctx.empresaId, slot_id: slotRow.id, presentacion_id: pid })))
      if (e2) { avisar('No se pudieron guardar las presentaciones permitidas: ' + e2.message); setSaving(false); return }
    }

    setSaving(false); setModal(false); load()
  }

  async function eliminar(p: Promo) {
    if (!(await confirmar(`¿Eliminar la promo "${p.nombre}"? Si ya se vendió, se desactiva y conserva su historial.`, { peligro: true, confirmarLabel: 'Eliminar' }))) return
    const supabase = createClient()
    const { error } = await supabase.from('promociones').delete().eq('id', p.id)
    if (error) {
      // Ya vendida: FK desde pedido_items → soft-delete (regla de la casa)
      const { error: e2 } = await supabase.from('promociones').update({ activo: false }).eq('id', p.id)
      if (e2) avisar('No se pudo eliminar ni desactivar: ' + e2.message)
      else avisar(`"${p.nombre}" ya tiene ventas: quedó desactivada (no se muestra más, el historial se conserva).`)
    }
    load()
  }

  async function toggleActivo(p: Promo) {
    const { error } = await createClient().from('promociones').update({ activo: !p.activo }).eq('id', p.id)
    if (error) avisar('No se pudo cambiar el estado: ' + error.message)
    else setPromos(prev => prev.map(x => x.id === p.id ? { ...x, activo: !p.activo } : x))
  }

  const rango = rangoLista()
  const presActivas = presentaciones.filter(p => p.activo)
  const prodDe = (presId: string) => productos.find(pr => pr.id === presentaciones.find(p => p.id === presId)?.producto_id)?.nombre ?? ''

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={abrirNueva} icon={<Plus className="h-4 w-4" />}>Nueva promo</ConeButton>
      </div>

      {promos.length === 0 ? (
        <div className="text-center py-14 text-neutral-400 bg-white rounded-2xl border border-neutral-100">
          <p className="text-2xl mb-1">🎁</p>
          <p className="font-semibold text-neutral-600 mb-1">Todavía no hay promociones</p>
          <p className="text-sm">Creá un combo: precio total, componentes y qué puede elegir el cliente en cada uno.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {promos.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-neutral-100 shadow-sm px-5 py-4 flex items-start gap-4">
              {p.imagen_url && (
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-neutral-50 flex-shrink-0">
                  <img src={p.imagen_url} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-neutral-800">🎁 {p.nombre}</p>
                  <ConeBadge active={p.activo} />
                  {p.es_novedad && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">✨ Novedad</span>}
                </div>
                <p className="text-sm mt-0.5">
                  {p.precio_regular != null && <span className="text-neutral-400 line-through mr-1.5">{fmt(p.precio_regular)}</span>}
                  <span className="font-bold text-neutral-800">{fmt(p.precio)}</span>
                  {(p.vigencia_desde || p.vigencia_hasta) && (
                    <span className="text-neutral-400 ml-2 text-xs">
                      {p.vigencia_desde ? `desde ${p.vigencia_desde}` : ''}{p.vigencia_desde && p.vigencia_hasta ? ' · ' : ''}{p.vigencia_hasta ? `hasta ${p.vigencia_hasta}` : ''}
                    </span>
                  )}
                </p>
                <p className="text-xs text-neutral-400 mt-1">
                  {p.promo_slots.map(s => `${s.titulo || `Componente ${s.orden}`} (${s.promo_slot_presentaciones.length})`).join(' + ')}
                  <span className="ml-2">
                    {p.visible_kiosk && '🖥️'}{p.visible_delivery && '🛵'}{p.visible_takeaway && '🥡'}{p.visible_mesa && '🍽️'}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => toggleActivo(p)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${p.activo ? 'text-neutral-400 hover:bg-neutral-100' : 'text-green-600 hover:bg-green-50'}`}>
                  {p.activo ? 'Pausar' : 'Activar'}
                </button>
                <button onClick={() => abrirEditar(p)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => eliminar(p)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConeModal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar promoción' : 'Nueva promoción'} size="lg"
        footer={<>
          <ConeButton variant="ghost" onClick={() => setModal(false)}>Cancelar</ConeButton>
          <ConeButton onClick={guardar} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editId ? 'Guardar cambios' : 'Crear promo'}</ConeButton>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nombre</Label>
              <Input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Promo 2 potes" />
            </div>
            <div className="col-span-2">
              <Label>Descripción (opcional)</Label>
              <Input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej: Dos potes de 1kg a elección" />
            </div>
            <div>
              <Label>Precio del combo</Label>
              <Input type="number" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} placeholder="32000" />
            </div>
            <div>
              <Label>Precio regular (tachado, automático)</Label>
              <div className="h-10 px-3 flex items-center rounded-md border border-neutral-200 bg-neutral-50 text-sm text-neutral-500">
                {rango ? fmt(rango.min) : 'Elegí los componentes'}
              </div>
            </div>
            <div>
              <Label>Vigente desde (opcional)</Label>
              <Input type="date" value={form.vigencia_desde} onChange={e => setForm(f => ({ ...f, vigencia_desde: e.target.value }))} />
            </div>
            <div>
              <Label>Vigente hasta (opcional)</Label>
              <Input type="date" value={form.vigencia_hasta} onChange={e => setForm(f => ({ ...f, vigencia_hasta: e.target.value }))} />
            </div>
          </div>

          {rango && Number(form.precio) > 0 && (
            <p className="text-xs text-neutral-400 bg-neutral-50 rounded-lg px-3 py-2">
              💡 Suma de lista según lo elegido: {rango.min === rango.max ? fmt(rango.min) : `${fmt(rango.min)} a ${fmt(rango.max)}`} → el cliente paga {fmt(Number(form.precio))}.
              {rango.min > Number(form.precio)
                ? ` Se muestra tachado ${fmt(rango.min)} (ahorro ${fmt(rango.min - Number(form.precio))}).`
                : ' La suma de lista no supera el precio de la promo: no se muestra tachado.'}
            </p>
          )}

          {/* Imagen */}
          <div>
            <Label>Imagen (opcional)</Label>
            {form.imagen_url ? (
              <div className="relative w-full h-28 rounded-xl overflow-hidden border border-neutral-200 bg-neutral-50 group mt-1">
                <img src={form.imagen_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                <button onClick={() => setForm(f => ({ ...f, imagen_url: null }))} className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="w-full h-20 mt-1 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 hover:bg-neutral-100 transition-colors flex items-center justify-center gap-2 text-neutral-400 disabled:opacity-50">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="text-sm font-medium">{uploading ? 'Subiendo…' : 'Subir imagen'}</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) subirImagen(f); e.target.value = '' }} />
          </div>

          {/* Canales + flags */}
          <div className="flex flex-wrap gap-4 text-sm">
            {([['visible_kiosk', '🖥️ Kiosk'], ['visible_delivery', '🛵 Delivery'], ['visible_takeaway', '🥡 Take away'], ['visible_mesa', '🍽️ Mesa']] as const).map(([k, lbl]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked }))} className="rounded" /> {lbl}
              </label>
            ))}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.es_novedad} onChange={e => setForm(f => ({ ...f, es_novedad: e.target.checked }))} className="rounded" /> ✨ Novedad
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} className="rounded" /> Activa
            </label>
          </div>

          {/* Slots */}
          <div className="border-t border-neutral-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-neutral-800 text-sm">Componentes del combo</p>
              <ConeButton variant="ghost" onClick={() => setSlots(prev => [...prev, { titulo: '', presentacion_ids: [] }])} icon={<Plus className="h-4 w-4" />}>Agregar componente</ConeButton>
            </div>
            <div className="space-y-3">
              {slots.map((slot, idx) => (
                <div key={idx} className="rounded-xl border border-neutral-100 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-neutral-400 flex-shrink-0">{idx + 1}.</span>
                    <Input value={slot.titulo} onChange={e => setSlots(prev => prev.map((s, i) => i === idx ? { ...s, titulo: e.target.value } : s))}
                      placeholder={`Título (ej: Pote ${idx + 1})`} className="h-8 text-sm" />
                    {slots.length > 1 && (
                      <button onClick={() => setSlots(prev => prev.filter((_, i) => i !== idx))} className="p-1.5 text-neutral-300 hover:text-red-500 rounded-lg flex-shrink-0"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                  <p className="text-xs text-neutral-400 mb-1.5">Qué puede elegir el cliente acá ({slot.presentacion_ids.length} marcadas):</p>
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                    {/* Por FAMILIA (categoría) en el orden del catálogo, y dentro de cada una
                        los productos en su orden — igual que se ven en el kiosk (fix 20/10) */}
                    {[...categorias.map(c => ({ id: c.id as string | null, nombre: c.nombre })), { id: null as string | null, nombre: 'Sin categoría' }].map(cat => {
                      const prods = productos
                        .filter(pr => pr.activo && (pr.categoria_id ?? null) === cat.id && presActivas.some(p => p.producto_id === pr.id))
                        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre))
                      if (prods.length === 0) return null
                      return (
                        <div key={cat.id ?? 'sin-cat'}>
                          <p className="text-[11px] font-black uppercase tracking-wide text-neutral-400 mt-2 pt-1 border-t border-neutral-100">{cat.nombre}</p>
                          {prods.map(pr => (
                            <div key={pr.id}>
                              <p className="text-xs font-semibold text-neutral-500 mt-1">{pr.nombre}</p>
                              {presActivas.filter(p => p.producto_id === pr.id).map(p => (
                                <label key={p.id} className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer py-0.5 pl-2">
                                  <input type="checkbox" checked={slot.presentacion_ids.includes(p.id)} onChange={() => togglePres(idx, p.id)} className="rounded" />
                                  {p.nombre} <span className="text-xs text-neutral-400">{fmt(p.precio)}</span>
                                </label>
                              ))}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
