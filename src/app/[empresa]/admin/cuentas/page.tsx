'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeCard } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Pencil, X } from 'lucide-react'

// ============================================================
// 💳 CUENTAS Y COBROS — Fase 6.3 canales-medios-pago
// Cabina de control del modelo canal → medio → cuenta.
// Toda escritura va por /api/admin/pagos-cuentas (server-side,
// RLS del admin + validaciones). Esta pantalla NUNCA resuelve
// pagos: muestra y edita CONFIGURACIÓN; el resolver es la única
// autoridad en runtime. "Config. general (legacy)" = sin mapeo.
// ============================================================

interface Credencial { id: string; nombre: string; activo: boolean; sucursal_id: string | null; mp_user_id: string; expires_at: string | null }
interface Cuenta { id: string; nombre: string; alias: string | null; cbu: string | null; titular: string | null; activo: boolean; sucursal_id: string }
interface Mapeo { canal: string; medio: string; mp_credencial_id: string | null; transferencia_cuenta_id: string | null }
interface Llaves {
  acepta_efectivo: boolean; acepta_transferencia: boolean; acepta_mp: boolean
  acepta_mp_kiosk: boolean | null; acepta_mp_delivery: boolean | null; acepta_mp_mesa: boolean | null; acepta_mp_takeaway: boolean | null
  acepta_efectivo_kiosk: boolean | null; acepta_efectivo_delivery: boolean | null; acepta_efectivo_mesa: boolean | null; acepta_efectivo_takeaway: boolean | null
  acepta_transferencia_kiosk: boolean | null; acepta_transferencia_delivery: boolean | null; acepta_transferencia_mesa: boolean | null; acepta_transferencia_takeaway: boolean | null
}
interface Sucursal { id: string; nombre: string }

const CANALES: { id: string; label: string; emoji: string; llaveMp: keyof Llaves | null; suf: 'kiosk' | 'delivery' | 'mesa' | 'takeaway' | null }[] = [
  { id: 'KIOSK', label: 'Kiosk', emoji: '🛒', llaveMp: 'acepta_mp_kiosk', suf: 'kiosk' },
  { id: 'DELIVERY', label: 'Delivery', emoji: '🛵', llaveMp: 'acepta_mp_delivery', suf: 'delivery' },
  { id: 'MESA', label: 'Mesa', emoji: '🍽️', llaveMp: 'acepta_mp_mesa', suf: 'mesa' },
  { id: 'TAKEAWAY', label: 'Take Away', emoji: '🥡', llaveMp: 'acepta_mp_takeaway', suf: 'takeaway' },
  { id: 'CAJA', label: 'Caja', emoji: '🧾', llaveMp: null, suf: null }, // venta manual: exenta del guard por diseño (F-C)
]

