'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeCard } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Check } from 'lucide-react'

interface Config {
  primary_color: string; secondary_color: string; logo_url: string | null
  texto_bienvenida: string; moneda: string
}
interface Empresa { nombre: string; slug: string; plan: string }

export default function ConfigPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    Promise.all([
      supabase.from('empresas').select('nombre, slug, plan').eq('id', ctx.empresaId).single(),
      supabase.from('empresa_config').select('primary_color, secondary_color, logo_url, texto_bienvenida, moneda').eq('empresa_id', ctx.empresaId).single(),
    ]).then(([{ data: emp }, { data: cfg }]) => {
      if (emp) setEmpresa(emp)
      if (cfg) setConfig(cfg)
    })
  }, [ctx])

  async function handleSave() {
    if (!ctx || !config) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('empresa_config').update({
      primary_color: config.primary_color, secondary_color: config.secondary_color,
      texto_bienvenida: config.texto_bienvenida, moneda: config.moneda,
    }).eq('empresa_id', ctx.empresaId)
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  if (ctxLoading || !config || !empresa) return (
    <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  return (
    <div>
      <ConePageHeader title="Configuración" description="Datos de empresa y preferencias del sistema" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ConeCard title="Datos de empresa">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={empresa.nombre} disabled className="bg-neutral-50 text-neutral-500" />
              <p className="text-xs text-neutral-400">Para cambiar el nombre contactá a soporte</p>
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input value={empresa.slug} disabled className="bg-neutral-50 font-mono text-sm text-neutral-500" />
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <span className="inline-block px-3 py-1.5 bg-neutral-800 text-white text-sm font-semibold rounded-lg capitalize">{empresa.plan}</span>
            </div>
          </div>
        </ConeCard>

        <ConeCard title="Personalización">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Mensaje de bienvenida (Kiosk)</Label>
              <Input value={config.texto_bienvenida} onChange={e => setConfig({ ...config, texto_bienvenida: e.target.value })} placeholder="¡Bienvenido!" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Color primario</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={config.primary_color} onChange={e => setConfig({ ...config, primary_color: e.target.value })} className="w-10 h-10 rounded-lg cursor-pointer border border-neutral-200" />
                  <Input value={config.primary_color} onChange={e => setConfig({ ...config, primary_color: e.target.value })} className="font-mono text-sm" maxLength={7} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Color secundario</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={config.secondary_color} onChange={e => setConfig({ ...config, secondary_color: e.target.value })} className="w-10 h-10 rounded-lg cursor-pointer border border-neutral-200" />
                  <Input value={config.secondary_color} onChange={e => setConfig({ ...config, secondary_color: e.target.value })} className="font-mono text-sm" maxLength={7} />
                </div>
              </div>
            </div>
          </div>
        </ConeCard>

        <ConeCard title="Configuración de pedidos">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Moneda</Label>
              <Input value={config.moneda} onChange={e => setConfig({ ...config, moneda: e.target.value })} placeholder="ARS" className="w-32" />
            </div>
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <p className="text-sm font-semibold text-neutral-700">Numeración de pedidos</p>
              <p className="text-xs text-neutral-400 mt-1">Numeración correlativa por empresa. El número nunca se reinicia.</p>
            </div>
          </div>
        </ConeCard>

        <ConeCard title="Vista previa">
          <div className="rounded-xl overflow-hidden border border-neutral-100">
            <div className="p-5 text-white" style={{ backgroundColor: config.primary_color }}>
              <p className="font-bold text-lg">{config.texto_bienvenida || '¡Bienvenido!'}</p>
              <p className="text-white/60 text-sm mt-0.5">Color primario</p>
            </div>
            <div className="p-4" style={{ backgroundColor: config.secondary_color }}>
              <p className="font-semibold text-sm" style={{ color: config.primary_color }}>Color secundario</p>
            </div>
          </div>
        </ConeCard>
      </div>
      <div className="mt-6 flex justify-end">
        <ConeButton onClick={handleSave} loading={saving}>
          {saved ? <span className="flex items-center gap-1"><Check className="h-4 w-4" /> ¡Guardado!</span> : 'Guardar cambios'}
        </ConeButton>
      </div>
    </div>
  )
}
