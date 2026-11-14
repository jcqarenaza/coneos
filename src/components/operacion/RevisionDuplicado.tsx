'use client'
// Revisión de POSIBLE DUPLICADO en Vista Caja (CTO 14/11, GO condicionado). Fondo blanco.
// Muestra el pedido nuevo resaltado, todos los candidatos (el de mejor coincidencia primero), la comparación lado a lado con datos reales
// y las dos acciones de Luci. NO decide nada por sí mismo: todo lo hace el servidor (api/operacion/consulta → resolverRevision).
import { useState } from 'react'
import { avisar, confirmar } from '@/components/admin/ConeDialog'
import type { RevisionVista, LineaComparacion } from '@/lib/pedidos/revision'

export const TEXTO_ESPERANDO = 'ESPERANDO VER SI ES UN PEDIDO DUPLICADO'
export const TEXTO_DUPLICADO_CONFIRMADO = 'PEDIDO DUPLICADO — NO SE PREPARA'
const ESTADO_TXT: Record<string, string> = { PENDING_PAYMENT: 'Pendiente', PAID: 'Pagado', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' }
const hora = (ts: string) => new Date(ts).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' hs'
const fecha = (ts: string) => new Date(ts).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })

/** "POSIBLE DUPLICADO DEL PEDIDO #43" (o "#43, #41" si hay varios candidatos). */
export function textoPosibleDuplicado(r: RevisionVista): string {
  const nums = r.candidatos.map(c => `#${c.numero_pedido}`)
  return nums.length === 0 ? 'POSIBLE DUPLICADO' : `POSIBLE DUPLICADO DEL PEDIDO ${nums.join(', ')}`
}

/** Etiqueta chica para la lista de pedidos. */
export function BadgeRevision({ r }: { r?: RevisionVista | null }) {
  if (!r) return null
  return r.estado === 'DUPLICADO'
    ? <span className="text-[10px] font-extrabold bg-red-600 text-white px-1.5 py-0.5 rounded">DUPLICADO</span>
    : <span className="text-[10px] font-extrabold bg-amber-500 text-white px-1.5 py-0.5 rounded animate-pulse">¿DUPLICADO?</span>
}

const FILA: Record<LineaComparacion['estado'], string> = { igual: 'bg-white', distinto: 'bg-amber-50', solo_nuevo: 'bg-red-50', solo_candidato: 'bg-blue-50' }
const MARCA: Record<LineaComparacion['estado'], string> = { igual: '= igual', distinto: '≠ cantidad distinta', solo_nuevo: 'solo en este pedido', solo_candidato: 'solo en el otro' }

