'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2, Copy, Check, Monitor, Tablet, Smartphone, Pencil, Trash2, ExternalLink } from 'lucide-react'

interface Sucursal { id: string; nombre: string; slug: string }
interface Dispositivo {
  id: string; nombre: string; tipo: 'KIOSK' | 'CAJA' | 'PREPARACION' | 'DISPLAY'
  sucursal_id: string; sucursal_nombre?: string; sucursal_slug?: string; device_token: string; activo: boolean
}

const TIPOS = [
  { value: 'KIOSK', label: 'Kiosk', desc: 'Pantalla táctil para clientes' },
  { value: 'CAJA', label: 'Caja', desc: 'Gestión de pagos y pedidos' },
  { value: 'PREPARACION', label: 'Preparación', desc: 'Pantalla de preparación' },
  { value: 'DISPLAY', label: 'Display', desc: 'Pantalla pública de pedidos listos' },
]

const tipoIcon = (tipo: string) => {
  if (tipo === 'KIOSK') return <Tablet className="h-4 w-4" />
  if (tipo === 'DISPLAY') return <Monitor className="h-4 w-4" />
  return <Smartphone className="h-4 w-4" />
}

const tipoBadge = (tipo: string) => {
  if (tipo === 'KIOSK') return 'bg-purple-50 text-purple-700'
  if (tipo === 'CAJA') return 'bg-blue-50 text-blue-700'
  if (tipo === 'PREPARACION') return 'bg-amber-50 text-amber-700'
  return 'bg-green-50 text-green-700'
}

