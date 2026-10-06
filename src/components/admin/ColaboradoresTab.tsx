'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Pencil, Link2, Check } from 'lucide-react'

// REPARTO V1: el cadete gana PUERTA — sucursal (null = todas) + PIN de 4
// dígitos hasheado en Postgres (RPC set_pin_colaborador, mismo bcrypt que
// operadores). El PIN JAMÁS se lee ni se muestra: solo se setea/cambia.
interface Colaborador { id: string; nombre: string; rol: string; activo: boolean; sucursal_id: string | null; pin_cargado?: boolean; emoji_reparto?: string | null; alias_publico?: string | null }

// Identidad visual del cadete (GO CTO 29/09): catálogo CONTROLADO — cambiar
// la lista no toca la base. NULL = 🛵 por defecto. Una casa para el dato:
// vive en colaboradores; pedidos y posiciones lo obtienen del colaborador.
const EMOJIS_REPARTO = ['🛵', '🏍️', '🚲', '🚴', '🚗', '🚙', '🛺', '🔵', '🟢', '🟡', '🟠', '🔴', '🟣']
interface Sucursal { id: string; nombre: string; slug: string }

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
  const [form, setForm] = useState({ nombre: '', rol: 'cadete', sucursal_id: 'todas', pin: '', emoji: '', alias: '' })
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [saving, setSaving] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  // REPARTO V1: link de la app del cadete — [host]/[slug]/reparto/[sucursal]
  // El slug sale del pathname del admin (/[empresa]/admin/...). Cadete "Todas
  // las sucursales": usa la primera sucursal (la puerta necesita una).
  function linkReparto(row: Colaborador): string | null {
    const slugEmpresa = window.location.pathname.split('/').filter(Boolean)[0]
    const suc = sucursales.find(su => su.id === row.sucursal_id) ?? sucursales[0]
    if (!slugEmpresa || !suc) return null
    return `${window.location.origin}/${slugEmpresa}/reparto/${suc.slug}`
  }
  async function copiarLink(row: Colaborador) {
    const link = linkReparto(row)
    if (!link) { alert('No hay sucursal para armar el link.'); return }
    try { await navigator.clipboard.writeText(link) } catch { prompt('Copiá el link:', link); return }
    setCopiado(row.id); setTimeout(() => setCopiado(null), 2000)
  }

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: rows }, { data: sucs }] = await Promise.all([
      supabase.from('colaboradores')
        .select('id, nombre, rol, activo, sucursal_id, pin_hash, emoji_reparto, alias_publico')
        .eq('empresa_id', ctx.empresaId)
        .order('nombre'),
      supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', ctx.empresaId).order('nombre'),
    ])
    // pin_hash no viaja al estado: solo el boolean (write-only)
    setData((rows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id, nombre: r.nombre, rol: r.rol, activo: r.activo,
      sucursal_id: r.sucursal_id ?? null, pin_cargado: !!r.pin_hash,
      emoji_reparto: (r.emoji_reparto as string | null) ?? null,
      alias_publico: (r.alias_publico as string | null) ?? null,
    })) as Colaborador[])
    setSucursales((sucs ?? []) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm({ nombre: '', rol: 'cadete', sucursal_id: 'todas', pin: '', emoji: '', alias: '' }); setEditId(null); setModal(true) }
  function openEdit(row: Colaborador) { setForm({ nombre: row.nombre, rol: row.rol, sucursal_id: row.sucursal_id ?? 'todas', pin: '', emoji: row.emoji_reparto ?? '', alias: row.alias_publico ?? '' }); setEditId(row.id); setModal(true) }

  async function handleSave() {
    if (!ctx || !form.nombre.trim()) return
    if (form.pin && !/^\d{4}$/.test(form.pin)) { alert('El PIN debe ser de 4 dígitos numéricos.'); return }
    setSaving(true)
    const supabase = createClient()
    const payload = { nombre: form.nombre.trim(), rol: form.rol, sucursal_id: form.sucursal_id === 'todas' ? null : form.sucursal_id,
      emoji_reparto: form.emoji && EMOJIS_REPARTO.includes(form.emoji) ? form.emoji : null,
      alias_publico: form.alias.trim() ? form.alias.trim().slice(0, 40) : null }
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
    // FIX 28/09 (hallazgo P7): no se puede desactivar un cadete con pedidos
    // EN REPARTO — quedaría un pedido en la calle sin cadete operativo.
    if (row.activo && row.rol === 'cadete') {
      const { count } = await supabase.from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('colaborador_id', row.id)
        .in('estado', ['PREPARING', 'READY'])
      if ((count ?? 0) > 0) {
        alert(`${row.nombre} tiene ${count} pedido${count === 1 ? '' : 's'} activo${count === 1 ? '' : 's'} en reparto. Esperá que los entregue (o reasignalos desde Caja) antes de desactivarlo.`)
        return
      }
    }
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
                {row.rol === 'cadete' ? (row.emoji_reparto ?? '🛵') : '👤'}
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
                  {row.rol === 'cadete' && <span className="text-neutral-400 font-normal"> · {sucursales.find(su => su.id === row.sucursal_id)?.nombre ?? 'Todas las sucursales'} · PIN {row.pin_cargado ? '✓' : '✗ sin cargar'}{row.alias_publico ? ` · público: “${row.alias_publico}”` : ''}</span>}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleActivo(row)} title={row.activo ? 'Desactivar' : 'Activar'}
                className={`relative w-11 h-6 rounded-full transition-colors ${row.activo ? 'bg-green-500' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${row.activo ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              {row.rol === 'cadete' && (
                <button onClick={() => copiarLink(row)} title="Copiar link de la app de reparto (el cadete lo abre y lo agrega a su pantalla de inicio)"
                  className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors">
                  {copiado === row.id ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4" />}
                </button>
              )}
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
          {form.rol === 'cadete' && (
            <div className="space-y-1.5">
              <Label>Identificador visual</Label>
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS_REPARTO.map(em => (
                  <button key={em} type="button" onClick={() => setForm({ ...form, emoji: form.emoji === em ? '' : em })}
                    className={`w-10 h-10 rounded-xl border text-xl flex items-center justify-center transition-colors ${form.emoji === em ? 'border-neutral-800 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}>
                    {em}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-neutral-400">Así aparece en el mapa de caja, la app del cadete y el seguimiento del cliente. Sin elegir = 🛵.</p>
            </div>
          )}
          {form.rol === 'cadete' && (
            <div className="space-y-1.5">
              <Label>Nombre público (lo ve el cliente)</Label>
              <Input value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} placeholder="Cadete 1" maxLength={40} />
              <p className="text-[11px] text-neutral-400">Por seguridad, el cliente puede ver este nombre en vez del real. Vacío = se muestra el nombre real, como siempre. Caja, comanda y la app del cadete siguen con el nombre real.</p>
            </div>
          )}
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