export default function RevisionDuplicado({ revision: r, pedidoId, numeroPedido, dispositivoId, operadorId, onResuelto }: {
  revision: RevisionVista; pedidoId: string; numeroPedido: number; dispositivoId: string; operadorId: string; onResuelto: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [enCurso, setEnCurso] = useState(false)
  const cand = r.candidatos[Math.min(idx, Math.max(0, r.candidatos.length - 1))]
  const pendiente = r.estado === 'PENDIENTE'

  async function llamar(accion: 'revision_resolver' | 'revision_reembolso', extra: Record<string, unknown> = {}) {
    setEnCurso(true)
    try {
      const res = await fetch('/api/operacion/consulta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispositivo_id: dispositivoId, accion, pedido_id: pedidoId, operador_id: operadorId, ...extra }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { await avisar(d?.error ?? 'No se pudo completar la acción. Reintentá.', { titulo: 'No se pudo resolver' }); onResuelto(); return }
      onResuelto()
    } catch { await avisar('Sin conexión. No se hizo ningún cambio: reintentá.', { titulo: 'No se pudo resolver' }) }
    finally { setEnCurso(false) }
  }

  async function legitimo() {
    if (!(await confirmar(`El pedido #${numeroPedido} sigue su circuito normal (cobro, preparación, facturación). Los otros pedidos no se tocan.`, { titulo: 'Es un pedido legítimo', confirmarLabel: 'Sí, es legítimo', cancelarLabel: 'Volver' }))) return
    await llamar('revision_resolver', { resolucion: 'LEGITIMO' })
  }
  async function duplicado() {
    if (!(await confirmar(`El pedido #${numeroPedido} queda marcado como DUPLICADO: no se prepara, no se cobra y se devuelve su stock. No se cancela ni se borra. Esta decisión no se puede deshacer.`, { titulo: 'Es un pedido duplicado', confirmarLabel: 'Sí, es duplicado', cancelarLabel: 'Volver', peligro: true }))) return
    await llamar('revision_resolver', { resolucion: 'DUPLICADO' })
  }
  async function reembolsoHecho() {
    if (!(await confirmar('Confirmá que el reembolso ya se hizo A MANO desde el panel de Mercado Pago. El sistema no devuelve plata: esto solo deja constancia.', { titulo: 'Reembolso gestionado', confirmarLabel: 'Sí, ya lo reembolsé', cancelarLabel: 'Volver' }))) return
    await llamar('revision_reembolso')
  }

  return (
    <div className={`rounded-2xl border-2 bg-white mb-4 overflow-hidden ${pendiente ? 'border-amber-400' : 'border-red-500'}`} data-testid="revision-duplicado">
      <div className={`px-4 py-3 ${pendiente ? 'bg-amber-400 text-neutral-900' : 'bg-red-600 text-white'}`}>
        <p className="font-black text-sm tracking-wide">{pendiente ? `⚠️ ${TEXTO_ESPERANDO}` : `⛔ ${TEXTO_DUPLICADO_CONFIRMADO}`}</p>
        <p className="font-bold text-xs mt-0.5">{textoPosibleDuplicado(r)}</p>
        <p className="text-xs mt-0.5 opacity-90">{r.coincidencia === 'IDENTICA' ? 'El contenido es idéntico al de un pedido en curso del mismo teléfono.' : 'Mismo teléfono con un pedido en curso, contenido distinto.'}</p>
      </div>

      <div className="p-4">
        {r.candidatos.length === 0 ? (
          <p className="text-sm text-neutral-500">No se encontraron los pedidos anteriores (pueden haberse purgado). Decidí con lo que sabés del cliente.</p>
        ) : (<>
          <p className="text-xs font-bold text-neutral-500 mb-1.5">{r.candidatos.length === 1 ? 'Pedido a comparar' : `${r.candidatos.length} pedidos en curso con este teléfono — el primero es la mejor coincidencia`}</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {r.candidatos.map((c, i) => (
              <button key={c.numero_pedido} onClick={() => setIdx(i)}
                className={`text-left rounded-xl border px-3 py-2 text-xs ${i === idx ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 bg-white hover:bg-neutral-50'}`}>
                <span className="font-black text-neutral-900 text-sm">#{c.numero_pedido}</span>
                <span className="text-neutral-500"> · {fecha(c.created_at)} {hora(c.created_at)}</span><br />
                <span className="text-neutral-600">{ESTADO_TXT[c.estado] ?? c.estado}{c.cliente ? ` · ${c.cliente}` : ''}</span>
              </button>
            ))}
          </div>

          {cand && (
            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] text-[11px] font-bold text-neutral-500 bg-neutral-50 px-3 py-2">
                <span>Producto · presentación · sabores</span><span className="w-20 text-center">Este #{numeroPedido}</span><span className="w-20 text-center">Pedido #{cand.numero_pedido}</span>
              </div>
              {cand.comparacion.lineas.map(l => (
                <div key={l.clave} className={`grid grid-cols-[1fr_auto_auto] items-center px-3 py-2 border-t border-neutral-100 text-sm ${FILA[l.estado]}`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-800 truncate">{l.nombre}{l.presentacion && l.presentacion !== l.nombre ? ` · ${l.presentacion}` : ''}</p>
                    {l.opciones.length > 0 && <p className="text-xs text-neutral-500 truncate">{l.opciones.join(', ')}</p>}
                    <p className={`text-[10px] font-bold ${l.estado === 'igual' ? 'text-green-600' : 'text-amber-700'}`}>{MARCA[l.estado]}</p>
                  </div>
                  <span className="w-20 text-center font-black text-neutral-900">{l.nuevo || '—'}</span>
                  <span className="w-20 text-center font-black text-neutral-900">{l.candidato || '—'}</span>
                </div>
              ))}
              <p className={`px-3 py-2 text-xs font-bold border-t border-neutral-100 ${cand.comparacion.identicos ? 'text-green-700 bg-green-50' : 'text-neutral-600 bg-neutral-50'}`}>
                {cand.comparacion.identicos ? 'Los dos pedidos tienen exactamente el mismo contenido.' : 'Hay diferencias entre los dos pedidos (marcadas arriba).'}
              </p>
            </div>
          )}
        </>)}

        {pendiente ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-neutral-500">Mientras no resuelvas, este pedido <b>no se puede cobrar ni preparar</b>.</p>
            <button onClick={legitimo} disabled={enCurso} className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold text-base disabled:opacity-50">✓ Es legítimo — seguir el circuito normal</button>
            <button onClick={duplicado} disabled={enCurso} className="w-full py-3.5 bg-white border-2 border-red-500 text-red-600 hover:bg-red-50 rounded-2xl font-bold text-base disabled:opacity-50">✕ Es duplicado — no preparar</button>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-neutral-700">Marcado como duplicado{r.resuelto_at ? ` el ${fecha(r.resuelto_at)} a las ${hora(r.resuelto_at)}` : ''}. {r.stock_devuelto ? 'El stock ya fue devuelto.' : 'La devolución de stock está pendiente: repetí la acción desde acá si no se completó.'}</p>
            {r.reembolso_pendiente && (
              <div className="rounded-xl border-2 border-red-500 bg-red-50 p-3" data-testid="reembolso-pendiente">
                {r.reembolso_gestionado_at ? (
                  <p className="text-sm font-bold text-neutral-800">Reembolso gestionado a mano el {fecha(r.reembolso_gestionado_at)} a las {hora(r.reembolso_gestionado_at)}.</p>
                ) : (<>
                  <p className="text-sm font-black text-red-700">💸 Este pedido ya estaba PAGADO por Mercado Pago.</p>
                  <p className="text-xs text-red-700 mt-0.5">Hay que devolverle la plata al cliente A MANO desde el panel de Mercado Pago. El sistema NO la devolvió: reembolso pendiente de gestión.</p>
                  <button onClick={reembolsoHecho} disabled={enCurso} className="mt-2 w-full py-2.5 bg-white border-2 border-red-500 text-red-700 rounded-xl font-bold text-sm disabled:opacity-50">Ya lo reembolsé en Mercado Pago</button>
                </>)}
              </div>
            )}
            {!r.stock_devuelto && <button onClick={() => llamar('revision_resolver', { resolucion: 'DUPLICADO' })} disabled={enCurso} className="w-full py-2.5 bg-white border-2 border-neutral-300 text-neutral-700 rounded-xl font-bold text-sm disabled:opacity-50">Completar devolución de stock</button>}
          </div>
        )}
      </div>
    </div>
  )
}
