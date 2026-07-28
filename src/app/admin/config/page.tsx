'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeCard } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

interface Config {
  primary_color: string
  secondary_color: string
  logo_url: string | null
  texto_bienvenida: string
  moneda: string
  pedido_numero_diario: boolean
}

interface Empresa {
  nombre: string
  slug: string
  plan: string
}

export default function ConfigPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()

    async function load() {
      const [{ data: emp }, { data: cfg }] = await Promise.all([
        supabase.from('empresas').select('nombre, slug, plan').eq('id', ctx!.empresaId).single(),
        supabase.from('empresa_config').select('*').eq('empresa_id', ctx!.empresaId).single(),
      ])
      if (emp) setEmpresa(emp)
      if (cfg) setConfig(cfg)
    }
    load()
  }, [ctx])

  async function handleSave() {
    if (!ctx || !config) return
    setSaving(true)
    const supabase = createClient()

    await supabase.from('empresa_config').update({
      primary_color: config.primary_color,
      secondary_color: config.secondary_color,
      texto_bienvenida: config.texto_bienvenida,
      moneda: config.moneda,
      pedido_numero_diario: config.pedido_numero_diario,
    }).eq('empresa_id', ctx.empresaId)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (ctxLoading || !config || !empresa) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  return (
    <div>
      <ConePageHeader
        title="Configuración"
        description="Datos de empresa y preferencias del sistema"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Datos empresa */}
        <ConeCard title="Datos de empresa">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={empresa.nombre} disabled className="bg-neutral-50" />
              <p className="text-xs text-neutral-400">Para cambiar el nombre contactá a soporte</p>
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input value={empresa.slug} disabled className="bg-neutral-50 font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Input value={empresa.plan} disabled className="bg-neutral-50 capitalize" />
            </div>
          </div>
        </ConeCard>

        {/* Personalización */}
        <ConeCard title="Personalización">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Mensaje de bienvenida (Kiosk)</Label>
              <Input
                value={config.texto_bienvenida}
                onChange={e => setConfig({ ...config, texto_bienvenida: e.target.value })}
                placeholder="¡Bienvenido!"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Color primario</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={config.primary_color}
                    onChange={e => setConfig({ ...config, primary_color: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border border-neutral-200"
                  />
                  <Input
                    value={config.primary_color}
                    onChange={e => setConfig({ ...config, primary_color: e.target.value })}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Color secundario</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={config.secondary_color}
                    onChange={e => setConfig({ ...config, secondary_color: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border border-neutral-200"
                  />
                  <Input
                    value={config.secondary_color}
                    onChange={e => setConfig({ ...config, secondary_color: e.target.value })}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>
          </div>
        </ConeCard>

        {/* Pedidos */}
        <ConeCard title="Configuración de pedidos">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Moneda</Label>
              <Input
                value={config.moneda}
                onChange={e => setConfig({ ...config, moneda: e.target.value })}
                placeholder="ARS"
                className="w-32"
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="numDiario"
                checked={config.pedido_numero_diario}
                onChange={e => setConfig({ ...config, pedido_numero_diario: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <div>
                <Label htmlFor="numDiario" className="cursor-pointer">Numeración diaria de pedidos</Label>
                <p className="text-xs text-neutral-400 mt-0.5">El número de pedido se reinicia cada día</p>
              </div>
            </div>
          </div>
        </ConeCard>

        {/* Preview colores */}
        <ConeCard title="Vista previa">
          <div className="rounded-lg overflow-hidden border border-neutral-200">
            <div
              className="p-4 text-white text-sm font-medium"
              style={{ backgroundColor: config.primary_color }}
            >
              {config.texto_bienvenida}
            </div>
            <div
              className="p-3 text-sm font-medium"
              style={{ backgroundColor: config.secondary_color }}
            >
              Color secundario
            </div>
          </div>
        </ConeCard>
      </div>

      <div className="mt-6 flex justify-end">
        <ConeButton onClick={handleSave} loading={saving}>
          {saved ? '¡Guardado!' : 'Guardar cambios'}
        </ConeButton>
      </div>
    </div>
  )
}
