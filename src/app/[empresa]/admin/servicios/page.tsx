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
import { Loader2, Plus, X, CloudRain } from 'lucide-react'

interface Franja { desde: string; hasta: string }
interface Sucursal { id: string; nombre: string }

interface NegocioCfg { horario_general: Franja[]; mensaje_cerrado: string; tolerancia_cierre: number }
interface DeliveryCfg { activo: boolean; pausado: boolean; mensaje_pausa: string; horarios: Franja[]; mensaje_fuera_horario: string; tolerancia_cierre: number }
interface TaCfg { activo: boolean; horarios: Franja[]; mensaje_fuera_horario: string; tolerancia_cierre: number }

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
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const avisar = (m: string) => { setAviso(m); setTimeout(() => setAviso(null), 2500) }

  const cargar = useCallback(async (sucId: string) => {
    if (!ctx?.empresaId || !sucId) return
    setCargando(true)
    const [{ data: suc }, { data: dc }, { data: tc }, { data: cfg }] = await Promise.all([
      supabase.from('sucursales').select('horario_general, mensaje_cerrado, tolerancia_cierre').eq('id', sucId).maybeSingle(),
      supabase.from('delivery_config').select('activo, pausado, mensaje_pausa, horarios, mensaje_fuera_horario, tolerancia_cierre').eq('sucursal_id', sucId).maybeSingle(),
      supabase.from('takeaway_config').select('activo, horarios, mensaje_fuera_horario, tolerancia_cierre').eq('sucursal_id', sucId).maybeSingle(),
      supabase.from('empresa_config').select('modulos').eq('empresa_id', ctx.empresaId).maybeSingle(),
    ])
    const mods = (cfg?.modulos ?? {}) as Record<string, boolean>
    setTieneDelivery(mods.delivery !== false)
    setTieneTa(mods.takeaway !== false)
    setNegocio({
      horario_general: (suc?.horario_general as Franja[] | null) ?? [],
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
    })
    setTa({
      activo: tc?.activo ?? false,
      horarios: (tc?.horarios as Franja[] | null) ?? [],
      mensaje_fuera_horario: tc?.mensaje_fuera_horario ?? '',
      tolerancia_cierre: Number(tc?.tolerancia_cierre ?? 5),
    })
    setCargando(false)
  }, [ctx?.empresaId, supabase])

  useEffect(() => {
    if (!ctx?.empresaId) return
    supabase.from('sucursales').select('id, nombre').eq('empresa_id', ctx.empresaId).eq('activo', true).order('nombre')
      .then(({ data }) => {
        const lista = (data ?? []) as Sucursal[]
        setSucursales(lista)
        if (lista.length > 0) { setSucursalSel(lista[0].id); cargar(lista[0].id) }
        else setCargando(false)
      })
  }, [ctx?.empresaId, supabase, cargar])

  async function guardarNegocio() {
    if (!negocio || !sucursalSel) return
    setGuardando('negocio'); setError(null)
    const { error: e } = await supabase.from('sucursales').update({
      horario_general: negocio.horario_general,
      mensaje_cerrado: negocio.mensaje_cerrado || null,
      tolerancia_cierre: negocio.tolerancia_cierre,
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
    <div className="p-8 max-w-4xl space-y-5">
      <ConePageHeader title="Servicios y horarios" description="Cuándo y cómo atiende cada servicio de la sucursal — todo en un solo lugar" />

      {aviso && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-green-600 text-white rounded-full text-sm font-semibold shadow-lg pointer-events-none">✓ {aviso}</div>}
      {error && <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 font-medium">{error}</div>}

      <ConeCard>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-bold text-neutral-800">Qué servicio atiende y cuándo</h3>
          {sucursales.length > 1 && (
            <select value={sucursalSel} onChange={e => { setSucursalSel(e.target.value); cargar(e.target.value) }}
              className="px-3 py-2 rounded-xl border border-neutral-200 text-sm font-semibold bg-white text-neutral-700">
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-neutral-400 uppercase tracking-wide">
                <th className="py-2 pr-3 font-semibold">Servicio</th>
                <th className="py-2 pr-3 font-semibold">Activo</th>
                <th className="py-2 pr-3 font-semibold">Franjas horarias</th>
                <th className="py-2 pr-3 font-semibold">Tolerancia</th>
                <th className="py-2 pr-3 font-semibold">Pausa</th>
                <th className="py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {/* ── 🏪 NEGOCIO / KIOSK ── */}
              {negocio && (
                <tr className="border-t border-neutral-100 align-top">
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-neutral-700 whitespace-nowrap">🏪 Negocio</p>
                    <p className="text-[11px] text-neutral-400">rige el Kiosk</p>
                  </td>
                  <td className="py-3 pr-3"><span className="min-w-[52px] inline-block text-center px-2 py-1 rounded-full text-[11px] font-bold bg-neutral-50 text-neutral-400 border border-neutral-200">Siempre</span></td>
                  <td className="py-3 pr-3 min-w-[230px]"><FranjasEditor franjas={negocio.horario_general} onChange={f => setNegocio({ ...negocio, horario_general: f })} /></td>
                  <td className="py-3 pr-3"><input type="number" min={0} max={120} value={negocio.tolerancia_cierre} onChange={e => setNegocio({ ...negocio, tolerancia_cierre: Number(e.target.value) })} className="w-16 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700" /></td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  <td className="py-3 text-right"><BotonGuardar id="negocio" onClick={guardarNegocio} /></td>
                </tr>
              )}
              {/* ── 🛵 DELIVERY ── */}
              {delivery && tieneDelivery && (
                <tr className={`border-t border-neutral-100 align-top ${delivery.pausado ? 'bg-amber-50/60' : ''}`}>
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-neutral-700 whitespace-nowrap">🛵 Delivery</p>
                    {delivery.pausado && <p className="text-[11px] font-semibold text-amber-600">⏸️ EN PAUSA</p>}
                  </td>
                  <td className="py-3 pr-3"><Toggle on={delivery.activo} onClick={() => setDelivery({ ...delivery, activo: !delivery.activo })} /></td>
                  <td className="py-3 pr-3 min-w-[230px]"><FranjasEditor franjas={delivery.horarios} onChange={f => setDelivery({ ...delivery, horarios: f })} deshabilitado={!delivery.activo} /></td>
                  <td className="py-3 pr-3"><input type="number" min={0} max={120} value={delivery.tolerancia_cierre} onChange={e => setDelivery({ ...delivery, tolerancia_cierre: Number(e.target.value) })} className="w-16 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700" /></td>
                  <td className="py-3 pr-3">
                    <button onClick={() => setDelivery({ ...delivery, pausado: !delivery.pausado })} title="Pausa momentánea: lluvia o demanda desbordada — misma llave que el botón de la caja"
                      className={`p-1.5 rounded-lg border transition-colors ${delivery.pausado ? 'bg-amber-100 border-amber-300 text-amber-600' : 'bg-white border-neutral-200 text-neutral-300 hover:text-neutral-500'}`}>
                      <CloudRain className="h-4 w-4" />
                    </button>
                  </td>
                  <td className="py-3 text-right"><BotonGuardar id="delivery" onClick={guardarDelivery} /></td>
                </tr>
              )}
              {/* ── 🥡 TAKE AWAY ── */}
              {ta && tieneTa && (
                <tr className="border-t border-neutral-100 align-top">
                  <td className="py-3 pr-3"><p className="font-semibold text-neutral-700 whitespace-nowrap">🥡 Take Away</p></td>
                  <td className="py-3 pr-3"><Toggle on={ta.activo} onClick={() => setTa({ ...ta, activo: !ta.activo })} /></td>
                  <td className="py-3 pr-3 min-w-[230px]"><FranjasEditor franjas={ta.horarios} onChange={f => setTa({ ...ta, horarios: f })} deshabilitado={!ta.activo} /></td>
                  <td className="py-3 pr-3"><input type="number" min={0} max={120} value={ta.tolerancia_cierre} onChange={e => setTa({ ...ta, tolerancia_cierre: Number(e.target.value) })} className="w-16 px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700" /></td>
                  <td className="py-3 pr-3"><span className="text-xs text-neutral-300">—</span></td>
                  <td className="py-3 text-right"><BotonGuardar id="ta" onClick={guardarTa} /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-400 mt-3 pt-3 border-t border-neutral-100"><b>Sin franjas = abierto siempre</b> · una franja que cruza medianoche (20:00 a 01:00) vale · la tolerancia extiende el cierre esos minutos · ⏸️ la pausa de Delivery frena pedidos sin apagar el servicio (misma llave que la caja). Los medios de pago se configuran en <b>Cuentas y cobros</b>.</p>
      </ConeCard>

      {/* ── MENSAJES CUANDO ESTÁ CERRADO ── */}
      <ConeCard>
        <h3 className="font-bold text-neutral-800 mb-1">Mensajes al cliente</h3>
        <p className="text-xs text-neutral-400 mb-4">Lo que ve el cliente cuando el servicio está cerrado o en pausa. Se guardan con el Guardar de cada fila de arriba.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {negocio && (
            <div>
              <label className="text-xs font-semibold text-neutral-500">🏪 Negocio cerrado</label>
              <input value={negocio.mensaje_cerrado} placeholder="¡Volvemos pronto!" onChange={e => setNegocio({ ...negocio, mensaje_cerrado: e.target.value })} className={inp} />
            </div>
          )}
          {delivery && tieneDelivery && (<>
            <div>
              <label className="text-xs font-semibold text-neutral-500">🛵 Delivery fuera de horario</label>
              <input value={delivery.mensaje_fuera_horario} placeholder="El delivery no está disponible ahora." onChange={e => setDelivery({ ...delivery, mensaje_fuera_horario: e.target.value })} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-500">⏸️ Delivery en pausa</label>
              <input value={delivery.mensaje_pausa} placeholder="Pausado momentáneamente — ¡ya volvemos!" onChange={e => setDelivery({ ...delivery, mensaje_pausa: e.target.value })} className={inp} />
            </div>
          </>)}
          {ta && tieneTa && (
            <div>
              <label className="text-xs font-semibold text-neutral-500">🥡 Take Away fuera de horario</label>
              <input value={ta.mensaje_fuera_horario} placeholder="El take away no está disponible ahora. ¡Volvemos pronto!" onChange={e => setTa({ ...ta, mensaje_fuera_horario: e.target.value })} className={inp} />
            </div>
          )}
        </div>
      </ConeCard>
    </div>
  )
}