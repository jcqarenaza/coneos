'use client'

// ═══════════════════════════════════════════════════════════════════
// CICLO 3 — CASA DE SERVICIOS Y HORARIOS (V1)
// UNA casa para configurar cuándo y cómo atiende cada servicio de la
// sucursal. NO crea fuentes nuevas: edita las TRES que ya gobiernan
// todo el sistema (mismo principio que la casa de pagos):
//   🏪 Negocio/Kiosk → sucursales.horario_general + mensaje_cerrado
//                       + tolerancia_cierre (el kiosk abre con el local)
//   🛵 Delivery      → delivery_config (activo, PAUSA por lluvia con su
//                       mensaje, franjas, tolerancia, mensaje cerrado)
//   🥡 Take Away     → takeaway_config (activo, franjas, tolerancia,
//                       mensaje cerrado)
// Consumidores (App Pública, contextos, kiosk, caja) NO se tocan: ya
// leen de estas fuentes. Franjas vacías = abierto siempre (semántica
// vigente del sistema, se respeta y se explica en la UI).
// El modal de Sucursales convive por ahora; su poda es el paso 2 del
// ciclo, con la casa probada (molde del Ciclo 1).
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeCard } from '@/components/admin/ConeComponents'
import { Loader2, Plus, X, CloudRain, Lock } from 'lucide-react'
import DispositivosTab from '@/components/admin/DispositivosTab'
import QrAccesosTab from '@/components/admin/QrAccesosTab'
import SucursalesTab from '@/components/admin/SucursalesTab'
import EquipoTab from '@/components/admin/EquipoTab'

interface Franja { desde: string; hasta: string }
interface Sucursal { id: string; nombre: string; slug: string }

type PorDia = Partial<Record<string, Franja[]>>
interface NegocioCfg { horario_general: Franja[]; mensaje_cerrado: string; tolerancia_cierre: number; dias_apertura: number[] | null; horario_por_dia: PorDia | null }
interface DeliveryCfg { activo: boolean; pausado: boolean; mensaje_pausa: string; horarios: Franja[]; mensaje_fuera_horario: string; tolerancia_cierre: number; costo_envio: number; envio_al_cadete: boolean; mostrar_en_app: boolean; permitir_programado: boolean }
interface TaCfg { activo: boolean; horarios: Franja[]; mensaje_fuera_horario: string; tolerancia_cierre: number; costo_servicio: number; acepta_anticipado: boolean; mostrar_en_app: boolean }

