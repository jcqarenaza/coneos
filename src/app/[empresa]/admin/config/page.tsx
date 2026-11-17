'use client'

import { avisar } from '@/components/admin/ConeDialog'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeCard } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Check, Upload, X } from 'lucide-react'
import { validarMinutosRepetidos, validarHorasPedidoActivo } from '@/lib/pedidos/repetidos-config'
import Image from 'next/image'
import Link from 'next/link'
import type { Cuit } from '@/components/admin/CuitsFacturacion'

interface Config {
  primary_color: string; secondary_color: string; logo_url: string | null
  texto_bienvenida: string; moneda: string
  cuit: string | null; razon_social: string | null; condicion_iva: string | null; punto_venta: number | null
  pwa_nombre: string | null; pwa_icono_url: string | null
  mostrar_agotados: boolean
  entrada_unificada: boolean
  prevenir_pedidos_repetidos: boolean
  pedidos_repetidos_minutos: string   // texto TAL CUAL lo escribe el usuario (no se trunca ni se corrige al tipear); se valida al guardar
  bloquear_pedidos_duplicados: boolean          // detección de posibles duplicados por teléfono + revisión en Caja (default OFF)
  pedido_activo_ventana_horas: string           // ventana (horas) para considerar "en curso" un pedido del mismo teléfono; texto TAL CUAL, se valida al guardar
}
interface Empresa { nombre: string; slug: string; plan: string }

/** Título con la explicación oculta: se muestra con doble clic sobre el título (o con el botón «i», para teclado y celular). Solo presentación. */
function TituloConAyuda({ titulo, ayuda }: { titulo: string; ayuda: string }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-neutral-700 cursor-help select-none" title="Doble clic para ver qué hace" onDoubleClick={() => setAbierta(a => !a)}>{titulo}</p>
        <button type="button" aria-label={`Qué hace: ${titulo}`} aria-expanded={abierta} onClick={() => setAbierta(a => !a)}
          className="flex-shrink-0 w-4 h-4 rounded-full border border-neutral-300 text-[10px] leading-none font-bold text-neutral-400 hover:text-neutral-600 hover:border-neutral-400">i</button>
      </div>
      {abierta && <p className="text-xs text-neutral-400 mt-1">{ayuda}</p>}
    </div>
  )
}

