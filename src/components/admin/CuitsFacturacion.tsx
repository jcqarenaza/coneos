'use client'

import { confirmar } from '@/components/admin/ConeDialog'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ConeCard } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Pencil, X } from 'lucide-react'

// ============================================================
// 🧾 CUITs QUE FACTURAN — componente compartido (MULTI-CUIT B5)
// Lo usan Cuentas y cobros (pestaña «🧾 CUITs») y Configuración
// (tarjeta «Facturación electrónica»): una sola UI, un solo
// comportamiento. Toda escritura va por /api/admin/cuits, que corre
// con la sesión del admin y toma la empresa SIEMPRE de la sesión.
//
// REGLAS DURAS (las hace cumplir el servidor; acá solo se respetan):
//  · certificado y clave son WRITE-ONLY: el servidor nunca los devuelve,
//    solo los booleans cert_cargado / clave_cargada.
//  · vacío al editar = conservar lo que ya está guardado.
//  · si cambian datos fiscales, la config vuelve a borrador y se apaga:
//    hay que probar la conexión de nuevo antes de activar.
//  · ambiente siempre producción (no se expone) y no se activa un CUIT
//    que no esté en estado 'validado'.
// ============================================================

export interface Cuit {
  id: string; sucursal_id: string | null; cuit: string; razon_social: string
  condicion_fiscal: 'monotributo' | 'ri'; punto_venta: number
  activo: boolean; estado: 'borrador' | 'validado'; es_fallback: boolean
  auto_facturar: boolean; metodos_auto: string[] | null
  cert_cargado: boolean; clave_cargada: boolean
}
/** Lo mínimo de una cuenta (transferencia) o credencial (Mercado Pago) para mostrar «Usado por». */
export interface CuentaVinculada { id: string; nombre: string; facturacion_config_id: string | null }

type Llamar = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>

const BTN = 'min-h-[44px] text-sm font-semibold px-4 rounded-xl border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition-colors disabled:opacity-40'

