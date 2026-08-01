'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeTable, ConeModal, ConeButton, ConeBadge } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Loader2, Copy, Check, Monitor, Tablet, Smartphone } from 'lucide-react'

interface Sucursal { id: string; nombre: string }
interface Dispositivo {
  id: string
  nombre: string
  tipo: 'KIOSK' | 'CAJA' | 'PREPARACION' | 'DISPLAY'
  sucursal_id: string
  sucursal_nombre?: string
  device_token: string
  activo: boolean
  [key: string]: unknown
}

const TIPOS = [
  { value: 'KIOSK',      label: 'Kiosk',       desc: 'Pantalla táctil para clientes' },
  { value: 'CAJA',       label: 'Caja',        desc: 'Gestión de pagos y pedidos' },
  { value: 'PREPARACION',label: 'Preparación', desc: 'Pantalla de preparación' },
  { value: 'DISPLAY',    label: 'Display',     desc: 'Pantalla pública de pedidos listos' },
]

const tipoIcon = (tipo: string) => {
  if (tipo === 'KIOSK') return <Tablet className="h-4 w-4" />
  if (tipo === 'DISPLAY') return <Monitor className="h-4 w-4" />
  return <Smartphone className="h-4 w-4" />
}

const tipoColor = (tipo: string) => {
  if (tipo === 'KIOSK') return 'bg-purple-50 text-purple-700'
  if (tipo === 'CAJA') return 'bg-blue-50 text-blue-700'
  if (tipo === 'PREPARACION') return 'bg-amber-50 text-amber-700'
  if (tipo === 'DISPLAY') return 'bg-green-50 text-green-700'
  return 'bg-neutral-50 text-neutral-700'
}