export default function ConfigPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [cuitsReales, setCuitsReales] = useState<Cuit[] | null>(null)  // CUITs que facturan, cargados en Cobros (solo lectura acá). null = cargando/sin acceso
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sucio, setSucio] = useState(false)
  const tocar = (parcial: Partial<typeof config> & object) => { setSucio(true); setConfig(c => c ? ({ ...c, ...parcial } as typeof c) : c) }
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  // Datos fiscales REALES: los CUITs que se configuraron en Cobros (facturacion_config). Solo lectura; si falla o no hay, queda el formulario clásico.
  useEffect(() => {
    if (!ctx) return
    let vivo = true
    ;(async () => {
      try {
        const { data: { session } } = await createClient().auth.getSession()
        if (!session) { if (vivo) setCuitsReales([]); return }
        const res = await fetch('/api/admin/cuits', { headers: { Authorization: `Bearer ${session.access_token}` } })
        if (!res.ok) { if (vivo) setCuitsReales([]); return }
        const d = await res.json()
        if (vivo) setCuitsReales(Array.isArray(d.cuits) ? d.cuits : [])
      } catch { if (vivo) setCuitsReales([]) /* sin CUITs reales: se muestra el formulario clásico */ }
    })()
    return () => { vivo = false }
  }, [ctx])

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    Promise.all([
      supabase.from('empresas').select('nombre, slug, plan').eq('id', ctx.empresaId).single(),
      supabase.from('empresa_config').select('primary_color, secondary_color, logo_url, texto_bienvenida, moneda, cuit, razon_social, condicion_iva, punto_venta, pwa_nombre, pwa_icono_url, mostrar_agotados, entrada_unificada, prevenir_pedidos_repetidos, pedidos_repetidos_minutos, bloquear_pedidos_duplicados, pedido_activo_ventana_horas').eq('empresa_id', ctx.empresaId).single(),
    ]).then(([{ data: emp }, { data: cfg }]) => {
      if (emp) setEmpresa(emp)
      if (cfg) {
        // columnas nuevas leídas con tipo explícito (este cliente de Supabase no tiene tipos generados y las infiere como never)
        const dup = cfg as unknown as { bloquear_pedidos_duplicados?: boolean | null; pedido_activo_ventana_horas?: number | null }
        setConfig({
          ...cfg,
          cuit: cfg.cuit ?? '',
          razon_social: cfg.razon_social ?? '',
          condicion_iva: cfg.condicion_iva ?? 'RI',
          punto_venta: cfg.punto_venta ?? 1,
          mostrar_agotados: cfg.mostrar_agotados ?? false,
          entrada_unificada: cfg.entrada_unificada ?? false,
          prevenir_pedidos_repetidos: cfg.prevenir_pedidos_repetidos ?? true,
          pedidos_repetidos_minutos: String(cfg.pedidos_repetidos_minutos ?? 30),
          bloquear_pedidos_duplicados: dup.bloquear_pedidos_duplicados ?? false,
          pedido_activo_ventana_horas: String(dup.pedido_activo_ventana_horas ?? 3),
        })
      }
    })
  }, [ctx])

  async function handleLogoUpload(file: File) {
    if (!ctx) return
    setUploadingLogo(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop()
    // Ciclo 1 (decisión CTO): URL INMUTABLE por subida — cada logo nuevo es un
    // archivo nuevo, y CDN/optimizador de Next/browser/canvas se refrescan por
    // construcción. Nada de ?v=: cache invalidation por diseño, no por parche.
    const path = `logos/${ctx.empresaSlug}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('productos').upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('productos').getPublicUrl(path)
      setConfig(prev => prev ? { ...prev, logo_url: data.publicUrl } : prev)
    }
    setUploadingLogo(false)
  }

  async function handleSave() {
    if (!ctx || !config) return
    // Pedidos repetidos: minutos ENTEROS entre 1 y 1440 (24 h) — mismo rango que el CHECK de la base. Se valida ANTES de guardar.
    const vMin = validarMinutosRepetidos(config.pedidos_repetidos_minutos)
    if (config.prevenir_pedidos_repetidos && !vMin.ok) {
      avisar('Pedidos repetidos: ingresá un tiempo en minutos, entero, entre 1 y 1440 (24 horas).'); return
    }
    const vHoras = validarHorasPedidoActivo(config.pedido_activo_ventana_horas)
    if (config.prevenir_pedidos_repetidos && config.bloquear_pedidos_duplicados && !vHoras.ok) {
      avisar('Posibles pedidos duplicados: ingresá un tiempo en horas, entero, entre 1 y 24.'); return
    }
    setSaving(true)
    const supabase = createClient()
    const upd = await supabase.from('empresa_config').update({
      primary_color: config.primary_color,
      secondary_color: config.secondary_color,
      logo_url: config.logo_url,
      texto_bienvenida: config.texto_bienvenida,
      moneda: config.moneda,
      cuit: config.cuit || null,
      razon_social: config.razon_social || null,
      condicion_iva: config.condicion_iva || 'RI',
      punto_venta: config.punto_venta || 1,
      pwa_nombre: config.pwa_nombre || null,
      pwa_icono_url: config.pwa_icono_url || null,
      mostrar_agotados: config.mostrar_agotados === true,
      entrada_unificada: config.entrada_unificada === true,
      prevenir_pedidos_repetidos: config.prevenir_pedidos_repetidos === true,
      // desactivada: se conserva el último valor válido (la base exige > 0 siempre)
      ...(vMin.ok ? { pedidos_repetidos_minutos: vMin.minutos } : {}),
      bloquear_pedidos_duplicados: config.bloquear_pedidos_duplicados === true,
      // apagado: se conserva el último valor válido (la base exige 1–24 siempre)
      ...(vHoras.ok ? { pedido_activo_ventana_horas: vHoras.horas } : {}),
    }).eq('empresa_id', ctx.empresaId)
    setSaving(false)
    if (upd.error) { avisar(`No se pudo guardar: ${upd.error.message}`); return }
    setSucio(false)
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  if (ctxLoading || !config || !empresa) return (
    <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  return (
    <div>
      <ConePageHeader title="Configuración" description="Datos de empresa y preferencias del sistema" />
      {/* Datos de la empresa: solo lectura — banner (para cambios: soporte) */}
      <div className="mb-4 bg-neutral-50 border border-neutral-100 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="font-bold text-neutral-700">{empresa.nombre}</span>
        <span className="font-mono text-xs text-neutral-400">/{empresa.slug}</span>
        <span className="text-xs text-neutral-300 ml-auto">Para cambiar estos datos contactá a soporte</span>
      </div>
      <div className="mb-4 flex justify-end items-center">
        <span className={`text-xs font-bold text-amber-600 mr-3 transition-opacity ${sucio && !saving ? 'opacity-100' : 'opacity-0'}`}>● Hay cambios sin guardar</span>
        <ConeButton onClick={handleSave} loading={saving}>
          {saved ? <span className="flex items-center gap-1"><Check className="h-4 w-4" /> ¡Guardado!</span> : 'Guardar cambios'}
        </ConeButton>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

        <ConeCard title="Datos fiscales">
          {cuitsReales === null ? (
            <div className="flex justify-center py-10" aria-label="Cargando datos fiscales"><Loader2 className="h-5 w-5 animate-spin text-neutral-300" /></div>
          ) : cuitsReales.length > 0 ? (
            <div className="space-y-3">
              {cuitsReales.map(c => {
                const emite = c.activo && c.estado === 'validado'
                return (
                  <div key={c.id} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-neutral-800 min-w-0 break-words">{c.razon_social}</p>
                      <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${emite ? 'bg-green-50 text-green-700' : c.estado === 'borrador' ? 'bg-amber-50 text-amber-700' : 'bg-neutral-100 text-neutral-500'}`}>
                        {emite ? 'Emite facturas' : c.estado === 'borrador' ? 'Pendiente de validar' : 'Desactivado'}
                      </span>
                    </div>
                    <p className="text-sm font-mono text-neutral-600">{c.cuit}</p>
                    <p className="text-xs text-neutral-500">{c.condicion_fiscal === 'ri' ? 'Responsable Inscripto' : 'Monotributista'} · Punto de venta {c.punto_venta}</p>
                  </div>
                )
              })}
              <p className="text-xs text-neutral-400">Estos son los CUITs que cargaste en Cobros. Para agregar, editar o activar uno entrá a{' '}
                {ctx ? <Link href={`/${ctx.empresaSlug}/admin/cuentas`} className="font-semibold text-neutral-600 underline underline-offset-2">Cobros → 🧾 CUITs</Link> : 'Cobros → 🧾 CUITs'}.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="space-y-1">
                <Label>Razón social</Label>
                <Input value={config.razon_social ?? ''} onChange={e => tocar({ razon_social: e.target.value })} placeholder="Cecchetto S.R.L." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>CUIT</Label>
                  <Input value={config.cuit ?? ''} onChange={e => tocar({ cuit: e.target.value })} placeholder="30-12345678-9" className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label>Condición IVA</Label>
                  <select value={config.condicion_iva ?? 'RI'} onChange={e => tocar({ condicion_iva: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400 bg-white">
                    <option value="RI">Responsable Inscripto</option>
                    <option value="MT">Monotributista</option>
                    <option value="EX">Exento</option>
                    <option value="CF">Consumidor Final</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Punto de venta</Label>
                <Input type="number" value={config.punto_venta ?? 1} onChange={e => tocar({ punto_venta: Number(e.target.value) })} className="w-24 font-mono" />
                <p className="text-xs text-neutral-400">Número de punto de venta habilitado en AFIP</p>
              </div>
            </div>
          )}
        </ConeCard>

        <ConeCard title="Configuración de pedidos">
          <div className="space-y-2.5">
            <div className="space-y-1">
              <Label>Moneda</Label>
              <Input value={config.moneda} onChange={e => tocar({ moneda: e.target.value })} placeholder="ARS" className="w-32" />
            </div>
            {/* Toggle agotados (default OFF = ocultar, comportamiento histórico) */}
            <div className="w-full flex items-center justify-between gap-3 p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <TituloConAyuda titulo="Mostrar productos agotados en el catálogo"
                ayuda={'Encendido: el producto sin stock se ve griseado como "Agotado" (no se puede comprar). Apagado: desaparece del catálogo hasta que vuelva el stock.'} />
              <button type="button" role="switch" aria-checked={config.mostrar_agotados} aria-label="Mostrar productos agotados en el catálogo"
                onClick={() => tocar({ mostrar_agotados: !config.mostrar_agotados })}
                className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${config.mostrar_agotados ? 'bg-neutral-800' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.mostrar_agotados ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
            {/* Ciclo 2 — Entrada unificada de pedidos (default OFF: la ruta
                /pedidos/ es inalcanzable hasta encender esto; las URLs y QR
                actuales de delivery/TA funcionan SIEMPRE, con esto ON u OFF) */}
            <div className="w-full flex items-center justify-between gap-3 p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <TituloConAyuda titulo="App de pedidos de la marca"
                ayuda="Encendida: la app y el QR ofrecen elegir entre Delivery y Take Away (según qué esté disponible). Apagada: todo sigue exactamente como hasta ahora. Los links y QR actuales funcionan siempre." />
              <button type="button" role="switch" aria-checked={config.entrada_unificada} aria-label="App de pedidos de la marca"
                onClick={() => tocar({ entrada_unificada: !config.entrada_unificada })}
                className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${config.entrada_unificada ? 'bg-neutral-800' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.entrada_unificada ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
            {/* Prevención de pedidos repetidos (GO CTO 8/11): el negocio define si se avisa y durante cuántos minutos */}
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 space-y-3">
              <div className="w-full flex items-center justify-between gap-3">
                <TituloConAyuda titulo="Avisar al cliente si envía un pedido idéntico"
                  ayuda="Si el cliente vuelve a enviar el mismo pedido dentro del tiempo configurado, le preguntamos si realmente quiere generar otro. Puede continuar si se trata de una nueva compra. No requiere intervención de Caja." />
                <button type="button" role="switch" aria-checked={config.prevenir_pedidos_repetidos} aria-label="Avisar al cliente si envía un pedido idéntico"
                  onClick={() => tocar({ prevenir_pedidos_repetidos: !config.prevenir_pedidos_repetidos })}
                  className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${config.prevenir_pedidos_repetidos ? 'bg-neutral-800' : 'bg-neutral-200'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.prevenir_pedidos_repetidos ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
              {config.prevenir_pedidos_repetidos && (
                <div className="space-y-1">
                  <Label>Comparar pedidos de los últimos (minutos)</Label>
                  <Input type="text" inputMode="numeric" autoComplete="off" value={config.pedidos_repetidos_minutos}
                    onChange={e => tocar({ pedidos_repetidos_minutos: e.target.value })}
                    className="w-32" aria-invalid={!validarMinutosRepetidos(config.pedidos_repetidos_minutos).ok} />
                  <p className="text-xs text-neutral-400">Entre 1 y 1440 minutos (24 horas). Ejemplos: 2 para un kiosco ágil, 30 para una cocina con tiempos largos.</p>
                </div>
              )}
              {/* Posibles pedidos duplicados por teléfono (CTO 14/11): misma ubicación que el aviso de repetidos. OFF por defecto; por negocio. */}
              {config.prevenir_pedidos_repetidos && (
                <div className="pt-3 border-t border-neutral-200 space-y-3">
                  <div className="w-full flex items-center justify-between gap-3">
                    <TituloConAyuda titulo="Revisar nuevos pedidos si el teléfono ya tiene uno activo"
                      ayuda="Si un teléfono ya tiene un pedido en curso dentro del tiempo configurado, el nuevo pedido queda en revisión en Caja. El personal puede comparar ambos pedidos y decidir si es una compra legítima o un duplicado. No se cancela ni se rechaza automáticamente." />
                    <button type="button" role="switch" aria-checked={config.bloquear_pedidos_duplicados} aria-label="Revisar nuevos pedidos si el teléfono ya tiene uno activo"
                      onClick={() => tocar({ bloquear_pedidos_duplicados: !config.bloquear_pedidos_duplicados })}
                      className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative ${config.bloquear_pedidos_duplicados ? 'bg-neutral-800' : 'bg-neutral-200'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${config.bloquear_pedidos_duplicados ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <Label>Considerar activo un pedido del mismo teléfono durante (horas)</Label>
                    <Input type="text" inputMode="numeric" autoComplete="off" value={config.pedido_activo_ventana_horas}
                      onChange={e => tocar({ pedido_activo_ventana_horas: e.target.value })}
                      className="w-32" aria-invalid={!validarHorasPedidoActivo(config.pedido_activo_ventana_horas).ok} />
                    <p className="text-xs text-neutral-400">Entre 1 y 24 horas (por defecto 3). El teléfono es solo una señal para detectar posibles coincidencias: no confirma que sea la misma persona.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
              <TituloConAyuda titulo="Numeración de pedidos" ayuda="Numeración correlativa por empresa. El número nunca se reinicia." />
            </div>
          </div>
        </ConeCard>

        <ConeCard title="App instalable (PWA)">
          <div className="space-y-2.5">
            <div className="space-y-1">
              <Label>Nombre de la app</Label>
              <Input value={config.pwa_nombre ?? ''} onChange={e => tocar({ pwa_nombre: e.target.value })}
                placeholder="Cecchetto Delivery" />
              <p className="text-xs text-neutral-400">Nombre que aparece al instalar la app en el celular. Vacío = nombre de la empresa.</p>
            </div>
            <div className="space-y-1">
              <Label>Ícono de la app</Label>
              <p className="text-xs text-neutral-400 mb-2">PNG cuadrado, mínimo 192×192px, ideal 512×512.</p>
              {config.pwa_icono_url ? (
                <div className="flex items-center gap-3">
                  <img src={config.pwa_icono_url} alt="Ícono PWA" className="w-16 h-16 rounded-xl object-cover border border-neutral-200" />
                  <ConeButton variant="outline" onClick={() => tocar({ pwa_icono_url: null })} icon={<X className="h-4 w-4" />}>Quitar</ConeButton>
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
                    tocar({ pwa_icono_url: data.publicUrl + '?v=' + Date.now() })
                  }} />
                </label>
              )}
            </div>
          </div>
        </ConeCard>

        <ConeCard title="Personalización">
          <div className="space-y-2.5">
            <div className="space-y-1">
              <Label>Mensaje de bienvenida (Kiosk)</Label>
              <Input value={config.texto_bienvenida} onChange={e => tocar({ texto_bienvenida: e.target.value })} placeholder="¡Bienvenido!" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Color primario</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={config.primary_color} onChange={e => tocar({ primary_color: e.target.value })} className="w-10 h-10 rounded-lg cursor-pointer border border-neutral-200" />
                  <Input value={config.primary_color} onChange={e => tocar({ primary_color: e.target.value })} className="font-mono text-sm" maxLength={7} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Color secundario</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={config.secondary_color} onChange={e => tocar({ secondary_color: e.target.value })} className="w-10 h-10 rounded-lg cursor-pointer border border-neutral-200" />
                  <Input value={config.secondary_color} onChange={e => tocar({ secondary_color: e.target.value })} className="font-mono text-sm" maxLength={7} />
                </div>
              </div>
            </div>
          </div>
        </ConeCard>

        <ConeCard title="Logo">
          <div className="space-y-3">
            {config.logo_url ? (
              <div className="relative h-28 rounded-xl overflow-hidden border border-neutral-200 bg-neutral-50 group">
                <Image src={config.logo_url} alt="Logo" fill className="object-contain p-3" />
                <button onClick={() => tocar({ logo_url: null })}
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

      </div>

    </div>
  )
}
