'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConePageHeader, ConeButton, ConeModal } from '@/components/admin/ConeComponents'
import { Loader2, FileText, XCircle, RefreshCw } from 'lucide-react'

interface Factura {
  id: string
  pedido_id: string
  tipo_cbte: number
  punto_venta: number
  nro_cbte: number | null
  total: number
  cae: string | null
  cae_vencimiento: string | null
  estado: string
  error_msg: string | null
  created_at: string
  pedidos: { numero_pedido: number } | null
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function formatFechaHora(ts: string) {
  return new Date(ts).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function pad(n: number, len: number) { return String(n).padStart(len, '0') }


const METODO_UI: Record<string, string> = { transferencia: 'Transferencia', efectivo: 'Efectivo', mp: 'Mercado Pago', debito: 'Débito (mesas)', credito: 'Crédito (mesas)' }
const TIPO_LABEL: Record<number, string> = { 11: 'Factura C', 13: 'Nota de Crédito C' }
const TIPO_BADGE: Record<number, string> = { 11: 'bg-blue-50 text-blue-700', 13: 'bg-amber-50 text-amber-700' }
const ESTADO_LABEL: Record<string, string> = { emitida: 'Emitida', anulada: 'Anulada', pendiente: 'Pendiente', error: 'Error' }
const ESTADO_BADGE: Record<string, string> = {
  emitida: 'bg-green-50 text-green-700', anulada: 'bg-neutral-100 text-neutral-500',
  pendiente: 'bg-amber-50 text-amber-700', error: 'bg-red-50 text-red-700',
}

export default function FacturasPage() {
  const { ctx } = useEmpresa()
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [loading, setLoading] = useState(true)
  const [tipoFiltro, setTipoFiltro] = useState<string>('todos')
  const [estadoFiltro, setEstadoFiltro] = useState<string>('todos')
  const [modalNC, setModalNC] = useState(false)
  const [facturaNC, setFacturaNC] = useState<Factura | null>(null)
  const [emitiendo, setEmitiendo] = useState(false)
  const [errorNC, setErrorNC] = useState<string | null>(null)
  const [factActiva, setFactActiva] = useState<boolean | null>(null)
  const [factConfigurada, setFactConfigurada] = useState(false)
  const [autoFacturar, setAutoFacturar] = useState(true)
  const [metodosAuto, setMetodosAuto] = useState<string[]>(['transferencia'])
  const [metodosDisp, setMetodosDisp] = useState<string[]>(['transferencia', 'efectivo'])
  const [guardandoCfg, setGuardandoCfg] = useState(false)

  async function cargar() {
    if (!ctx) return
    setLoading(true)
    const supabase = createClient()
    let query = supabase
      .from('facturas')
      .select('id, pedido_id, tipo_cbte, punto_venta, nro_cbte, total, cae, cae_vencimiento, estado, error_msg, created_at, pedidos(numero_pedido)')
      .eq('empresa_id', ctx.empresaId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (tipoFiltro !== 'todos') query = query.eq('tipo_cbte', Number(tipoFiltro))
    if (estadoFiltro !== 'todos') query = query.eq('estado', estadoFiltro)
    const { data } = await query
    setFacturas((data ?? []) as unknown as Factura[])
    setLoading(false)
  }

  useEffect(() => { cargar() }, [ctx, tipoFiltro, estadoFiltro])

  useEffect(() => {
    if (!ctx) return
    fetch(`/api/facturacion/emitir?empresa_id=${ctx.empresaId}`)
      .then(r => r.json()).then(d => {
        setFactActiva(!!d.activa); setFactConfigurada(!!d.configurada)
        setAutoFacturar(d.auto !== false)
        if (Array.isArray(d.metodos)) setMetodosAuto(d.metodos)
        if (Array.isArray(d.disponibles)) setMetodosDisp([...new Set([...d.disponibles, 'debito', 'credito'])])
      }).catch(() => setFactActiva(null))
  }, [ctx])

  async function emitirNC() {
    if (!ctx || !facturaNC) return
    setEmitiendo(true)
    setErrorNC(null)
    try {
      const res = await fetch('/api/facturacion/nc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: ctx.empresaId, pedido_id: facturaNC.pedido_id }),
      })
      const data = await res.json()
      if (!data.ok) {
        setErrorNC(data.error ?? 'Error al emitir la nota de crédito')
        setEmitiendo(false)
        return
      }
      setEmitiendo(false)
      setModalNC(false)
      setFacturaNC(null)
      cargar()
    } catch {
      setErrorNC('Error de conexión')
      setEmitiendo(false)
    }
  }

  async function guardarCfg(cambios: { auto_facturar?: boolean; metodos_auto?: string[] }) {
    if (!ctx || guardandoCfg) return
    setGuardandoCfg(true)
    try {
      const res = await fetch('/api/facturacion/emitir', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: ctx.empresaId, ...cambios }),
      })
      const d = await res.json()
      if (d.ok) {
        if (typeof cambios.auto_facturar === 'boolean') setAutoFacturar(cambios.auto_facturar)
        if (cambios.metodos_auto) setMetodosAuto(cambios.metodos_auto)
      }
    } finally { setGuardandoCfg(false) }
  }

  function toggleMetodo(m: string) {
    const nuevos = metodosAuto.includes(m) ? metodosAuto.filter(x => x !== m) : [...metodosAuto, m]
    guardarCfg({ metodos_auto: nuevos })
  }

  const totalEmitidas = facturas.filter(f => f.estado === 'emitida' && f.tipo_cbte === 11).length
  const totalNC = facturas.filter(f => f.estado === 'emitida' && f.tipo_cbte === 13).length

  return (
    <div>
      <ConePageHeader title="Facturas" description="Comprobantes electrónicos emitidos ante ARCA" />

      {/* Config del cliente: facturación automática y métodos */}
      {factConfigurada && (
        <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-bold text-neutral-800 text-sm">Facturación automática</p>
              <p className="text-neutral-400 text-xs mt-0.5">
                {autoFacturar
                  ? 'Los pedidos cobrados con los métodos elegidos emiten su Factura C ante ARCA, con CAE y QR en el ticket.'
                  : 'Pausada — ningún pedido emite factura hasta reactivarla.'}
              </p>
            </div>
            <button onClick={() => guardarCfg({ auto_facturar: !autoFacturar })} disabled={guardandoCfg}
              className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${autoFacturar ? 'bg-green-500' : 'bg-neutral-200'} ${guardandoCfg ? 'opacity-50' : ''}`}>
              <span className={`absolute top-0.5 h-6 w-6 bg-white rounded-full shadow transition-all ${autoFacturar ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {autoFacturar && (
            <div className="mt-4 pt-4 border-t border-neutral-50">
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">Métodos de pago que facturan</p>
              <div className="flex flex-wrap gap-2">
                {metodosDisp.map(m => {
                  const on = metodosAuto.includes(m)
                  return (
                    <button key={m} onClick={() => toggleMetodo(m)} disabled={guardandoCfg}
                      className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition-colors ${on ? 'bg-neutral-800 text-white border-neutral-800' : 'bg-white text-neutral-400 border-neutral-200 hover:border-neutral-400'} ${guardandoCfg ? 'opacity-50' : ''}`}>
                      {on ? '✓ ' : ''}{METODO_UI[m] ?? m}
                    </button>
                  )
                })}
              </div>
              {metodosAuto.length === 0 && (
                <p className="text-amber-600 text-xs mt-2">Sin métodos seleccionados no se factura ningún pedido.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Aviso: facturación aún no activada — qué hace falta para el alta */}
      {factActiva === false && !factConfigurada && (
        <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5 mb-6">
          <p className="font-bold text-blue-900 text-sm mb-1">La facturación electrónica todavía no está activa</p>
          <p className="text-blue-800 text-sm mb-3">
            Para activarla necesitamos que tu contador (o el titular con su clave fiscal) gestione en ARCA
            y nos pase estos datos:
          </p>
          <ol className="text-blue-800 text-sm space-y-1.5 list-decimal ml-5 mb-4">
            <li><span className="font-semibold">Certificado digital</span> creado en ARCA (Administración de Certificados Digitales) — nos envían el archivo <span className="font-mono text-xs">.crt</span> y su clave privada <span className="font-mono text-xs">.key</span></li>
            <li><span className="font-semibold">Certificado vinculado al servicio "Facturación Electrónica" (WSFE)</span> desde el Administrador de Relaciones de Clave Fiscal</li>
            <li><span className="font-semibold">Punto de venta Web Services</span> creado en ARCA — nos pasan el número</li>
            <li><span className="font-semibold">CUIT, razón social exacta y condición fiscal</span> (monotributo / responsable inscripto)</li>
          </ol>
          <p className="text-blue-700 text-xs mb-4">Con eso lo cargamos, probamos la conexión con ARCA y activamos. No hay que instalar nada: cada transferencia cobrada emite su Factura C automáticamente, con CAE y QR en el ticket.</p>
          <a href="https://wa.me/542302456497?text=Hola%20Juan%20Cruz%2C%20tengo%20los%20datos%20fiscales%20para%20activar%20la%20facturaci%C3%B3n%20en%20ConeOS"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-colors text-sm">
            💬 Enviar los datos a Juan Cruz
          </a>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-neutral-100 p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Tipo</p>
            <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400 bg-white">
              <option value="todos">Todos</option>
              <option value="11">Factura C</option>
              <option value="13">Nota de Crédito C</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Estado</p>
            <select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-neutral-200 text-xs focus:outline-none focus:border-neutral-400 bg-white">
              <option value="todos">Todos</option>
              <option value="emitida">Emitidas</option>
              <option value="anulada">Anuladas</option>
              <option value="error">Con error</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <p className="text-xs text-neutral-400">{totalEmitidas} facturas vigentes · {totalNC} NC</p>
            <button onClick={cargar} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
      ) : facturas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-100 p-12 text-center shadow-sm">
          <FileText className="h-10 w-10 text-neutral-200 mx-auto mb-3" />
          <p className="text-neutral-400 text-sm">Todavía no hay comprobantes emitidos</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
          {/* Header tabla */}
          <div className="hidden md:grid grid-cols-[110px_150px_120px_80px_100px_1fr_90px_110px] gap-2 px-4 py-2.5 bg-neutral-50 border-b border-neutral-100">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Fecha</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Tipo</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Número</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Pedido</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide text-right">Total</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">CAE</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Estado</p>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide text-right">Acciones</p>
          </div>
          {facturas.map((f, i) => (
            <div key={f.id} className={`px-4 py-3 ${i < facturas.length - 1 ? 'border-b border-neutral-50' : ''}`}>
              <div className="grid grid-cols-2 md:grid-cols-[110px_150px_120px_80px_100px_1fr_90px_110px] gap-2 items-center">
                <p className="text-neutral-500 text-xs">{formatFechaHora(f.created_at)}</p>
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TIPO_BADGE[f.tipo_cbte] ?? 'bg-neutral-100 text-neutral-500'}`}>
                    {TIPO_LABEL[f.tipo_cbte] ?? `Tipo ${f.tipo_cbte}`}
                  </span>
                </div>
                <p className="text-neutral-800 text-sm font-semibold">
                  {f.nro_cbte != null ? `${pad(f.punto_venta, 5)}-${pad(f.nro_cbte, 8)}` : '—'}
                </p>
                <p className="text-neutral-500 text-sm">{f.pedidos?.numero_pedido != null ? `#${f.pedidos.numero_pedido}` : '—'}</p>
                <p className="text-neutral-800 font-bold text-sm md:text-right">{formatPrecio(Number(f.total))}</p>
                <div className="min-w-0">
                  <p className="text-neutral-500 text-xs truncate">{f.cae ?? (f.estado === 'error' ? (f.error_msg ?? 'Error') : '—')}</p>
                  {f.cae_vencimiento && <p className="text-neutral-300 text-[11px]">Vto: {f.cae_vencimiento.split('-').reverse().join('/')}</p>}
                </div>
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ESTADO_BADGE[f.estado] ?? 'bg-neutral-100 text-neutral-500'}`}>
                    {ESTADO_LABEL[f.estado] ?? f.estado}
                  </span>
                </div>
                <div className="flex md:justify-end">
                  {f.tipo_cbte === 11 && f.estado === 'emitida' && (
                    <button onClick={() => { setFacturaNC(f); setErrorNC(null); setModalNC(true) }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <XCircle className="h-3.5 w-3.5" /> Emitir NC
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal NC */}
      <ConeModal open={modalNC} onClose={() => { if (!emitiendo) setModalNC(false) }} title="Emitir Nota de Crédito"
        footer={<>
          <ConeButton variant="outline" onClick={() => setModalNC(false)}>Volver</ConeButton>
          <ConeButton onClick={emitirNC} loading={emitiendo}>
            <span className="text-red-500">Confirmar emisión de NC</span>
          </ConeButton>
        </>}>
        {facturaNC && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <p className="text-red-700 text-sm font-semibold">
                Factura C {pad(facturaNC.punto_venta, 5)}-{pad(facturaNC.nro_cbte ?? 0, 8)} — {formatPrecio(Number(facturaNC.total))}
              </p>
              <p className="text-red-500 text-xs mt-0.5">
                Se va a emitir una Nota de Crédito C ante ARCA por el total, asociada a esta factura. La factura queda anulada. Esta acción no se puede deshacer.
              </p>
            </div>
            {facturaNC.pedidos?.numero_pedido != null && (
              <p className="text-neutral-500 text-sm">Pedido asociado: <span className="font-semibold text-neutral-700">#{facturaNC.pedidos.numero_pedido}</span></p>
            )}
            {errorNC && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <p className="text-red-600 text-xs">{errorNC}</p>
              </div>
            )}
          </div>
        )}
      </ConeModal>
    </div>
  )
}