export default function CuentasPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [tab, setTab] = useState<'mp' | 'transfer' | 'matriz'>('mp')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const avisoEsApagado = !!aviso && aviso.includes('deshabilitad')

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalSel, setSucursalSel] = useState<string>('')
  const [credenciales, setCredenciales] = useState<Credencial[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [mapeos, setMapeos] = useState<Mapeo[]>([])
  const [llaves, setLlaves] = useState<Llaves | null>(null)
  const [modulos, setModulos] = useState<Record<string, boolean> | null>(null)

  const [editCuenta, setEditCuenta] = useState<Partial<Cuenta> | null>(null) // null=cerrado, {}=nueva
  const [guardando, setGuardando] = useState(false)
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null)

  const api = useCallback(async (metodo: 'GET' | 'POST', payload?: Record<string, unknown>, sucursal?: string) => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sesión vencida — recargá la página')
    const url = `/api/admin/pagos-cuentas${metodo === 'GET' && sucursal ? `?sucursal_id=${sucursal}` : ''}`
    const res = await fetch(url, {
      method: metodo,
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(metodo === 'POST' ? { body: JSON.stringify(payload) } : {}),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error ?? 'Error inesperado')
    return d
  }, [])

  const cargar = useCallback(async (sucursal?: string) => {
    try {
      setError(null)
      const d = await api('GET', undefined, sucursal)
      setSucursales(d.sucursales)
      setCredenciales(d.credenciales)
      setCuentas(d.cuentas_transferencia)
      setMapeos(d.mapeos)
      setLlaves(d.llaves)
      setModulos(d.modulos ?? null)
      if (!sucursal && d.sucursales.length > 0) setSucursalSel(d.sucursales[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando')
    } finally {
      setCargando(false)
    }
  }, [api])

  useEffect(() => { if (ctx) cargar(sucursalSel || undefined) }, [ctx, sucursalSel, cargar])

  async function accion(payload: Record<string, unknown>, ok?: string) {
    setGuardando(true)
    setError(null)
    try {
      await api('POST', payload)
      if (ok) { setAviso(ok); setTimeout(() => setAviso(null), 2500) }
      await cargar(sucursalSel)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      return false
    } finally {
      setGuardando(false)
    }
  }

  // ── CICLO 1 — GRILLA ON/OFF (llaves por canal) ──
  // Regla CTO: sin optimistic update — la celda muestra spinner, el server
  // decide (set_llave valida bloqueante), y el estado real vuelve por refetch.
  const [celdaGuardando, setCeldaGuardando] = useState<string | null>(null)
  async function toggleLlave(canalId: string, medio: 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO', valorNuevo: boolean, label: string) {
    const key = `${canalId}-${medio}`
    setCeldaGuardando(key)
    await accion({ accion: 'set_llave', sucursal_id: sucursalSel, canal: canalId, medio, valor: valorNuevo },
      `${label}: ${medio === 'EFECTIVO' ? 'efectivo' : medio === 'TRANSFERENCIA' ? 'transferencia' : 'Mercado Pago'} ${valorNuevo ? 'habilitado' : 'deshabilitado'}`)
    setCeldaGuardando(null)
  }
  function LlaveToggle({ canalId, medio, efectiva, baseOff, label }: { canalId: string; medio: 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO'; efectiva: boolean; baseOff: boolean; label: string }) {
    const key = `${canalId}-${medio}`
    const ocupada = celdaGuardando === key
    return (
      <button disabled={guardando || baseOff} onClick={() => toggleLlave(canalId, medio, !efectiva, label)}
        title={baseOff ? 'El medio está apagado a nivel general de la sucursal (se destraba por soporte hasta la poda del ciclo de pagos)' : undefined}
        className={`min-w-[52px] px-2 py-1 rounded-full text-[11px] font-bold border transition-colors disabled:opacity-40 ${efectiva ? 'bg-green-50 text-green-700 border-green-200' : 'bg-neutral-100 text-neutral-400 border-neutral-200'}`}>
        {ocupada ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : efectiva ? 'ON' : 'OFF'}
      </button>
    )
  }

  function copiarLinkMP(sucursalId?: string, credencialId?: string) {
    const base = `${window.location.origin}/api/mp/connect?empresa_id=${ctx?.empresaId}&slug=${ctx?.empresaSlug ?? ''}`
    const url = base + (sucursalId ? `&sucursal_id=${sucursalId}` : '') + (credencialId ? `&mp_credencial_id=${credencialId}` : '')
    navigator.clipboard.writeText(url)
    setLinkCopiado(credencialId ?? sucursalId ?? 'marca')
    setTimeout(() => setLinkCopiado(null), 2000)
  }

  const nombreSucursal = (id: string | null) => id === null ? 'Toda la marca' : (sucursales.find(s => s.id === id)?.nombre ?? '—')
  const cuentasDeSucursal = cuentas.filter(c => c.sucursal_id === sucursalSel)
  const credencialesAsignables = credenciales.filter(c => c.sucursal_id === null || c.sucursal_id === sucursalSel)
  const mapeoDe = (canal: string, medio: string) => mapeos.find(m => m.canal === canal && m.medio === medio)

  if (ctxLoading || cargando) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  return (
    <div className="space-y-5">
      <ConePageHeader title="💳 Cuentas y cobros" subtitle="Cuentas de Mercado Pago y transferencia, y qué cuenta cobra cada canal" />

      {error && <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700 font-medium">{error}</div>}
      {/* toast flotante: no participa del layout — el guardado no hace saltar la grilla */}
      {aviso && <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 text-white rounded-full text-sm font-semibold shadow-lg pointer-events-none ${avisoEsApagado ? 'bg-amber-500' : 'bg-green-600'}`}>✓ {aviso}</div>}

      <div className="flex gap-2">
        {([['mp', '🟦 Mercado Pago'], ['transfer', '🏦 Transferencias'], ['matriz', '🎛️ Canales y medios']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${tab === id ? 'bg-neutral-800 text-white' : 'bg-white border border-neutral-200 text-neutral-500 hover:border-neutral-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ TAB MERCADO PAGO ═══ */}
      {tab === 'mp' && (
        <ConeCard title="Cuentas de Mercado Pago">
          <div className="space-y-3">
            {credenciales.length === 0 && <p className="text-sm text-neutral-400">Todavía no hay ninguna cuenta conectada.</p>}
            {credenciales.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-neutral-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <input
                      className="font-semibold text-neutral-800 text-sm bg-transparent border-b border-transparent hover:border-neutral-200 focus:border-neutral-400 outline-none min-w-0"
                      defaultValue={c.nombre}
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== c.nombre) accion({ accion: 'renombrar_credencial', credencial_id: c.id, nombre: v }, 'Nombre actualizado') }}
                    />
                    {c.activo
                      ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-50 text-green-700">Activa</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600">Inactiva — reconectá o reactivala</span>}
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5">{nombreSucursal(c.sucursal_id)} · MP #{c.mp_user_id}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => { const n = prompt('Nuevo nombre de la cuenta:', c.nombre); if (n?.trim() && n.trim() !== c.nombre) accion({ accion: 'renombrar_credencial', credencial_id: c.id, nombre: n.trim() }, 'Cuenta renombrada') }}
                    title="Renombrar esta cuenta"
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition-colors">
                    ✏️
                  </button>
                  <button onClick={() => copiarLinkMP(c.sucursal_id ?? undefined, c.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition-colors">
                    {linkCopiado === c.id ? '✓ Copiado' : 'Link de reconexión'}
                  </button>
                  <button onClick={() => accion({ accion: 'toggle_credencial', credencial_id: c.id, activo: !c.activo }, c.activo ? 'Cuenta desactivada (los mapeos se conservan)' : 'Cuenta reactivada')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 transition-colors">
                    {c.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-neutral-100 space-y-2">
              <p className="text-xs text-neutral-400">Conectar una cuenta abre Mercado Pago para autorizarla. Podés conectar la de la marca o una propia por sucursal (copiá el link y envíaselo al responsable).</p>
              <div className="flex flex-wrap gap-2">
                <a href={`/api/mp/connect?empresa_id=${ctx?.empresaId}&slug=${ctx?.empresaSlug ?? ''}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#009EE3] hover:bg-[#008ACB] text-white font-bold rounded-xl text-sm transition-colors">
                  <Plus className="h-4 w-4" /> Conectar cuenta (marca)
                </a>
                {sucursales.map(s => (
                  <button key={s.id} onClick={() => copiarLinkMP(s.id)}
                    className="text-sm font-semibold px-4 py-2 rounded-xl border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition-colors">
                    {linkCopiado === s.id ? '✓ Copiado' : `Link para ${s.nombre}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </ConeCard>
      )}

      {/* ═══ TAB TRANSFERENCIAS ═══ */}
      {tab === 'transfer' && (
        <ConeCard title="Cuentas de transferencia">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <select value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}
                className="px-3 py-2 rounded-xl border border-neutral-200 text-sm font-semibold text-neutral-700 bg-white">
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
              <ConeButton onClick={() => setEditCuenta({})}><Plus className="h-4 w-4 mr-1" /> Nueva cuenta</ConeButton>
            </div>

            {cuentasDeSucursal.length === 0 && <p className="text-sm text-neutral-400">Esta sucursal no tiene cuentas cargadas — los canales usan los datos de pago cargados en Sucursales, como siempre.</p>}
            {cuentasDeSucursal.map(c => (
              <div key={c.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${c.activo ? 'border-neutral-100' : 'border-red-100 bg-red-50/40'}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-800 text-sm truncate">🏦 {c.nombre}</span>
                    {!c.activo && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600">Inactiva</span>}
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5 truncate">
                    {[c.alias && `Alias: ${c.alias}`, c.cbu && `CBU: ${c.cbu}`, c.titular && `Titular: ${c.titular}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => setEditCuenta(c)} className="p-2 rounded-lg border border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-700 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => accion({ accion: 'toggle_cuenta', cuenta_id: c.id, activo: !c.activo }, c.activo ? 'Cuenta desactivada (los mapeos se conservan)' : 'Cuenta reactivada')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 transition-colors">
                    {c.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>
              </div>
            ))}

            {editCuenta && (
              <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50 space-y-3">
                <p className="text-sm font-bold text-neutral-700">{editCuenta.id ? 'Editar cuenta' : `Nueva cuenta · ${sucursales.find(s => s.id === sucursalSel)?.nombre ?? ''}`}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label className="text-xs">Nombre *</Label><Input defaultValue={editCuenta.nombre ?? ''} id="ct-nombre" placeholder="Cuenta 2 · Banco Nación" /></div>
                  <div><Label className="text-xs">Titular</Label><Input defaultValue={editCuenta.titular ?? ''} id="ct-titular" placeholder="Nombre del titular" /></div>
                  <div><Label className="text-xs">Alias</Label><Input defaultValue={editCuenta.alias ?? ''} id="ct-alias" placeholder="mihelado.mp" /></div>
                  <div><Label className="text-xs">CBU (22 dígitos)</Label><Input defaultValue={editCuenta.cbu ?? ''} id="ct-cbu" placeholder="Opcional si hay alias" /></div>
                </div>
                <div className="flex gap-2">
                  <ConeButton disabled={guardando} onClick={async () => {
                    const v = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? ''
                    const payload = editCuenta.id
                      ? { accion: 'editar_cuenta', cuenta_id: editCuenta.id, nombre: v('ct-nombre'), alias: v('ct-alias'), cbu: v('ct-cbu'), titular: v('ct-titular') }
                      : { accion: 'crear_cuenta', sucursal_id: sucursalSel, nombre: v('ct-nombre'), alias: v('ct-alias'), cbu: v('ct-cbu'), titular: v('ct-titular') }
                    if (await accion(payload, editCuenta.id ? 'Cuenta actualizada' : 'Cuenta creada')) setEditCuenta(null)
                  }}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}</ConeButton>
                  <button onClick={() => setEditCuenta(null)} className="text-sm font-semibold px-4 py-2 rounded-xl border border-neutral-200 text-neutral-500"><X className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </div>
        </ConeCard>
      )}

      {/* ═══ TAB MATRIZ ═══ */}
      {tab === 'matriz' && (
        <ConeCard title="Qué cuenta cobra cada canal">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <select value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}
                className="px-3 py-2 rounded-xl border border-neutral-200 text-sm font-semibold text-neutral-700 bg-white">
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-400 uppercase tracking-wide">
                    <th className="py-2 pr-3 font-semibold">Canal</th>
                    <th className="py-2 pr-3 font-semibold">💵 Efectivo</th>
                    <th className="py-2 pr-3 font-semibold">🏦 Transf.</th>
                    <th className="py-2 pr-3 font-semibold">Cuenta transferencia</th>
                    <th className="py-2 pr-3 font-semibold">🟦 MP</th>
                    <th className="py-2 font-semibold">Credencial MP</th>
                  </tr>
                </thead>
                <tbody>
                  {CANALES.filter(canal => {
                    // Módulo de empresa apagado → el canal no existe para este negocio:
                    // la fila ni aparece (pedido JC). Sin dato de módulos → se muestran todas.
                    if (!modulos) return true
                    const llaveModulo = canal.id === 'KIOSK' ? 'kiosk' : canal.id === 'DELIVERY' ? 'delivery' : canal.id === 'MESA' ? 'mesas' : canal.id === 'TAKEAWAY' ? 'takeaway' : 'caja'
                    return modulos[llaveModulo] !== false
                  }).map(canal => {
                    const mT = mapeoDe(canal.id, 'TRANSFERENCIA')
                    const mM = mapeoDe(canal.id, 'MERCADO_PAGO')
                    const sel = 'w-full px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700'
                    // Grilla ON/OFF: estado EFECTIVO = base && llave del canal (misma
                    // fórmula que /api/kiosk/pagos y el guard — una sola verdad)
                    const s = canal.suf
                    const efvo = s ? (llaves?.acepta_efectivo !== false) && (llaves?.[`acepta_efectivo_${s}`] !== false) : null
                    const trf = s ? (llaves?.acepta_transferencia !== false) && (llaves?.[`acepta_transferencia_${s}`] !== false) : null
                    const mpOn = s && canal.llaveMp ? (llaves?.acepta_mp !== false) && (llaves?.[canal.llaveMp] !== false) : null
                    // Canal público con TODO apagado: el cliente no puede confirmar
                    // ningún pedido ahí (F-C: lista vacía → aviso y confirmar bloqueado)
                    const sinMedios = s !== null && efvo === false && trf === false && mpOn === false
                    return (
                      <tr key={canal.id} className={`border-t border-neutral-100 ${sinMedios ? 'bg-amber-50/60' : ''}`}>
                        <td className="py-2.5 pr-3 font-semibold text-neutral-700 whitespace-nowrap">
                          {canal.emoji} {canal.label}
                          {sinMedios && <span className="block text-[11px] font-semibold text-amber-600 mt-0.5">⚠️ Sin medios de pago: los clientes de este canal no podrán confirmar pedidos</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          {s ? <LlaveToggle canalId={canal.id} medio="EFECTIVO" efectiva={!!efvo} baseOff={llaves?.acepta_efectivo === false} label={canal.label} /> : <span title="Venta manual: el operador cobra en mano — siempre permitido" className="min-w-[52px] inline-block text-center px-2 py-1 rounded-full text-[11px] font-bold bg-neutral-50 text-neutral-400 border border-neutral-200">Permitido</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          {s ? <LlaveToggle canalId={canal.id} medio="TRANSFERENCIA" efectiva={!!trf} baseOff={llaves?.acepta_transferencia === false} label={canal.label} /> : <span title="Venta manual: el operador cobra en mano — siempre permitido" className="min-w-[52px] inline-block text-center px-2 py-1 rounded-full text-[11px] font-bold bg-neutral-50 text-neutral-400 border border-neutral-200">Permitido</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          <select className={`${sel} ${s && trf === false ? 'opacity-45 bg-neutral-50' : ''}`} value={mT?.transferencia_cuenta_id ?? ''} disabled={guardando || (s !== null && trf === false)}
                            title={s && trf === false ? 'Transferencia está OFF en este canal — la cuenta asignada se conserva para cuando se habilite' : undefined}
                            onChange={e => e.target.value
                              ? accion({ accion: 'asignar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'TRANSFERENCIA', cuenta_id: e.target.value }, `${canal.label}: transferencia asignada`)
                              : accion({ accion: 'quitar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'TRANSFERENCIA' }, `${canal.label}: vuelve a la cuenta de siempre`)}>
                            <option value="">Cuenta de siempre (Sucursales)</option>
                            {cuentasDeSucursal.map(c => <option key={c.id} value={c.id} disabled={!c.activo && mT?.transferencia_cuenta_id !== c.id}>{c.nombre}{!c.activo ? ' (inactiva)' : ''}</option>)}
                          </select>
                        </td>
                        <td className="py-2.5 pr-3">
                          {s && canal.llaveMp ? <LlaveToggle canalId={canal.id} medio="MERCADO_PAGO" efectiva={!!mpOn} baseOff={llaves?.acepta_mp === false} label={canal.label} /> : <span title="Venta manual: el operador cobra en mano — siempre permitido" className="min-w-[52px] inline-block text-center px-2 py-1 rounded-full text-[11px] font-bold bg-neutral-50 text-neutral-400 border border-neutral-200">Permitido</span>}
                        </td>
                        <td className="py-2.5">
                          <select className={`${sel} ${s && mpOn === false ? 'opacity-45 bg-neutral-50' : ''}`} value={mM?.mp_credencial_id ?? ''} disabled={guardando || (s !== null && mpOn === false)}
                            title={s && mpOn === false ? 'MP está OFF en este canal — la credencial asignada se conserva para cuando se habilite' : undefined}
                            onChange={e => e.target.value
                              ? accion({ accion: 'asignar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'MERCADO_PAGO', cuenta_id: e.target.value }, `${canal.label}: cuenta MP asignada`)
                              : accion({ accion: 'quitar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'MERCADO_PAGO' }, `${canal.label}: vuelve a la cuenta de siempre`)}>
                            <option value="">Cuenta de siempre (Sucursales)</option>
                            {credencialesAsignables.map(c => <option key={c.id} value={c.id} disabled={!c.activo && mM?.mp_credencial_id !== c.id}>{c.nombre}{c.sucursal_id === null ? ' (marca)' : ''}{!c.activo ? ' (inactiva)' : ''}</option>)}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-neutral-400 pt-2 border-t border-neutral-100">
<b>ON/OFF</b> decide qué medios ve el cliente en cada canal; <b>las cuentas</b> deciden a dónde va la plata. <b>Cuenta de siempre</b>: sin asignación, el canal usa los datos históricos de la sucursal. Para habilitar transferencia en un canal hace falta una cuenta con datos (el sistema lo exige solo). Los pedidos ya cobrados nunca cambian de cuenta. 💡 Apagar el efectivo de Take Away = solo prepago, recomendado para evitar pedidos fantasma.
            </p>
          </div>
        </ConeCard>
      )}
    </div>
  )
}