export function CuitsFacturacion({ cuits, cuentas, credenciales, llamar, onCambio, onError, onAviso }: {
  cuits: Cuit[]
  cuentas: CuentaVinculada[]
  credenciales: CuentaVinculada[]
  /** POST a /api/admin/cuits (lanza Error con el mensaje del servidor si falla). */
  llamar: Llamar
  /** Recarga los datos de la pantalla después de cada cambio. */
  onCambio: () => Promise<void> | void
  onError: (mensaje: string | null) => void
  onAviso: (mensaje: string, ms?: number) => void
}) {
  const [editCuit, setEditCuit] = useState<Partial<Cuit> | null>(null)
  const [probando, setProbando] = useState<string | null>(null)
  const [testOk, setTestOk] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  async function accionCuit(payload: Record<string, unknown>, ok?: string) {
    setGuardando(true)
    onError(null)
    try {
      const d = await llamar(payload)
      if (ok) onAviso(ok)
      await onCambio()
      return d
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error')
      return null
    } finally {
      setGuardando(false)
    }
  }

  // Probar conexión: llama a ARCA de verdad (sin emitir) — puede tardar unos segundos
  async function probarCuit(c: Cuit) {
    setProbando(c.id); onError(null)
    try {
      const d = await llamar({ accion: 'probar_cuit', cuit_id: c.id })
      setTestOk(t => ({ ...t, [c.id]: `✓ ARCA respondió OK — último comprobante: ${d.ultimo_cbte ?? '0'}` }))
      await onCambio()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Error probando la conexión')
    } finally { setProbando(null) }
  }

  // Lee el archivo ACEPTANDO lo que ARCA entregue: PEM (texto) o DER (binario,
  // se convierte a PEM acá). Sin filtros de extensión: el diálogo lista todo.
  const leerArchivo = (file: File, destinoId: string) => {
    const r = new FileReader()
    r.onload = () => {
      const el = document.getElementById(destinoId) as HTMLTextAreaElement
      if (!el || !(r.result instanceof ArrayBuffer)) return
      const bytes = new Uint8Array(r.result)
      const texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      if (texto.includes('-----BEGIN')) { el.value = texto.trim(); return }
      // Binario (DER) → envolver en PEM
      let b64 = ''
      for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const cuerpo = btoa(b64).replace(/(.{64})/g, '$1\n').trim()
      const tipo = destinoId === 'fc-key' ? 'PRIVATE KEY' : 'CERTIFICATE'
      el.value = `-----BEGIN ${tipo}-----\n${cuerpo}\n-----END ${tipo}-----`
    }
    r.readAsArrayBuffer(file)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400">Cada CUIT es un emisor fiscal completo: certificado ARCA propio, punto de venta propio y numeración propia. El <b>principal</b> factura todo lo que no tenga otro CUIT asignado; los adicionales facturan solo las cuentas que los elijan (🧾 Factura como, en cada cuenta).</p>
      {cuits.length === 0 && <p className="text-sm text-neutral-400">Todavía no hay ningún CUIT cargado. El primero que cargues va a ser el principal.</p>}
      {cuits.map(c => {
        const completa = c.cert_cargado && c.clave_cargada
        return (
          <div key={c.id} className="p-3 rounded-xl border border-neutral-100 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-neutral-800 text-sm">🧾 {c.razon_social}</span>
                  {c.es_fallback && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-700">Principal</span>}
                  {c.estado === 'borrador'
                    ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700">Borrador — falta probar conexión</span>
                    : c.activo
                      ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-50 text-green-700">Validado · Emitiendo</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-500">Validado · Apagado</span>}
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">CUIT {c.cuit} · PV {c.punto_venta} · {c.condicion_fiscal === 'ri' ? 'Resp. Inscripto' : 'Monotributo'} · Certificado {c.cert_cargado ? '✓' : '✗ falta'} · Clave {c.clave_cargada ? '✓' : '✗ falta'}</p>
                {testOk[c.id] && <p className="text-xs font-semibold text-green-600 mt-0.5">{testOk[c.id]}</p>}
                {(() => { // D (CTO 25/09): la relación vista desde el CUIT — misma fuente, cero duplicación
                  const usos = [
                    ...cuentas.filter(x => x.facturacion_config_id === c.id).map(x => `🏦 ${x.nombre}`),
                    ...credenciales.filter(x => x.facturacion_config_id === c.id).map(x => `🟦 ${x.nombre}`),
                  ]
                  if (usos.length === 0 && !c.es_fallback) return <p className="text-[11px] text-neutral-300 mt-1">Sin cuentas vinculadas todavía — asignalo desde 🧾 Factura como en cada cuenta</p>
                  return (usos.length > 0 || c.es_fallback) ? (
                    <p className="text-[11px] text-neutral-400 mt-1">
                      <span className="font-bold uppercase tracking-wide">Usado por:</span> {usos.join(' · ')}{c.es_fallback ? `${usos.length ? ' · ' : ' '}todo lo que no tenga CUIT asignado (automático)` : ''}
                    </p>
                  ) : null
                })()}
              </div>
              <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                <button onClick={() => setEditCuit(c)} aria-label="Editar CUIT" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-700 transition-colors"><Pencil className="h-4 w-4" /></button>
                <button disabled={guardando}
                  title="Genera la clave privada acá (queda guardada, nunca se muestra) y descarga el pedido .csr para subir a ARCA"
                  onClick={async () => {
                    if ((c.cert_cargado || c.estado === 'validado') && !(await confirmar(`Esto genera una clave privada NUEVA para el CUIT ${c.cuit}: el certificado actual deja de servir y hay que subir uno nuevo de ARCA (mientras tanto no emite). ¿Continuar?`, { peligro: true, confirmarLabel: 'Sí, generar nueva' }))) return
                    const d = await accionCuit({ accion: 'generar_csr', cuit_id: c.id }, 'Clave generada y guardada — bajando el pedido .csr para ARCA')
                    if (typeof d?.csr_pem === 'string') {
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(new Blob([d.csr_pem], { type: 'application/pkcs10' }))
                      a.download = `pedido-certificado-${c.cuit}.csr`
                      a.click(); URL.revokeObjectURL(a.href)
                    }
                  }}
                  className={BTN}>
                  🔑 Pedido de certificado
                </button>
                <button disabled={!completa || probando === c.id} onClick={() => probarCuit(c)}
                  title={completa ? 'Prueba real contra ARCA: certificado, relación wsfe y numeración. No emite nada.' : 'Cargá certificado y clave primero'}
                  className={BTN}>
                  {probando === c.id ? '⏳ Probando…' : '🔌 Probar conexión'}
                </button>
                <button disabled={guardando || (c.estado !== 'validado' && !c.activo)}
                  onClick={async () => {
                    if (!c.activo && !(await confirmar(`¿Activar la emisión de facturas REALES con el CUIT ${c.cuit}?`, { confirmarLabel: 'Activar emisión' }))) return
                    accionCuit({ accion: 'toggle_activo_cuit', cuit_id: c.id, activo: !c.activo }, c.activo ? 'CUIT apagado — no emite más' : 'CUIT emitiendo facturas reales')
                  }}
                  className={BTN}>
                  {c.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
            {!c.es_fallback && (
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-neutral-50">
                <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wide">Factura autom. al cobrar:</span>
                {(['transferencia', 'mp', 'efectivo', 'debito', 'credito'] as const).map(m => {
                  const on = (c.metodos_auto ?? []).includes(m)
                  return (
                    <button key={m} disabled={guardando}
                      onClick={() => accionCuit({ accion: 'metodos_cuit', cuit_id: c.id, metodos_auto: on ? (c.metodos_auto ?? []).filter(x => x !== m) : [...(c.metodos_auto ?? []), m] }, 'Métodos actualizados')}
                      className={`min-h-[44px] text-xs font-bold px-3 rounded-full border transition-colors ${on ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-neutral-400 border-neutral-200'}`}>
                      {m === 'mp' ? 'Mercado Pago' : m}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {editCuit ? (
        <div className="p-4 rounded-xl border border-neutral-200 bg-neutral-50 space-y-3">
          <p className="text-sm font-bold text-neutral-700">{editCuit.id ? `Editar ${editCuit.razon_social}` : 'Nuevo CUIT'}</p>
          <div className="grid grid-cols-1 gap-3">
            <div><Label className="text-xs">CUIT (11 dígitos) *</Label><Input className="min-h-[44px]" defaultValue={editCuit.cuit ?? ''} id="fc-cuit" placeholder="27173271064" inputMode="numeric" /></div>
            <div><Label className="text-xs">Razón social *</Label><Input className="min-h-[44px]" defaultValue={editCuit.razon_social ?? ''} id="fc-razon" placeholder="Como figura en ARCA" /></div>
            <div><Label className="text-xs">Condición fiscal *</Label>
              <select id="fc-cond" defaultValue={editCuit.condicion_fiscal ?? 'monotributo'} className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="monotributo">Monotributo</option>
                <option value="ri">Responsable Inscripto</option>
              </select>
            </div>
            <div><Label className="text-xs">Punto de venta *</Label><Input className="min-h-[44px]" defaultValue={editCuit.punto_venta ?? ''} id="fc-pv" placeholder="3" type="number" inputMode="numeric" /></div>
            <div>
              <Label className="text-xs">Certificado (.crt / .pem) {editCuit.id && editCuit.cert_cargado ? '· ✓ cargado — dejá vacío para conservarlo' : '*'}</Label>
              <input type="file" className="block w-full min-h-[44px] text-xs text-neutral-500 mb-1" onChange={e => e.target.files?.[0] && leerArchivo(e.target.files[0], 'fc-cert')} />
              <textarea id="fc-cert" rows={3} placeholder="-----BEGIN CERTIFICATE-----" className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-xs font-mono bg-white" />
            </div>
            <div>
              <Label className="text-xs">Clave privada (.key) {editCuit.id && editCuit.clave_cargada ? '· ✓ cargada — dejá vacío para conservarla' : '*'}</Label>
              <input type="file" className="block w-full min-h-[44px] text-xs text-neutral-500 mb-1" onChange={e => e.target.files?.[0] && leerArchivo(e.target.files[0], 'fc-key')} />
              <textarea id="fc-key" rows={3} placeholder="-----BEGIN PRIVATE KEY-----" className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-xs font-mono bg-white" />
              <p className="text-[11px] text-neutral-400 mt-1">🔒 La clave se guarda protegida en el servidor y nunca vuelve a mostrarse.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={guardando} className="min-h-[44px] inline-flex items-center gap-2 font-semibold rounded-xl px-4 text-sm bg-neutral-800 text-white hover:bg-neutral-700 shadow-sm active:scale-[0.98] transition-all disabled:opacity-50" onClick={async () => {
              const v = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? ''
              const base = { cuit: v('fc-cuit'), razon_social: v('fc-razon'), condicion_fiscal: v('fc-cond'), punto_venta: Number(v('fc-pv')), cert_pem: v('fc-cert'), key_pem: v('fc-key') }
              const d = await accionCuit(editCuit.id ? { accion: 'editar_cuit', cuit_id: editCuit.id, ...base } : { accion: 'crear_cuit', ...base },
                editCuit.id ? 'CUIT actualizado' : 'CUIT creado — ahora probá la conexión')
              if (d) { setEditCuit(null); if (d.revalidar) onAviso('Cambiaron datos fiscales: probá la conexión de nuevo antes de activar', 4000) }
            }}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}</button>
            <button onClick={() => setEditCuit(null)} aria-label="Cancelar" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-neutral-200 text-neutral-500"><X className="h-4 w-4" /></button>
          </div>
        </div>
      ) : (
        <div className="pt-3 border-t border-neutral-100">
          <button type="button" className="min-h-[44px] inline-flex items-center gap-2 font-semibold rounded-xl px-4 text-sm bg-neutral-800 text-white hover:bg-neutral-700 shadow-sm active:scale-[0.98] transition-all disabled:opacity-50" onClick={() => setEditCuit({})}><Plus className="h-4 w-4 mr-1" /> Cargar CUIT</button>
        </div>
      )}

      <details className="text-xs text-neutral-500 pt-2 border-t border-neutral-100">
        <summary className="font-semibold cursor-pointer text-neutral-600 min-h-[44px] flex items-center">📋 ¿Cómo consigo el certificado en ARCA? (guía paso a paso)</summary>
        <ol className="list-decimal ml-4 mt-2 space-y-1.5">
          <li><b>Pedido de certificado:</b> tocá <b>🔑 Pedido de certificado</b> acá arriba en tu CUIT — la clave privada queda guardada sola (nunca la vas a ver ni la necesitás) y se descarga un archivo <b>.csr</b>.</li>
          <li><b>Certificado digital:</b> en arca.gob.ar con tu clave fiscal → <b>Administración de Certificados Digitales</b> → agregá un alias (ej: el nombre del negocio) → subí el <b>.csr</b> del paso anterior → descargá el archivo <b>.crt</b> y cargalo acá con el lápiz ✏️ (la clave dejala vacía: ya está guardada).</li>
          <li><b>Autorizar el servicio:</b> → <b>Administrador de Relaciones de Clave Fiscal</b> → Nueva relación → servicio <b>&quot;Facturación Electrónica&quot; (wsfe)</b> → autorizá el certificado del paso 1.</li>
          <li><b>Punto de venta:</b> → <b>Comprobantes en línea</b> → A/B/M de puntos de venta → creá uno del tipo <b>&quot;Factura Electrónica – Webservice&quot;</b> y anotá el número acá.</li>
        </ol>
        <p className="mt-2">Después tocá <b>Probar conexión</b>: el sistema verifica todo contra ARCA sin emitir ningún comprobante. Si da OK, activás y listo.</p>
      </details>
    </div>
  )
}

// ============================================================
// Tarjeta autónoma para Configuración: obtiene sola los datos
// (GET /api/admin/pagos-cuentas → módulos, cuentas y credenciales;
// GET /api/admin/cuits → CUITs) y solo muestra el autoservicio si el
// módulo de facturación está habilitado para la empresa.
// ============================================================
export function FacturacionElectronicaCard({ onModulo }: { onModulo?: (habilitado: boolean) => void }) {
  const [cargando, setCargando] = useState(true)
  const [habilitado, setHabilitado] = useState(false)
  const [cuits, setCuits] = useState<Cuit[]>([])
  const [cuentas, setCuentas] = useState<CuentaVinculada[]>([])
  const [credenciales, setCredenciales] = useState<CuentaVinculada[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const pedir = useCallback(async (url: string, init?: { method: 'POST'; body: Record<string, unknown> }) => {
    const { data: { session } } = await createClient().auth.getSession()
    if (!session) throw new Error('Sesión vencida — recargá la página')
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.error ?? 'Error inesperado')
    return d
  }, [])

  const cargar = useCallback(async () => {
    try {
      const p = await pedir('/api/admin/pagos-cuentas')
      const ok = p.modulos?.facturacion === true
      setHabilitado(ok); onModulo?.(ok)
      setCuentas(p.cuentas_transferencia ?? []); setCredenciales(p.credenciales ?? [])
      if (ok) { const c = await pedir('/api/admin/cuits'); setCuits(c.cuits ?? []) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando')
    } finally { setCargando(false) }
  }, [pedir, onModulo])

  useEffect(() => { cargar() }, [cargar])

  return (
    <ConeCard title="🧾 Facturación electrónica">
      {cargando ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-neutral-300" /></div>
      ) : !habilitado ? (
        <p className="text-sm text-neutral-500">{error ?? 'Facturación electrónica no está habilitada para tu plan, contactanos.'}</p>
      ) : (
        <div className="space-y-3">
          {error && <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700 font-medium">{error}</div>}
          <CuitsFacturacion cuits={cuits} cuentas={cuentas} credenciales={credenciales}
            llamar={body => pedir('/api/admin/cuits', { method: 'POST', body })}
            onCambio={cargar} onError={setError}
            onAviso={(m, ms = 2500) => { setAviso(m); setTimeout(() => setAviso(null), ms) }} />
          {aviso && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 text-white rounded-full text-sm font-semibold shadow-lg pointer-events-none bg-green-600">✓ {aviso}</div>}
        </div>
      )}
    </ConeCard>
  )
}
