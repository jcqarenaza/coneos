'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeCard } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Check, Upload, X } from 'lucide-react'
import Image from 'next/image'

interface Config {
  primary_color: string; secondary_color: string; logo_url: string | null
  texto_bienvenida: string; moneda: string
  cuit: string | null; razon_social: string | null; condicion_iva: string | null; punto_venta: number | null
  pwa_nombre: string | null; pwa_icono_url: string | null
}
interface Empresa { nombre: string; slug: string; plan: string }

export default function ConfigPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    Promise.all([
      supabase.from('empresas').select('nombre, slug, plan').eq('id', ctx.empresaId).single(),
      supabase.from('empresa_config').select('primary_color, secondary_color, logo_url, texto_bienvenida, moneda, cuit, razon_social, condicion_iva, punto_venta, pwa_nombre, pwa_icono_url').eq('empresa_id', ctx.empresaId).single(),
    ]).then(([{ data: emp }, { data: cfg }]) => {
      if (emp) setEmpresa(emp)
      if (cfg) setConfig({
        ...cfg,
        cuit: cfg.cuit ?? '',
        razon_social: cfg.razon_social ?? '',
        condicion_iva: cfg.condicion_iva ?? 'RI',
        punto_venta: cfg.punto_venta ?? 1,
      })
    })
  }, [ctx])

  async function handleLogoUpload(file: File) {
    if (!ctx) return
    setUploadingLogo(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop()
    const path = `logos/${ctx.empresaSlug}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('productos').getPublicUrl(path)
      setConfig(prev => prev ? { ...prev, logo_url: data.publicUrl } : prev)
    }
    setUploadingLogo(false)
  }

  async function handleSave() {
    if (!ctx || !config) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('empresa_config').update({
      primary_color: config.primary_color,
      secondary_color: config.secondary_color,
      logo_url: config.logo_url,
      texto_bienvenida: config.texto_bienvenida,
      moneda: config.moneda,
      cuit: config.cuit || null,
      razon_social: config.razon_social || null,
      condicion_iva: config.condicion_iva || 'RI',
      punto_venta: config.punto_venta || 1,
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

        {/* Datos empresa */}
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

        {/* Logo */}
        <ConeCard title="Logo">
          <div className="space-y-3">
            {config.logo_url ? (
              <div className="relative h-28 rounded-xl overflow-hidden border border-neutral-200 bg-neutral-50 group">
                <Image src={config.logo_url} alt="Logo" fill className="object-contain p-3" />
                <button onClick={() => setConfig({ ...config, logo_url: null })}
                  className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => logoRef.current?.click()} disabled={uploadingLogo}
                className="w-full h-28 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 hover:bg-neutral-100 hover:border-neutral-300 transition-colors flex flex-col items-center justify-center gap-2 text-neutral-400 disabled:opacity-50">
                {uploadingLogo ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-5 w-5" />}
                <span className="text-sm font-medium">{uploadingLogo ? 'Subiendo...' : 'Subir logo'}</span>
                <span className="text-xs text-neutral-300">PNG, SVG recomendado</span>
              </button>
            )}
            <input ref={logoRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = '' }} />
            <p className="text-xs text-neutral-400">El logo aparece en el kiosk, display y login</p>
          </div>
        </ConeCard>

        {/* Personalización */}
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

        {/* Vista previa */}
        <ConeCard title="Vista previa">
          <div className="rounded-xl overflow-hidden border border-neutral-100">
            <div className="p-5 text-white flex items-center gap-3" style={{ backgroundColor: config.primary_color }}>
              {config.logo_url && <Image src={config.logo_url} alt="Logo" width={48} height={48} className="object-contain bg-white rounded-lg p-1" />}
              <div>
                <p className="font-bold text-lg">{config.texto_bienvenida || '¡Bienvenido!'}</p>
                <p className="text-white/60 text-sm">Color primario</p>
              </div>
            </div>
            <div className="p-4" style={{ backgroundColor: config.secondary_color }}>
              <p className="font-semibold text-sm" style={{ color: config.primary_color }}>Color secundario</p>
            </div>
          </div>
        </ConeCard>

        {/* App instalable PWA */}
        <ConeCard title="App instalable (PWA)">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre de la app</Label>
              <Input value={config.pwa_nombre ?? ''} onChange={e => setConfig({ ...config, pwa_nombre: e.target.value })}
                placeholder="Cecchetto Delivery" />
              <p className="text-xs text-neutral-400">Nombre que aparece al instalar la app en el celular. Vacío = nombre de la empresa.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Ícono de la app</Label>
              <p className="text-xs text-neutral-400 mb-2">PNG cuadrado, mínimo 192×192px, ideal 512×512.</p>
              {config.pwa_icono_url ? (
                <div className="flex items-center gap-3">
                  <img src={config.pwa_icono_url} alt="Ícono PWA" className="w-16 h-16 rounded-xl object-cover border border-neutral-200" />
                  <ConeButton variant="outline" onClick={() => setConfig({ ...config, pwa_icono_url: null })} icon={<X className="h-4 w-4" />}>Quitar</ConeButton>
                </div>
              ) : (
                <label className="flex items-center gap-2 px-4 py-2.5 border border-neutral-200 rounded-xl cursor-pointer hover:bg-neutral-50 transition-colors w-fit">
                  <Upload className="h-4 w-4 text-neutral-400" />
                  <span className="text-sm text-neutral-600">Subir ícono</span>
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={async e => {
                    const file = e.target.files?.[0]
                    if (!file || !ctx) return
                    const supabase = createClient()
                    const path = `pwa-icons/${ctx.empresaId}.png`
                    await supabase.storage.from('logos').upload(path, file, { upsert: true })
                    const { data } = supabase.storage.from('logos').getPublicUrl(path)
                    setConfig({ ...config, pwa_icono_url: data.publicUrl + '?v=' + Date.now() })
                  }} />
                </label>
              )}
            </div>
          </div>
        </ConeCard>

        {/* Datos fiscales */}
        <ConeCard title="Datos fiscales">
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <p className="text-xs text-blue-700 font-medium">Estos datos se usan para los tickets de caja. La integración con ARCA para facturación electrónica estará disponible próximamente.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Razón social</Label>
              <Input value={config.razon_social ?? ''} onChange={e => setConfig({ ...config, razon_social: e.target.value })} placeholder="Cecchetto S.R.L." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>CUIT</Label>
                <Input value={config.cuit ?? ''} onChange={e => setConfig({ ...config, cuit: e.target.value })} placeholder="30-12345678-9" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Condición IVA</Label>
                <select value={config.condicion_iva ?? 'RI'} onChange={e => setConfig({ ...config, condicion_iva: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400 bg-white">
                  <option value="RI">Responsable Inscripto</option>
                  <option value="MT">Monotributista</option>
                  <option value="EX">Exento</option>
                  <option value="CF">Consumidor Final</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Punto de venta</Label>
              <Input type="number" value={config.punto_venta ?? 1} onChange={e => setConfig({ ...config, punto_venta: Number(e.target.value) })} className="w-24 font-mono" />
              <p className="text-xs text-neutral-400">Número de punto de venta habilitado en AFIP</p>
            </div>
          </div>
        </ConeCard>

        {/* Pedidos */}
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

      </div>

      <div className="mt-6 flex justify-end">
        <ConeButton onClick={handleSave} loading={saving}>
          {saved ? <span className="flex items-center gap-1"><Check className="h-4 w-4" /> ¡Guardado!</span> : 'Guardar cambios'}
        </ConeButton>
      </div>
    </div>
  )
}