// ── Editor de franjas horarias (compartido por las tres tarjetas) ──
function FranjasEditor({ franjas, onChange, deshabilitado }: { franjas: Franja[]; onChange: (f: Franja[]) => void; deshabilitado?: boolean }) {
  return (
    <div className="space-y-2">
      {franjas.length === 0 && (
        <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2">Sin franjas cargadas = <b>abierto siempre</b>. Agregá franjas para limitar el horario.</p>
      )}
      {franjas.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="time" value={f.desde} disabled={deshabilitado}
            onChange={e => onChange(franjas.map((x, j) => j === i ? { ...x, desde: e.target.value } : x))}
            className="px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700 disabled:opacity-40" />
          <span className="text-xs text-neutral-400">a</span>
          <input type="time" value={f.hasta} disabled={deshabilitado}
            onChange={e => onChange(franjas.map((x, j) => j === i ? { ...x, hasta: e.target.value } : x))}
            className="px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700 disabled:opacity-40" />
          <button onClick={() => onChange(franjas.filter((_, j) => j !== i))} disabled={deshabilitado}
            className="p-1.5 text-neutral-300 hover:text-red-500 rounded-lg disabled:opacity-40" title="Quitar franja">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...franjas, { desde: '18:00', hasta: '23:30' }])} disabled={deshabilitado}
        className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-700 px-2 py-1 rounded-lg hover:bg-neutral-50 disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> Agregar franja
      </button>
      <p className="text-[11px] text-neutral-300">Una franja que cruza medianoche (ej. 20:00 a 01:00) vale — el sistema la entiende.</p>
    </div>
  )
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative disabled:opacity-40 ${on ? 'bg-neutral-800' : 'bg-neutral-200'}`}>
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

const inp = 'w-full px-3 py-2 rounded-xl border border-neutral-200 text-sm bg-white text-neutral-700'

export default function ServiciosPage() {
  // useEmpresa devuelve { ctx, loading } — consumirlo como en Cuentas
  const { ctx, loading: ctxLoading } = useEmpresa()
  // Cliente ÚNICO (memoizado): crearlo por render hacía cambiar la identidad
  // de cargar() y el efecto se re-disparaba infinito — spinner eterno
  const supabase = useMemo(() => createClient(), [])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalSel, setSucursalSel] = useState('')
  const [negocio, setNegocio] = useState<NegocioCfg | null>(null)
  const [delivery, setDelivery] = useState<DeliveryCfg | null>(null)
  const [ta, setTa] = useState<TaCfg | null>(null)
  const [tieneDelivery, setTieneDelivery] = useState(true)
  const [tieneTa, setTieneTa] = useState(true)
  const [tieneMesas, setTieneMesas] = useState(false)
  const [mesasActivo, setMesasActivo] = useState(true)
  const [modalMesas, setModalMesas] = useState(false)
  const [appEncendida, setAppEncendida] = useState(false)
  const [dispTodas, setDispTodas] = useState(true) // Dispositivos: la central arranca viendo TODO
  // Tab App UNIFICADA: canales visibles de TODAS las sucursales (la puerta es una)
  const [visiblesApp, setVisiblesApp] = useState<Record<string, { d: boolean; t: boolean; dActivo: boolean; tActivo: boolean }>>({})
  const [soporte, setSoporte] = useState<{ nombre: string; wa: string }>({ nombre: 'QP C&IA', wa: '542302456497' })
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [sucio, setSucio] = useState(false)
  // Orden de flujo (decisión JC): creás el dispositivo → horarios y servicios → mensajes → QR
  const [tab, setTab] = useState<'sucursales' | 'dispositivos' | 'equipo' | 'servicios' | 'mensajes' | 'app' | 'qr'>('dispositivos')
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const avisar = (m: string) => { setAviso(m); setTimeout(() => setAviso(null), 2500) }

  const cargar = useCallback(async (sucId: string) => {
    if (!ctx?.empresaId || !sucId) return
    setCargando(true)
    const [{ data: suc }, { data: dc }, { data: tc }, { data: cfg }] = await Promise.all([
      supabase.from('sucursales').select('horario_general, mensaje_cerrado, tolerancia_cierre, dias_apertura, horario_por_dia').eq('id', sucId).maybeSingle(),
      supabase.from('delivery_config').select('activo, pausado, mensaje_pausa, horarios, mensaje_fuera_horario, tolerancia_cierre, costo_envio, envio_al_cadete, mostrar_en_app, permitir_programado').eq('sucursal_id', sucId).maybeSingle(),
      supabase.from('takeaway_config').select('activo, horarios, mensaje_fuera_horario, tolerancia_cierre, costo_servicio, acepta_anticipado, mostrar_en_app').eq('sucursal_id', sucId).maybeSingle(),
      supabase.from('empresa_config').select('modulos, mesas_activo, soporte_nombre, soporte_whatsapp, entrada_unificada').eq('empresa_id', ctx.empresaId).maybeSingle(),
    ])
    const mods = (cfg?.modulos ?? {}) as Record<string, boolean>
    setTieneDelivery(mods.delivery !== false)
    setTieneTa(mods.takeaway !== false)
    setTieneMesas(mods.mesas === true)
    setMesasActivo(cfg?.mesas_activo !== false)
    setAppEncendida(cfg?.entrada_unificada === true)
    if (cfg?.soporte_whatsapp) setSoporte({ nombre: cfg.soporte_nombre ?? 'tu proveedor', wa: String(cfg.soporte_whatsapp).replace(/\D/g, '') })
    setNegocio({
      horario_general: (suc?.horario_general as Franja[] | null) ?? [],
      dias_apertura: (suc?.dias_apertura as number[] | null) ?? null,
      horario_por_dia: (suc?.horario_por_dia as PorDia | null) ?? null,
      mensaje_cerrado: suc?.mensaje_cerrado ?? '',
      tolerancia_cierre: Number(suc?.tolerancia_cierre ?? 5),
    })
    setDelivery({
      activo: dc?.activo ?? false,
      pausado: dc?.pausado ?? false,
      mensaje_pausa: dc?.mensaje_pausa ?? '',
      horarios: (dc?.horarios as Franja[] | null) ?? [],
      mensaje_fuera_horario: dc?.mensaje_fuera_horario ?? '',
      tolerancia_cierre: Number(dc?.tolerancia_cierre ?? 5),
      costo_envio: Number(dc?.costo_envio ?? 0),
      envio_al_cadete: dc?.envio_al_cadete === true,
      mostrar_en_app: dc?.mostrar_en_app !== false,
      permitir_programado: dc?.permitir_programado === true,
    })
    setTa({
      activo: tc?.activo ?? false,
      horarios: (tc?.horarios as Franja[] | null) ?? [],
      mensaje_fuera_horario: tc?.mensaje_fuera_horario ?? '',
      tolerancia_cierre: Number(tc?.tolerancia_cierre ?? 5),
      costo_servicio: Number(tc?.costo_servicio ?? 0),
      acepta_anticipado: tc?.acepta_anticipado === true,
      mostrar_en_app: tc?.mostrar_en_app !== false,
    })
    setCargando(false)
    setSucio(false)
  }, [ctx?.empresaId, supabase])

  useEffect(() => {
    if (!ctx?.empresaId) return
    supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', ctx.empresaId).eq('activo', true).order('nombre')
      .then(({ data }) => {
        const lista = (data ?? []) as Sucursal[]
        setSucursales(lista)
        // canales visibles de toda la empresa para la tab App
        if (lista.length > 0) {
          const ids = lista.map(s => s.id)
          Promise.all([
            supabase.from('delivery_config').select('sucursal_id, activo, mostrar_en_app').in('sucursal_id', ids),
            supabase.from('takeaway_config').select('sucursal_id, activo, mostrar_en_app').in('sucursal_id', ids),
          ]).then(([{ data: dcs }, { data: tcs }]) => {
            const mapa: Record<string, { d: boolean; t: boolean; dActivo: boolean; tActivo: boolean }> = {}
            for (const s of lista) {
              const dc = (dcs ?? []).find(x => x.sucursal_id === s.id)
              const tc = (tcs ?? []).find(x => x.sucursal_id === s.id)
              mapa[s.id] = { d: dc?.mostrar_en_app !== false, t: tc?.mostrar_en_app !== false, dActivo: dc?.activo === true, tActivo: tc?.activo === true }
            }
            setVisiblesApp(mapa)
          })
        }
        if (lista.length > 0) { setSucursalSel(lista[0].id); cargar(lista[0].id) }
        else setCargando(false)
      })
  }, [ctx?.empresaId, supabase, cargar])

  // UN solo Guardar (pedido JC): las tres fuentes en una pasada, todo o se avisa
  async function guardarTodo() {
    if (!negocio || !delivery || !ta || !sucursalSel || !ctx?.empresaId) return
    setGuardando('todo'); setError(null)
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('sucursales').update({
        horario_general: negocio.horario_general,
        mensaje_cerrado: negocio.mensaje_cerrado || null,
        tolerancia_cierre: negocio.tolerancia_cierre,
        dias_apertura: (negocio.dias_apertura && negocio.dias_apertura.length < 7) ? negocio.dias_apertura : null,
      horario_por_dia: negocio.horario_por_dia,
        horario_por_dia: negocio.horario_por_dia,
      }).eq('id', sucursalSel),
      supabase.from('delivery_config').upsert({
        sucursal_id: sucursalSel, empresa_id: ctx.empresaId,
        activo: delivery.activo, pausado: delivery.pausado,
        mensaje_pausa: delivery.mensaje_pausa || null,
        horarios: delivery.horarios,
        mensaje_fuera_horario: delivery.mensaje_fuera_horario || null,
        tolerancia_cierre: delivery.tolerancia_cierre,
        costo_envio: delivery.costo_envio,
        envio_al_cadete: delivery.envio_al_cadete,
        permitir_programado: delivery.permitir_programado,
      }, { onConflict: 'sucursal_id' }),
      supabase.from('takeaway_config').upsert({
        sucursal_id: sucursalSel, empresa_id: ctx.empresaId,
        activo: ta.activo, horarios: ta.horarios,
        mensaje_fuera_horario: ta.mensaje_fuera_horario || null,
        tolerancia_cierre: ta.tolerancia_cierre,
        costo_servicio: ta.costo_servicio,
        acepta_anticipado: ta.acepta_anticipado,
      }, { onConflict: 'sucursal_id' }),
      ...(tieneMesas ? [supabase.from('empresa_config').update({ mesas_activo: mesasActivo, entrada_unificada: appEncendida }).eq('empresa_id', ctx.empresaId)] : []),
    ])
    setGuardando(null)
    // Tab App: persistir canales visibles de TODAS las sucursales (fuente única)
    await Promise.all(Object.entries(visiblesApp).flatMap(([sid, v]) => [
      supabase.from('delivery_config').update({ mostrar_en_app: v.d }).eq('sucursal_id', sid),
      supabase.from('takeaway_config').update({ mostrar_en_app: v.t }).eq('sucursal_id', sid),
    ]))
    const errs = [r1.error && `negocio: ${r1.error.message}`, r2.error && `delivery: ${r2.error.message}`, r3.error && `take away: ${r3.error.message}`, r4?.error && `mesas: ${r4.error.message}`].filter(Boolean)
    if (errs.length) { setError(`No se pudo guardar — ${errs.join(' · ')}`); return }
    setSucio(false)
    avisar(delivery.pausado ? 'Guardado — Delivery quedó EN PAUSA' : 'Guardado')
    cargar(sucursalSel)
  }

  async function guardarNegocio() {
    if (!negocio || !sucursalSel) return
    setGuardando('negocio'); setError(null)
    const { error: e } = await supabase.from('sucursales').update({
      horario_general: negocio.horario_general,
      mensaje_cerrado: negocio.mensaje_cerrado || null,
      tolerancia_cierre: negocio.tolerancia_cierre,
      dias_apertura: (negocio.dias_apertura && negocio.dias_apertura.length < 7) ? negocio.dias_apertura : null,
      horario_por_dia: negocio.horario_por_dia,
    }).eq('id', sucursalSel)
    setGuardando(null)
    if (e) { setError(`No se pudo guardar el horario del negocio: ${e.message}`); return }
    avisar('Horario del negocio guardado')
    cargar(sucursalSel)
  }

  async function guardarDelivery() {
    if (!delivery || !sucursalSel || !ctx?.empresaId) return
    setGuardando('delivery'); setError(null)
    const { error: e } = await supabase.from('delivery_config').upsert({
      sucursal_id: sucursalSel,
      empresa_id: ctx.empresaId,
      activo: delivery.activo,
      pausado: delivery.pausado,
      mensaje_pausa: delivery.mensaje_pausa || null,
      horarios: delivery.horarios,
      mensaje_fuera_horario: delivery.mensaje_fuera_horario || null,
      tolerancia_cierre: delivery.tolerancia_cierre,
    }, { onConflict: 'sucursal_id' })
    setGuardando(null)
    if (e) { setError(`No se pudo guardar Delivery: ${e.message}`); return }
    avisar(delivery.pausado ? 'Delivery guardado — quedó EN PAUSA' : 'Delivery guardado')
    cargar(sucursalSel)
  }

  async function guardarTa() {
    if (!ta || !sucursalSel || !ctx?.empresaId) return
    setGuardando('ta'); setError(null)
    const { error: e } = await supabase.from('takeaway_config').upsert({
      sucursal_id: sucursalSel,
      empresa_id: ctx.empresaId,
      activo: ta.activo,
      horarios: ta.horarios,
      mensaje_fuera_horario: ta.mensaje_fuera_horario || null,
      tolerancia_cierre: ta.tolerancia_cierre,
    }, { onConflict: 'sucursal_id' })
    setGuardando(null)
    if (e) { setError(`No se pudo guardar Take Away: ${e.message}`); return }
    avisar('Take Away guardado')
    cargar(sucursalSel)
  }

  if (ctxLoading || !ctx || cargando) return (
    <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  const BotonGuardar = ({ id, onClick }: { id: string; onClick: () => void }) => (
    <button onClick={onClick} disabled={guardando !== null}
      className="px-5 py-2 rounded-xl bg-neutral-800 text-white text-sm font-bold hover:bg-neutral-700 disabled:opacity-50 transition-colors">
      {guardando === id ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'Guardar'}
    </button>
  )

  return (
    <div className="space-y-5">
      <ConePageHeader title="Configuración del negocio" description="La casa operativa de la sucursal: dispositivos, equipo, horarios, mensajes y accesos — todo en un solo lugar" />

      {aviso && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-green-600 text-white rounded-full text-sm font-semibold shadow-lg pointer-events-none">✓ {aviso}</div>}
      {error && <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 font-medium">{error}</div>}

      <div className="flex gap-2">
        {([['sucursales', '🏢 Sucursales'], ['dispositivos', '🔧 Dispositivos'], ['equipo', '👥 Equipo'], ['servicios', '🕗 Horarios y servicios'], ['mensajes', '💬 Mensajes'], ['app', '🌐 App'], ['qr', '📱 QR y accesos']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${tab === id ? 'bg-neutral-800 text-white' : 'bg-white border border-neutral-200 text-neutral-500 hover:border-neutral-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ TAB DISPOSITIVOS (tokens/URLs/modal idénticos a siempre) ═══ */}
      {/* Selector de sucursal — gobierna las tabs POR SUCURSAL (horarios,
          mensajes, app). Dispositivos/Equipo/QR manejan lo suyo adentro. */}
      {(tab === 'servicios' || tab === 'mensajes' || tab === 'qr' || tab === 'dispositivos') && sucursales.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-neutral-400 uppercase tracking-wide">Sucursal</span>
          <select value={tab === 'dispositivos' && dispTodas ? '' : sucursalSel}
            onChange={e => {
              if (e.target.value === '') { setDispTodas(true); return }
              setDispTodas(false); setSucursalSel(e.target.value); cargar(e.target.value); setSucio(false)
            }}
            className="px-3 py-2 rounded-xl border border-neutral-200 text-sm font-semibold bg-white text-neutral-700">
            {tab === 'dispositivos' && <option value="">Todas las sucursales</option>}
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      )}

      {tab === 'sucursales' && <SucursalesTab />}
      {tab === 'dispositivos' && <DispositivosTab sucursalId={sucursales.length > 1 && !dispTodas ? sucursalSel : undefined} />}

      {/* ═══ TAB EQUIPO (Operadores + Colaboradores unificados, mudados de Operación) ═══ */}
      {tab === 'equipo' && <EquipoTab />}

      {/* ═══ TAB QR Y ACCESOS (entradas públicas + mesas, dominio canónico) ═══ */}
      {tab === 'app' && (
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-6 space-y-6 max-w-2xl">
          {/* FIX (JC 23/09): la tab App no tenía Guardar — los toggles cambiaban
              estado pero nada persistía. Mismo guardarTodo de la casa. */}
          <div className="flex items-center justify-end gap-2 pb-4 border-b border-neutral-50">
            <span className={`text-xs font-bold text-amber-600 transition-opacity ${sucio ? 'opacity-100' : 'opacity-0'}`}>● Hay cambios sin guardar</span>
            <BotonGuardar id="todo" onClick={guardarTodo} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <div>
                <p className="font-bold text-neutral-800">🌐 App Pública (entrada unificada)</p>
                <p className="text-xs text-neutral-400">La puerta única de la empresa: el cliente entra y elige. <b>Una sola App para todas las sucursales.</b></p>
              </div>
              <Toggle on={appEncendida} onClick={() => { setSucio(true); setAppEncendida(!appEncendida) }} />
            </div>
            <p className="text-[11px] text-neutral-300 mt-1">Con la App encendida, el QR de delivery de siempre lleva a la puerta (el token viaja solo). Apagada: cada QR va directo a su servicio, como siempre.</p>
          </div>
          <div className="border-t border-neutral-50 pt-5">
            <p className="font-bold text-neutral-800 mb-1">Qué ofrece la puerta, por sucursal</p>
            <p className="text-xs text-neutral-400 mb-3">Cada sucursal declara sus canales visibles. El canal sigue OPERANDO por su link/QR directo aunque no se muestre (marcha blanda).</p>
            <div className="divide-y divide-neutral-50">
              {sucursales.map(s => {
                const v = visiblesApp[s.id]
                if (!v) return null
                return (
                  <div key={s.id} className="py-3 flex items-center gap-4">
                    <p className="flex-1 text-sm font-bold text-neutral-700">{s.nombre}</p>
                    <div className="flex items-center gap-2" title={v.dActivo ? '¿Se muestra Delivery de esta sucursal en la App?' : 'Delivery inactivo en esta sucursal'}>
                      <span className="text-xs font-semibold text-neutral-500">🛵</span>
                      <Toggle on={v.d} onClick={() => { setSucio(true); setVisiblesApp(prev => ({ ...prev, [s.id]: { ...v, d: !v.d } })) }} disabled={!v.dActivo} />
                    </div>
                    <div className="flex items-center gap-2" title={v.tActivo ? '¿Se muestra Take Away de esta sucursal en la App?' : 'Take Away inactivo en esta sucursal'}>
                      <span className="text-xs font-semibold text-neutral-500">🥡</span>
                      <Toggle on={v.t} onClick={() => { setSucio(true); setVisiblesApp(prev => ({ ...prev, [s.id]: { ...v, t: !v.t } })) }} disabled={!v.tActivo} />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-neutral-300 mt-2">Los QRs de entrada viven en <b>📱 QR y accesos</b>. La puerta multi-sucursal (un Delivery + retiro por sucursal) llega en su ciclo — estos toggles ya son su configuración.</p>
          </div>
        </div>
      )}
      {tab === 'qr' && <QrAccesosTab sucursalId={sucursalSel} />}

      {tab === 'servicios' && (
      <ConeCard>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-bold text-neutral-800">Qué servicio atiende y cuándo</h3>
          <div className="flex items-center gap-2">
          <span className={`text-xs font-bold text-amber-600 mr-2 transition-opacity ${sucio ? 'opacity-100' : 'opacity-0'}`}>● Hay cambios sin guardar</span><BotonGuardar id="todo" onClick={guardarTodo} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-neutral-400 uppercase tracking-wide">
                <th className="py-2 pr-3 font-semibold">Servicio</th>
                <th className="py-2 pr-3 font-semibold">Activo</th>
                <th className="py-2 pr-3 font-semibold">Franjas horarias</th>
                <th className="py-2 pr-3 font-semibold">Tolerancia</th>
                <th className="py-2 pr-3 font-semibold">Costo</th>
                <th className="py-2 font-semibold">Pausa</th>
              </tr>
            </thead>
            <tbody>
              {/* ── 🏪 NEGOCIO / KIOSK ── */}
              {negocio && (
                <tr className="border-t border-neutral-100 align-top">
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-neutral-700 whitespace-nowrap">🏪 Negocio</p>
                    <p className="text-[11px] text-neutral-400">rige el Kiosk y techa el Delivery</p>
                  </td>
                  <td className="py-3 pr-3"><span className="min-w-[52px] inline-block text-center px-2 py-1 rounded-full text-[11px] font-bold bg-neutral-50 text-neutral-400 border border-neutral-200">Siempre</span></td>
                  <td className="py-3 pr-3 min-w-[230px]">
                    {/* 🗓️ Modo (demanda real Cecchetto): mismo horario todos los días,
                        u horarios POR DÍA (L-V uno, S-D otro). horario_por_dia null
                        = modo simple (inercia total). Los chips de día valen en ambos. */}
                    <div className="flex items-center gap-2 mb-2">
                      <Toggle on={!!negocio.horario_por_dia} onClick={() => {
                        setSucio(true)
                        if (negocio.horario_por_dia) { setNegocio({ ...negocio, horario_por_dia: null }); return }
                        const semilla: PorDia = {}
                        for (let d = 0; d <= 6; d++) semilla[String(d)] = negocio.horario_general.map(f => ({ ...f }))
                        setNegocio({ ...negocio, horario_por_dia: semilla })
                      }} />
                      <span className="text-[11px] font-semibold text-neutral-500">🗓️ Horarios por día</span>
                    </div>
                    {!negocio.horario_por_dia && (<>
                      <FranjasEditor franjas={negocio.horario_general} onChange={f => { setSucio(true); setNegocio({ ...negocio, horario_general: f }) }} />
                      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-neutral-50" title="Días en los que el negocio abre. Una jornada que cruza medianoche pertenece al día en que empezó.">
                        {([['L',1],['M',2],['X',3],['J',4],['V',5],['S',6],['D',0]] as const).map(([letra, d]) => {
                        const activos = negocio.dias_apertura ?? [0, 1, 2, 3, 4, 5, 6]
                        const on = activos.includes(d)
                        return (
                          <button key={d} type="button"
                            onClick={() => {
                              setSucio(true)
                              const prox = on ? activos.filter(x => x !== d) : [...activos, d].sort()
                              setNegocio({ ...negocio, dias_apertura: prox.length >= 7 ? null : prox })
                            }}
                            className={`w-7 h-7 shrink-0 rounded-full text-[11px] font-bold transition-colors ${on ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-400 border border-red-200'}`}
                            title={on ? 'Abierto — clic para cerrar este día' : 'Cerrado — clic para abrir este día'}>
                            {letra}
                          </button>
                        )
                      })}
                      </div>
                    </>)}
                    {negocio.horario_por_dia && (
                      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                        {([['L',1],['M',2],['X',3],['J',4],['V',5],['S',6],['D',0]] as const).map(([letra, d]) => {
                          const activos = negocio.dias_apertura ?? [0, 1, 2, 3, 4, 5, 6]
                          const on = activos.includes(d)
                          return (
                            <div key={d} className="flex items-start gap-2">
                              <button type="button"
                                onClick={() => {
                                  setSucio(true)
                                  const prox = on ? activos.filter(x => x !== d) : [...activos, d].sort()
                                  setNegocio({ ...negocio, dias_apertura: prox.length >= 7 ? null : prox })
                                }}
                                title={on ? 'Abierto — clic para cerrar este día' : 'Cerrado — clic para abrir este día'}
                                className={`w-7 h-7 shrink-0 rounded-full text-[11px] font-bold transition-colors ${on ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-400 border border-red-200'}`}>
                                {letra}
                              </button>
                              <div className={on ? 'flex-1' : 'flex-1 opacity-30 pointer-events-none'}>
                                <FranjasEditor franjas={negocio.horario_por_dia?.[String(d)] ?? []}
                                  onChange={f => { setSucio(true); setNegocio({ ...negocio, horario_por_dia: { ...negocio.horario_por_dia, [String(d)]: f } }) }} />
                              </div>
                            </div>
                          )
                        })}
                        <p className="text-[10px] text-neutral-300 pt-1 col-span-2">Día sin franjas cargadas = abierto todo ese día. El chip rojo lo cierra por completo.</p>
                      </div>
                    )}</td>
                  <td className="py-3 pr-3"><input type="number" min={0} max={120} value={negocio.tolerancia_cierre} onChange={e => { setSucio(true); setNegocio({ ...negocio, tolerancia_cierre: Number(e.target.value) }) }} className="w-16 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700" /></td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  <td className="py-3"><span className="text-xs text-neutral-300">—</span></td>
                </tr>
              )}
              {/* ── 🛵 DELIVERY ── */}
              {delivery && tieneDelivery && (
                <tr className={`border-t border-neutral-100 align-top ${delivery.pausado ? 'bg-amber-50/60' : ''}`}>
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-neutral-700 whitespace-nowrap">🛵 Delivery</p>
                    {delivery.pausado && <p className="text-[11px] font-semibold text-amber-600">⏸️ EN PAUSA</p>}
                  </td>
                  <td className="py-3 pr-3"><Toggle on={delivery.activo} onClick={() => { setSucio(true); setDelivery({ ...delivery, activo: !delivery.activo }) }} /></td>
                  <td className="py-3 pr-3 min-w-[230px]"><FranjasEditor franjas={delivery.horarios} onChange={f => { setSucio(true); setDelivery({ ...delivery, horarios: f }) }} deshabilitado={!delivery.activo} />
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-neutral-50" title="Con delivery ABIERTO, el cliente puede elegir una franja futura del día para recibir — el pedido entra igual a Preparación con su hora a la vista">
                      <Toggle on={delivery.permitir_programado} onClick={() => { setSucio(true); setDelivery({ ...delivery, permitir_programado: !delivery.permitir_programado }) }} disabled={!delivery.activo} />
                      <span className="text-[11px] font-semibold text-neutral-500">Permitir entregas programadas <span className="text-neutral-300">(elige franja)</span></span>
                    </div>
                  </td>
                  <td className="py-3 pr-3"><input type="number" min={0} max={120} value={delivery.tolerancia_cierre} onChange={e => { setSucio(true); setDelivery({ ...delivery, tolerancia_cierre: Number(e.target.value) }) }} className="w-16 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700" /></td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-1" title="Costo de envío — se suma al pedido de delivery">
                      <span className="text-xs text-neutral-400">$</span>
                      <input type="number" min={0} value={delivery.costo_envio} onChange={e => { setSucio(true); setDelivery({ ...delivery, costo_envio: Number(e.target.value) }) }} disabled={!delivery.activo} className="w-20 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700 disabled:opacity-40" />
                      {delivery.activo && Number(delivery.costo_envio) === 0 && (
                        /* Costo 0 es ambiguo (JC 23/09): el comercio declara qué significa */
                        <span className="flex items-center gap-3 text-[11px] text-neutral-500 ml-1">
                          <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={!delivery.envio_al_cadete} onChange={() => { setSucio(true); setDelivery({ ...delivery, envio_al_cadete: false }) }} /> Envío incluido</label>
                          <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={delivery.envio_al_cadete} onChange={() => { setSucio(true); setDelivery({ ...delivery, envio_al_cadete: true }) }} /> Se abona al cadete 🛵</label>
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-300 mt-0.5">envío</p>
                  </td>
                  <td className="py-3 pr-3">
                    <button onClick={() => { setSucio(true); setDelivery({ ...delivery, pausado: !delivery.pausado }) }} title="Pausa momentánea: lluvia o demanda desbordada — misma llave que el botón de la caja"
                      className={`p-1.5 rounded-lg border transition-colors ${delivery.pausado ? 'bg-amber-100 border-amber-300 text-amber-600' : 'bg-white border-neutral-200 text-neutral-300 hover:text-neutral-500'}`}>
                      <CloudRain className="h-4 w-4" />
                    </button>
                  </td>
                  
                </tr>
              )}
              {/* ── 🥡 TAKE AWAY ── */}
              {ta && tieneTa && (
                <tr className="border-t border-neutral-100 align-top">
                  <td className="py-3 pr-3"><p className="font-semibold text-neutral-700 whitespace-nowrap">🥡 Take Away</p></td>
                  <td className="py-3 pr-3"><Toggle on={ta.activo} onClick={() => { setSucio(true); setTa({ ...ta, activo: !ta.activo }) }} /></td>
                  <td className="py-3 pr-3 min-w-[230px]">
                    <FranjasEditor franjas={ta.horarios} onChange={f => { setSucio(true); setTa({ ...ta, horarios: f }) }} deshabilitado={!ta.activo} />
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-neutral-50" title="Con el TA aún cerrado pero con horario hoy por delante, el cliente puede pedir igual: su pedido entra ya y retira desde la apertura">
                      <Toggle on={ta.acepta_anticipado} onClick={() => { setSucio(true); setTa({ ...ta, acepta_anticipado: !ta.acepta_anticipado }) }} disabled={!ta.activo} />
                      <span className="text-[11px] font-semibold text-neutral-500">Aceptar pedidos antes de abrir <span className="text-neutral-300">(anticipado)</span></span>
                    </div>
                  </td>
                  <td className="py-3 pr-3"><input type="number" min={0} max={120} value={ta.tolerancia_cierre} onChange={e => { setSucio(true); setTa({ ...ta, tolerancia_cierre: Number(e.target.value) }) }} className="w-16 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700" /></td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-1" title="Costo de servicio de retiro (aderezos, salsas, packaging) — se suma al pedido de take away">
                      <span className="text-xs text-neutral-400">$</span>
                      <input type="number" min={0} value={ta.costo_servicio} onChange={e => { setSucio(true); setTa({ ...ta, costo_servicio: Number(e.target.value) }) }} disabled={!ta.activo} className="w-20 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700 disabled:opacity-40" />
                    </div>
                    <p className="text-[10px] text-neutral-300 mt-0.5">servicio</p>
                  </td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  
                </tr>
              )}
              {/* ── 🪑 MESAS (mudada de la ex-página Mesas) ──
                  La llave es empresa_config.mesas_activo — la MISMA de siempre
                  (los QR de mesa muestran "no disponible" cuando está apagada).
                  Sin horario propio: mesas abre con el local (query verificada). */}
              {!tieneMesas && (
                <tr className="border-t border-neutral-100 align-top opacity-70">
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-neutral-400 whitespace-nowrap">🪑 Mesas</p>
                    <p className="text-[11px] font-semibold text-amber-500">módulo disponible — sumalo a tu plan</p>
                  </td>
                  <td className="py-3 pr-3">
                    <button onClick={() => setModalMesas(true)} title="Activar el módulo Mesas"
                      className="p-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-500 hover:bg-amber-100 hover:border-amber-300 transition-colors">
                      <Lock className="h-4 w-4" />
                    </button>
                  </td>
                  <td className="py-3 pr-3 min-w-[230px]"><span className="text-xs text-neutral-400">Tus clientes piden con un QR desde la mesa 🪑</span></td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  <td className="py-3"><span className="text-xs text-neutral-300">—</span></td>
                </tr>
              )}
              {tieneMesas && (
                <tr className="border-t border-neutral-100 align-top">
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-neutral-700 whitespace-nowrap">🪑 Mesas</p>
                    <p className="text-[11px] text-neutral-400">pedidos desde el salón</p>
                  </td>
                  <td className="py-3 pr-3"><Toggle on={mesasActivo} onClick={() => { setSucio(true); setMesasActivo(!mesasActivo) }} /></td>
                  <td className="py-3 pr-3 min-w-[230px]"><span className="text-xs text-neutral-400">Abre con el local (horario del negocio)</span></td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  <td className="py-3"><span className="text-xs text-neutral-300">—</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-400 mt-3 pt-3 border-t border-neutral-100"><b>Sin franjas = abierto siempre</b> · el horario del Negocio <b>techa</b> Kiosk y Delivery (local cerrado = no entran) · <b>Take Away se rige solo por sus franjas</b>; con su llave de <b>anticipado</b> activada acepta pedidos antes de abrir (entran ya, retiro desde la apertura) · una franja que cruza medianoche (20:00 a 01:00) vale · la tolerancia extiende el cierre esos minutos · ⏸️ la pausa de Delivery frena pedidos sin apagar el servicio (misma llave que la caja) · el costo de <b>servicio</b> de Take Away se suma al pedido (0 = no se muestra). con <b>entregas programadas</b> el cliente elige franja del día (delivery abierto; el pedido entra ya a Preparación con su hora) · qué canales muestra la puerta pública se maneja en la pestaña <b>🌐 App</b>. Los medios de pago se configuran en <b>Cuentas y cobros</b>.</p>
      </ConeCard>
      )}

      {/* ═══ TAB MENSAJES ═══ */}
      {tab === 'mensajes' && (
      <ConeCard>
        <h3 className="font-bold text-neutral-800 mb-1">Mensajes al cliente</h3>
        <p className="text-xs text-neutral-400 mb-4">Lo que ve el cliente cuando el servicio está cerrado o en pausa. Se guardan con el mismo botón <b>Guardar</b> (tab Horarios y servicios).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {negocio && (
            <div>
              <label className="text-xs font-semibold text-neutral-500">🏪 Negocio cerrado</label>
              <input value={negocio.mensaje_cerrado} placeholder="¡Volvemos pronto!" onChange={e => { setSucio(true); setNegocio({ ...negocio, mensaje_cerrado: e.target.value }) }} className={inp} />
            </div>
          )}
          {delivery && tieneDelivery && (<>
            <div>
              <label className="text-xs font-semibold text-neutral-500">🛵 Delivery fuera de horario</label>
              <input value={delivery.mensaje_fuera_horario} placeholder="El delivery no está disponible ahora." onChange={e => { setSucio(true); setDelivery({ ...delivery, mensaje_fuera_horario: e.target.value }) }} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-500">⏸️ Delivery en pausa</label>
              <input value={delivery.mensaje_pausa} placeholder="Pausado momentáneamente — ¡ya volvemos!" onChange={e => { setSucio(true); setDelivery({ ...delivery, mensaje_pausa: e.target.value }) }} className={inp} />
            </div>
          </>)}
          {ta && tieneTa && (
            <div>
              <label className="text-xs font-semibold text-neutral-500">🥡 Take Away fuera de horario</label>
              <input value={ta.mensaje_fuera_horario} placeholder="El take away no está disponible ahora. ¡Volvemos pronto!" onChange={e => { setSucio(true); setTa({ ...ta, mensaje_fuera_horario: e.target.value }) }} className={inp} />
            </div>
          )}
        </div>
      </ConeCard>
      )}

      {/* Modal comercial Mesas (upsell mudado del sidebar — mismo contacto de soporte) */}
      {modalMesas && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setModalMesas(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <button onClick={() => setModalMesas(false)} className="absolute top-4 right-4 p-1 text-neutral-400 hover:text-neutral-600">
              <X className="h-5 w-5" />
            </button>
            <div className="w-12 h-12 bg-neutral-100 rounded-2xl flex items-center justify-center mb-4 text-2xl">🪑</div>
            <h3 className="font-black text-neutral-900 text-lg mb-2">Pedidos desde la Mesa</h3>
            <p className="text-neutral-500 text-sm mb-5">Tus clientes escanean un QR en la mesa y piden desde su celular: el pedido cae directo a cocina. Cobrás en caja (incluso dividido entre varios medios) o pagan con Mercado Pago. Con generador de QRs imprimibles incluido.</p>
            <a href={`https://wa.me/${soporte.wa}?text=${encodeURIComponent('Hola, quiero activar el módulo Mesas en ConeOS')}`}
              target="_blank" rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-colors text-sm">
              💬 Contactar a {soporte.nombre}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}