function QRCode({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !url) return
    import('qrcode').then(QRLib => {
      QRLib.toCanvas(canvasRef.current!, url, {
        width: 200, margin: 2,
        color: { dark: '#1a1a1a', light: '#ffffff' }
      })
    }).catch(() => {
      // fallback: usar API de QR externo
      const img = new window.Image()
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`
      img.onload = () => {
        const ctx = canvasRef.current?.getContext('2d')
        if (ctx) ctx.drawImage(img, 0, 0, 200, 200)
      }
    })
  }, [url])

  return (
    <div className="flex flex-col items-center">
      <canvas ref={canvasRef} width={200} height={200} className="rounded-xl border border-neutral-100" />
    </div>
  )
}

export default function DispositivosTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Dispositivo[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [tokenModal, setTokenModal] = useState(false)
  const [selectedNombre, setSelectedNombre] = useState('')
  const [selectedDispositivo, setSelectedDispositivo] = useState<Dispositivo | null>(null)
  const [form, setForm] = useState({ nombre: '', tipo: 'KIOSK', sucursal_id: '' })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: devs }, { data: suc }] = await Promise.all([
      supabase.from('dispositivos').select('id, nombre, tipo, sucursal_id, device_token, activo, sucursales(nombre, slug)').eq('empresa_id', ctx.empresaId).order('nombre'),
      supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', ctx.empresaId).eq('activo', true).order('nombre'),
    ])
    setData((devs ?? []).map((d: Record<string, unknown>) => ({
      ...d,
      sucursal_nombre: (d.sucursales as { nombre: string; slug: string } | null)?.nombre ?? '',
      sucursal_slug: (d.sucursales as { nombre: string; slug: string } | null)?.slug ?? '',
    })) as Dispositivo[])
    setSucursales((suc ?? []) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() { setForm({ nombre: '', tipo: 'KIOSK', sucursal_id: sucursales[0]?.id ?? '' }); setEditId(null); setModal(true) }
  function openEdit(row: Dispositivo) { setForm({ nombre: row.nombre, tipo: row.tipo, sucursal_id: row.sucursal_id }); setEditId(row.id); setModal(true) }
  function showToken(row: Dispositivo) { setSelectedNombre(row.nombre); setSelectedDispositivo(row); setCopiedUrl(false); setTokenModal(true) }

  function getUrl(row: Dispositivo) {
    const base = window.location.origin
    const empresaSlug = ctx?.empresaSlug ?? ''
    const sucSlug = row.sucursal_slug ?? ''
    if (!empresaSlug || !sucSlug) return `${base}?token=${row.device_token}`
    if (row.tipo === 'KIOSK') return `${base}/${empresaSlug}/kiosk/${sucSlug}?token=${row.device_token}`
    if (row.tipo === 'DISPLAY') return `${base}/${empresaSlug}/display/${sucSlug}?token=${row.device_token}`
    return `${base}/${empresaSlug}/operacion/${sucSlug}?token=${row.device_token}`
  }

  async function copyUrl() {
    if (!selectedDispositivo) return
    await navigator.clipboard.writeText(getUrl(selectedDispositivo))
    setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000)
  }

  async function handleSave() {
    if (!ctx || !form.nombre || !form.sucursal_id) return
    setSaving(true)
    const supabase = createClient()
    if (editId) { await supabase.from('dispositivos').update({ nombre: form.nombre, tipo: form.tipo, sucursal_id: form.sucursal_id }).eq('id', editId) }
    else { await supabase.from('dispositivos').insert({ nombre: form.nombre, tipo: form.tipo, sucursal_id: form.sucursal_id, empresa_id: ctx.empresaId }) }
    setSaving(false); setModal(false); load()
  }

  async function handleDelete(row: Dispositivo) {
    if (!confirm(`¿Eliminar el dispositivo "${row.nombre}"?`)) return
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_dispositivo', { p_id: row.id })
    if (error) {
      await supabase.from('operator_sessions').delete().eq('dispositivo_id', row.id)
      await supabase.from('dispositivos').delete().eq('id', row.id)
    }
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo dispositivo</ConeButton>
      </div>

      <div className="space-y-2">
        {data.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin dispositivos</div>}
        {data.map(row => (
          <div key={row.id} className="bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-500">{tipoIcon(row.tipo)}</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-900">{row.nombre}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${tipoBadge(row.tipo)}`}>{TIPOS.find(t => t.value === row.tipo)?.label}</span>
                  <ConeBadge active={row.activo} />
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">{row.sucursal_nombre}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => showToken(row)} className="px-3 py-1.5 text-xs font-semibold text-neutral-500 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors">Ver URL</button>
              <button onClick={() => openEdit(row)} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(row)} className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal nuevo/editar */}
      <ConeModal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar dispositivo' : 'Nuevo dispositivo'}
        footer={<><ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton><ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo *</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map(t => (
                <button key={t.value} type="button" onClick={() => setForm({ ...form, tipo: t.value })}
                  className={`flex flex-col items-start p-3 rounded-xl border text-left transition-colors ${form.tipo === t.value ? 'border-neutral-800 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}>
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded mb-1 ${tipoBadge(t.value)}`}>{t.label}</span>
                  <span className="text-xs text-neutral-400">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Kiosk Federal 01" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Sucursal *</Label>
            <Select value={form.sucursal_id} onValueChange={v => setForm({ ...form, sucursal_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná" /></SelectTrigger>
              <SelectContent>{sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </ConeModal>

      {/* Modal URL + QR */}
      <ConeModal open={tokenModal} onClose={() => setTokenModal(false)} title={`Vincular — ${selectedNombre}`}
        footer={<ConeButton onClick={() => setTokenModal(false)} variant="outline">Cerrar</ConeButton>}>
        {selectedDispositivo && (
          <div className="space-y-5">
            {/* QR */}
            <div className="flex flex-col items-center">
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">Escanear con la tablet</p>
              <QRCode url={getUrl(selectedDispositivo)} />
              <p className="text-xs text-neutral-400 mt-2 text-center">Apuntá la cámara al QR para abrir el dispositivo</p>
            </div>

            <div className="h-px bg-neutral-100" />

            {/* URL clickeable */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">O abrí el link</p>
              <a href={getUrl(selectedDispositivo)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-100 transition-colors">
                <ExternalLink className="h-4 w-4 text-blue-500 flex-shrink-0" />
                <span className="text-xs font-mono text-blue-700 break-all">{getUrl(selectedDispositivo)}</span>
              </a>
            </div>

            {/* Botón copiar URL */}
            <button onClick={copyUrl}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all border-2 border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50">
              {copiedUrl
                ? <><Check className="h-4 w-4 text-green-600" /><span className="text-green-600">¡URL copiada!</span></>
                : <><Copy className="h-4 w-4 text-neutral-500" /><span className="text-neutral-600">Copiar URL para compartir por WhatsApp</span></>}
            </button>

            <div className="flex items-center gap-2 p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <div className={`text-xs font-bold px-2 py-1 rounded-full ${tipoBadge(selectedDispositivo.tipo)}`}>
                {TIPOS.find(t => t.value === selectedDispositivo.tipo)?.label}
              </div>
              <span className="text-neutral-500 text-sm">{selectedDispositivo.sucursal_nombre}</span>
            </div>
          </div>
        )}
      </ConeModal>
    </div>
  )
}