export default function DispositivosTab() {
  const { ctx } = useEmpresa()
  const [data, setData] = useState<Dispositivo[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [tokenModal, setTokenModal] = useState(false)
  const [selectedToken, setSelectedToken] = useState('')
  const [selectedNombre, setSelectedNombre] = useState('')
  const [form, setForm] = useState({ nombre: '', tipo: 'KIOSK', sucursal_id: '' })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    if (!ctx) return
    const supabase = createClient()
    const [{ data: devs }, { data: suc }] = await Promise.all([
      supabase.from('dispositivos')
        .select('id, nombre, tipo, sucursal_id, device_token, activo, sucursales(nombre)')
        .eq('empresa_id', ctx.empresaId)
        .order('nombre'),
      supabase.from('sucursales')
        .select('id, nombre')
        .eq('empresa_id', ctx.empresaId)
        .eq('activo', true)
        .order('nombre'),
    ])
    setData((devs ?? []).map((d: Record<string, unknown>) => ({
      ...d,
      sucursal_nombre: (d.sucursales as { nombre: string } | null)?.nombre ?? '',
    })) as Dispositivo[])
    setSucursales((suc ?? []) as Sucursal[])
    setLoading(false)
  }

  useEffect(() => { load() }, [ctx])

  function openNew() {
    setForm({ nombre: '', tipo: 'KIOSK', sucursal_id: sucursales[0]?.id ?? '' })
    setEditId(null)
    setModal(true)
  }

  function openEdit(row: Dispositivo) {
    setForm({ nombre: row.nombre, tipo: row.tipo, sucursal_id: row.sucursal_id })
    setEditId(row.id)
    setModal(true)
  }

  function showToken(row: Dispositivo) {
    setSelectedToken(row.device_token)
    setSelectedNombre(row.nombre)
    setTokenModal(true)
  }

  async function copyToken() {
    await navigator.clipboard.writeText(selectedToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSave() {
    if (!ctx || !form.nombre || !form.sucursal_id) return
    setSaving(true)
    const supabase = createClient()

    if (editId) {
      await supabase.from('dispositivos').update({
        nombre: form.nombre,
        tipo: form.tipo,
        sucursal_id: form.sucursal_id,
      }).eq('id', editId)
    } else {
      await supabase.from('dispositivos').insert({
        nombre: form.nombre,
        tipo: form.tipo,
        sucursal_id: form.sucursal_id,
        empresa_id: ctx.empresaId,
      })
    }

    setSaving(false)
    setModal(false)
    load()
  }

  async function handleToggle(row: Dispositivo) {
    const supabase = createClient()
    await supabase.from('dispositivos').update({ activo: !row.activo }).eq('id', row.id)
    load()
  }

  // URL de vinculación por tipo
  function getUrl(row: Dispositivo) {
    const base = window.location.origin
    const suc = sucursales.find(s => s.id === row.sucursal_id)
    if (!suc || !ctx) return ''
    const empresa = ctx.empresaSlug
    const sucursal = suc.nombre.toLowerCase().replace(/\s+/g, '-')
    if (row.tipo === 'KIOSK') return `${base}/${empresa}/kiosk/${sucursal}?token=${row.device_token}`
    if (row.tipo === 'DISPLAY') return `${base}/${empresa}/display/${sucursal}?token=${row.device_token}`
    return `${base}/${empresa}/operacion/${sucursal}?token=${row.device_token}`
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ConeButton onClick={openNew} icon={<Plus className="h-4 w-4" />}>Nuevo dispositivo</ConeButton>
      </div>

      <ConeTable
        data={data}
        columns={[
          {
            key: 'tipo', label: 'Tipo',
            render: row => (
              <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${tipoColor(row.tipo as string)}`}>
                {tipoIcon(row.tipo as string)}
                {TIPOS.find(t => t.value === row.tipo)?.label}
              </span>
            )
          },
          { key: 'nombre', label: 'Nombre' },
          { key: 'sucursal_nombre', label: 'Sucursal' },
          {
            key: 'token', label: 'Token',
            render: row => (
              <button
                onClick={() => showToken(row as Dispositivo)}
                className="text-xs font-mono text-neutral-400 hover:text-neutral-700 underline underline-offset-2"
              >
                Ver token
              </button>
            )
          },
          { key: 'activo', label: 'Estado', render: row => <ConeBadge active={row.activo as boolean} /> },
        ]}
        onEdit={openEdit}
        onDelete={handleToggle}
        emptyMessage="Sin dispositivos — registrá el primero"
      />

      {/* Modal nuevo/editar dispositivo */}
      <ConeModal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Editar dispositivo' : 'Nuevo dispositivo'}
        footer={
          <>
            <ConeButton variant="outline" onClick={() => setModal(false)}>Cancelar</ConeButton>
            <ConeButton onClick={handleSave} loading={saving}>Guardar</ConeButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo de dispositivo *</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm({ ...form, tipo: t.value })}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition-colors ${
                    form.tipo === t.value
                      ? 'border-neutral-900 bg-neutral-50'
                      : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded mb-1 ${tipoColor(t.value)}`}>{t.label}</span>
                  <span className="text-xs text-neutral-400">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre: e.target.value })}
              placeholder="Kiosk Federal 01"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Sucursal *</Label>
            <Select value={form.sucursal_id} onValueChange={v => setForm({ ...form, sucursal_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná una sucursal" /></SelectTrigger>
              <SelectContent>
                {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </ConeModal>

      {/* Modal token */}
      <ConeModal
        open={tokenModal}
        onClose={() => setTokenModal(false)}
        title={`Token — ${selectedNombre}`}
        footer={<ConeButton onClick={() => setTokenModal(false)} variant="outline">Cerrar</ConeButton>}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Device Token</Label>
            <div className="flex gap-2">
              <Input value={selectedToken} readOnly className="font-mono text-xs bg-neutral-50" />
              <ConeButton variant="outline" onClick={copyToken} icon={copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}>
                {copied ? 'Copiado' : 'Copiar'}
              </ConeButton>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>URL de vinculación</Label>
            <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <p className="text-xs font-mono text-neutral-600 break-all">
                {data.find(d => d.device_token === selectedToken) ? getUrl(data.find(d => d.device_token === selectedToken)!) : ''}
              </p>
            </div>
            <p className="text-xs text-neutral-400">Abrí esta URL en el dispositivo para vincularlo automáticamente</p>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
