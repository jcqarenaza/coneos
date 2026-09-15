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
interface Llaves { acepta_transferencia: boolean; acepta_mp: boolean; acepta_mp_kiosk: boolean | null; acepta_mp_delivery: boolean | null; acepta_mp_mesa: boolean | null; acepta_mp_takeaway: boolean | null }
interface Sucursal { id: string; nombre: string }

const CANALES: { id: string; label: string; emoji: string; llaveMp: keyof Llaves | null }[] = [
  { id: 'KIOSK', label: 'Kiosk', emoji: '🛒', llaveMp: 'acepta_mp_kiosk' },
  { id: 'DELIVERY', label: 'Delivery', emoji: '🛵', llaveMp: 'acepta_mp_delivery' },
  { id: 'MESA', label: 'Mesa', emoji: '🍽️', llaveMp: 'acepta_mp_mesa' },
  { id: 'TAKEAWAY', label: 'Take Away', emoji: '🥡', llaveMp: 'acepta_mp_takeaway' },
  { id: 'CAJA', label: 'Caja', emoji: '🧾', llaveMp: null },
]

export default function CuentasPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [tab, setTab] = useState<'mp' | 'transfer' | 'matriz'>('mp')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalSel, setSucursalSel] = useState<string>('')
  const [credenciales, setCredenciales] = useState<Credencial[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [mapeos, setMapeos] = useState<Mapeo[]>([])
  const [llaves, setLlaves] = useState<Llaves | null>(null)

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
      {aviso && <div className="p-3 bg-green-50 border border-green-100 rounded-xl text-sm text-green-700 font-medium">✓ {aviso}</div>}

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

            {cuentasDeSucursal.length === 0 && <p className="text-sm text-neutral-400">Esta sucursal no tiene cuentas cargadas — los canales usan la configuración general (Sucursales).</p>}
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
                    <th className="py-2 pr-3 font-semibold">🏦 Transferencia</th>
                    <th className="py-2 font-semibold">🟦 Mercado Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {CANALES.map(canal => {
                    const mT = mapeoDe(canal.id, 'TRANSFERENCIA')
                    const mM = mapeoDe(canal.id, 'MERCADO_PAGO')
                    const llaveMpOff = llaves && canal.llaveMp !== null && (llaves.acepta_mp === false || llaves[canal.llaveMp] === false)
                    const sel = 'w-full px-2 py-1.5 rounded-lg border border-neutral-200 text-sm bg-white text-neutral-700'
                    return (
                      <tr key={canal.id} className="border-t border-neutral-100">
                        <td className="py-2.5 pr-3 font-semibold text-neutral-700 whitespace-nowrap">{canal.emoji} {canal.label}</td>
                        <td className="py-2.5 pr-3">
                          <select className={sel} value={mT?.transferencia_cuenta_id ?? ''} disabled={guardando}
                            onChange={e => e.target.value
                              ? accion({ accion: 'asignar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'TRANSFERENCIA', cuenta_id: e.target.value }, `${canal.label}: transferencia asignada`)
                              : accion({ accion: 'quitar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'TRANSFERENCIA' }, `${canal.label}: vuelve a config. general`)}>
                            <option value="">Config. general (legacy)</option>
                            {cuentasDeSucursal.map(c => <option key={c.id} value={c.id} disabled={!c.activo && mT?.transferencia_cuenta_id !== c.id}>{c.nombre}{!c.activo ? ' (inactiva)' : ''}</option>)}
                          </select>
                        </td>
                        <td className="py-2.5">
                          <select className={sel} value={mM?.mp_credencial_id ?? ''} disabled={guardando}
                            onChange={e => e.target.value
                              ? accion({ accion: 'asignar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'MERCADO_PAGO', cuenta_id: e.target.value }, `${canal.label}: cuenta MP asignada`)
                              : accion({ accion: 'quitar_mapeo', sucursal_id: sucursalSel, canal: canal.id, medio: 'MERCADO_PAGO' }, `${canal.label}: vuelve a config. general`)}>
                            <option value="">Config. general (legacy)</option>
                            {credencialesAsignables.map(c => <option key={c.id} value={c.id} disabled={!c.activo && mM?.mp_credencial_id !== c.id}>{c.nombre}{c.sucursal_id === null ? ' (marca)' : ''}{!c.activo ? ' (inactiva)' : ''}</option>)}
                          </select>
                          {llaveMpOff && mM && <p className="text-[11px] text-amber-600 mt-1">⚠️ La llave de MP de este canal está apagada en Sucursales — el cliente no lo ve.</p>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-neutral-400 pt-2 border-t border-neutral-100">
              <b>Config. general (legacy)</b>: sin cuenta asignada, el canal usa la configuración general de la sucursal — como siempre funcionó. Encender o apagar un medio se hace en <b>Sucursales</b>; acá se elige <b>a qué cuenta</b> va la plata. Los pedidos ya cobrados nunca cambian de cuenta.
            </p>
          </div>
        </ConeCard>
      )}
    </div>
  )
}
