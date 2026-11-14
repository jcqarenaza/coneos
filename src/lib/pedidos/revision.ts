// Revisión de POSIBLE DUPLICADO (CTO 14/11, GO condicionado). Lógica de SERVIDOR.
// Qué es: cuando un cliente confirma "Es otro pedido, continuar" frente a un pedido activo del mismo teléfono, el pedido nuevo se crea
// igual (D1) pero queda con una revisión PENDIENTE (tabla pedido_revisiones_duplicado, escrita por reclamar_operacion_pedido bajo el lock del
// teléfono). Mientras la revisión esté PENDIENTE o resuelta como DUPLICADO el pedido está RETENIDO: ningún camino lo puede cobrar, preparar
// ni facturar (D3). Luci resuelve LEGITIMO (se libera y el circuito sigue) o DUPLICADO (se devuelve el stock con las funciones existentes, D2).
// Este módulo NO toca crear_pedido_stock, las funciones de sabores ni el modelo de stock: solo las LLAMA.
import { facturarSiCorresponde } from '@/lib/facturacion/facturar'

// Cliente de base tipado a lo mínimo: la tabla nueva no está en los tipos generados.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string; code?: string } | null }> }
/* eslint-enable @typescript-eslint/no-explicit-any */

export type EstadoRevision = 'PENDIENTE' | 'LEGITIMO' | 'DUPLICADO'
export const CODIGO_RETENIDO = 'REVISION_DUPLICADO'
export const MENSAJE_RETENIDO = 'Este pedido está en revisión como posible duplicado. No se puede cobrar ni preparar hasta que se resuelva en Caja.'

// PGRST202 / 42883 / 42P01: la función o la tabla todavía no existe (el SQL no se aplicó) → no hay revisiones, el circuito es el de siempre.
const sinSql = (e: { code?: string } | null | undefined) => ['PGRST202', '42883', '42P01', 'PGRST205'].includes(String(e?.code ?? ''))

export type Retenidos = { ok: true; retenidos: Map<string, 'PENDIENTE' | 'DUPLICADO'> } | { ok: false }

/**
 * ¿Cuáles de estos pedidos están RETENIDOS (revisión PENDIENTE o DUPLICADO)? Sin el SQL aplicado → ninguno (ok). Cualquier OTRO error de lectura
 * → ok:false y el que llama NO avanza el pedido (FAIL-CLOSED: ante la duda, no se prepara).
 */
export async function pedidosRetenidos(supabase: Db, empresa_id: string, ids: string[]): Promise<Retenidos> {
  if (ids.length === 0) return { ok: true, retenidos: new Map() }
  try {
    const { data, error } = await supabase.rpc('pedidos_en_revision', { p_empresa: empresa_id, p_pedidos: ids })
    if (error) {
      if (sinSql(error)) return { ok: true, retenidos: new Map() }
      console.error('[revision] pedidos_en_revision falló (FAIL-CLOSED, el pedido no avanza):', error.message)
      return { ok: false }
    }
    const m = new Map<string, 'PENDIENTE' | 'DUPLICADO'>()
    for (const r of (data ?? []) as { pedido_id: string; revision_estado: string }[]) m.set(String(r.pedido_id), r.revision_estado === 'DUPLICADO' ? 'DUPLICADO' : 'PENDIENTE')
    return { ok: true, retenidos: m }
  } catch (e) { console.error('[revision] pedidos_en_revision excepción (FAIL-CLOSED):', e); return { ok: false } }
}

export interface RevisionFila {
  id: string; operacion_id: string; candidatos: string[]; coincidencia: 'IDENTICA' | 'DISTINTA'; estado: EstadoRevision
  creado_at: string; resuelto_at: string | null; resuelto_por: string | null; nota: string | null
  stock_devuelto_at: string | null; reanudado_at: string | null
  reembolso_pendiente: boolean; reembolso_gestionado_at: string | null; reembolso_gestionado_por: string | null
  candidatos_snapshot?: { operacion_id: string; numero_pedido: number; created_at: string; estado: string; cliente: string | null; items: { nombre?: string | null; presentacion?: string | null; cantidad?: number | null; opciones?: string[] | null }[] }[] | null
}
const COLS_REV = 'id, operacion_id, candidatos, coincidencia, estado, creado_at, resuelto_at, resuelto_por, nota, stock_devuelto_at, reanudado_at, reembolso_pendiente, reembolso_gestionado_at, reembolso_gestionado_por, candidatos_snapshot'

/** La revisión (si hay) del pedido, por su operación. null = el pedido no tiene revisión (o el SQL no está aplicado). */
export async function revisionDePedido(supabase: Db, empresa_id: string, pedido_id: string): Promise<RevisionFila | null> {
  const { data: p } = await supabase.from('pedidos').select('operacion_id').eq('id', pedido_id).eq('empresa_id', empresa_id).maybeSingle()
  const op = (p as { operacion_id?: string | null } | null)?.operacion_id
  if (!op) return null
  const { data, error } = await supabase.from('pedido_revisiones_duplicado').select(COLS_REV).eq('empresa_id', empresa_id).eq('operacion_id', op).maybeSingle()
  if (error) { if (!sinSql(error)) console.error('[revision] lectura de la revisión falló:', error.message); return null }
  return (data as RevisionFila | null) ?? null
}

// ───────────────────────── MP confirma el pago mientras el pedido está retenido (condición A) ─────────────────────────
/**
 * El pago de Mercado Pago se REGISTRA (pagado, mp_payment_id, nota) pero el pedido NO pasa a PREPARING y NO se factura. Idempotente: un segundo
 * aviso del mismo pago no repite nada. Devuelve qué pasó para que el webhook decida. Cierra las dos carreras con la resolución de Luci:
 *  · si mientras tanto la revisión quedó LEGITIMO → reanuda acá mismo (la reanudación es de UNA sola vez: ver reanudarSiCorresponde);
 *  · si quedó DUPLICADO → marca reembolso_pendiente (el cliente pagó un pedido que Luci descartó: devolución MANUAL, D5).
 */
export async function registrarPagoRetenido(supabase: Db, a: { empresa_id: string; pedido_id: string; payment_id: string; notas: string | null }): Promise<'registrado' | 'ya_registrado'> {
  const { data: act } = await supabase.from('pedidos').update({
    pagado: true, mp_payment_id: a.payment_id,
    notas: a.notas ? `${a.notas} · MP payment ${a.payment_id}` : `MP payment ${a.payment_id}`,
  }).eq('id', a.pedido_id).eq('empresa_id', a.empresa_id).eq('estado', 'PENDING_PAYMENT').is('mp_payment_id', null).select('id')
  const primera = Array.isArray(act) && act.length > 0
  await cerrarCarrerasDePago(supabase, a.empresa_id, a.pedido_id)
  return primera ? 'registrado' : 'ya_registrado'
}

/** Re-lee la revisión DESPUÉS de registrar el pago y completa lo que la resolución de Luci no pudo ver (ver registrarPagoRetenido). Idempotente. */
export async function cerrarCarrerasDePago(supabase: Db, empresa_id: string, pedido_id: string): Promise<void> {
  const rev = await revisionDePedido(supabase, empresa_id, pedido_id)
  if (!rev) return
  if (rev.estado === 'DUPLICADO' && !rev.reembolso_pendiente) {
    // Reembolso pendiente SOLO si hay un pago REAL de Mercado Pago (mp_payment_id): 'pagado' nace TRUE aunque nadie haya pagado, y no se simula plata que no existe.
    const { data: ped } = await supabase.from('pedidos').select('metodo_pago, mp_payment_id').eq('id', pedido_id).eq('empresa_id', empresa_id).maybeSingle()
    const p = ped as { metodo_pago: string | null; mp_payment_id: string | null } | null
    if (p?.metodo_pago === 'mp' && String(p.mp_payment_id ?? '').trim()) {
      await supabase.from('pedido_revisiones_duplicado').update({ reembolso_pendiente: true }).eq('id', rev.id).eq('reembolso_pendiente', false)
    }
  }
  if (rev.estado === 'LEGITIMO') await reanudarSiCorresponde(supabase, empresa_id, pedido_id)
}

// ───────────────────────── Reanudación del circuito tras LEGITIMO (condición A) ─────────────────────────
/**
 * Si el pedido es LEGITIMO, ya tiene un pago MP confirmado (mp_payment_id) y sigue en PENDING_PAYMENT, hace lo que el webhook habría hecho:
 * PREPARING + log de estados + facturación (los puntos, como en el webhook, se acreditan al entregar). UNA sola vez: se RECLAMA con un UPDATE condicional sobre reanudado_at (quien lo gana ejecuta,
 * el otro no hace nada). Si la transición falla después del reclamo, se suelta el reclamo para que se pueda reintentar.
 */
export async function reanudarSiCorresponde(supabase: Db, empresa_id: string, pedido_id: string, operador_id: string | null = null): Promise<'reanudado' | 'nada'> {
  const rev = await revisionDePedido(supabase, empresa_id, pedido_id)
  if (!rev || rev.estado !== 'LEGITIMO' || rev.reanudado_at) return 'nada'
  const { data: ped } = await supabase.from('pedidos').select('id, estado, metodo_pago, mp_payment_id').eq('id', pedido_id).eq('empresa_id', empresa_id).maybeSingle()
  const p = ped as { estado: string; metodo_pago: string | null; mp_payment_id: string | null } | null
  if (!p || p.estado !== 'PENDING_PAYMENT' || p.metodo_pago !== 'mp' || !String(p.mp_payment_id ?? '').trim()) return 'nada'

  const { data: gano } = await supabase.from('pedido_revisiones_duplicado').update({ reanudado_at: new Date().toISOString() }).eq('id', rev.id).is('reanudado_at', null).select('id')
  if (!Array.isArray(gano) || gano.length === 0) return 'nada'          // otro camino ya la reanudó
  const { data: pasó, error } = await supabase.from('pedidos').update({ estado: 'PREPARING', updated_at: new Date().toISOString() })
    .eq('id', pedido_id).eq('empresa_id', empresa_id).eq('estado', 'PENDING_PAYMENT').select('id')
  if (error || !Array.isArray(pasó) || pasó.length === 0) {
    await supabase.from('pedido_revisiones_duplicado').update({ reanudado_at: null }).eq('id', rev.id)
    console.error('[revision] no se pudo reanudar el pedido', pedido_id, error?.message)
    return 'nada'
  }
  await supabase.from('pedido_estados_log').insert({ pedido_id, operador_id, estado_anterior: 'PENDING_PAYMENT', estado_nuevo: 'PREPARING' })
  // Puntos: el webhook NO los acredita al confirmar el pago (se acreditan al ENTREGAR, por api/pedidos/estado, que es idempotente): la reanudación hace lo MISMO que el webhook.
  await facturarSiCorresponde(pedido_id)
  return 'reanudado'
}

// ───────────────────────── Devolución de stock al confirmar DUPLICADO (D2) ─────────────────────────
// (tipos planos, no uniones discriminadas: este proyecto compila sin strictNullChecks y ahí `if (!r.ok)` no estrecha la unión)
export interface ResultadoStock { ok: boolean; error?: string; revision?: boolean }
/**
 * Devuelve stock y sabores del pedido con las funciones EXISTENTES, con el mismo camino que /api/pedidos/eliminar (rama → devolver_stock_pedido_caja;
 * modelo producto → devolver_stock_pedido; sabores → devolver_sabores_pedido). Las tres son idempotentes en la base; encima se reclama
 * stock_devuelto_at para que un doble click o dos Lucis no llamen dos veces. Si algo falla se suelta el reclamo y se puede reintentar.
 * stock_descontado NULL/false = no hay nada que devolver (igual que /eliminar).
 */
export async function devolverStockDeRevision(supabase: Db, a: { empresa_id: string; pedido_id: string; dispositivo_id: string }): Promise<ResultadoStock> {
  const rev = await revisionDePedido(supabase, a.empresa_id, a.pedido_id)
  if (!rev || rev.estado !== 'DUPLICADO') return { ok: false, error: 'El pedido no está resuelto como duplicado.', revision: true }
  if (rev.stock_devuelto_at) return { ok: true }
  const { data: gano } = await supabase.from('pedido_revisiones_duplicado').update({ stock_devuelto_at: new Date().toISOString() }).eq('id', rev.id).is('stock_devuelto_at', null).select('id')
  if (!Array.isArray(gano) || gano.length === 0) return { ok: true }       // otro camino lo está devolviendo / ya lo devolvió
  const soltar = () => supabase.from('pedido_revisiones_duplicado').update({ stock_devuelto_at: null }).eq('id', rev.id)

  // Una excepción (corte de red, timeout) NO es éxito: se suelta el reclamo y se reintenta. Las tres funciones son idempotentes, así que si la base ya
  // había devuelto antes del corte, el reintento no devuelve dos veces (CTO 14/11: una respuesta ambigua nunca se interpreta como confirmación).
  try {
    const { data: ped } = await supabase.from('pedidos').select('id, empresa_id, stock_descontado').eq('id', a.pedido_id).eq('empresa_id', a.empresa_id).maybeSingle()
    if (!ped) { await soltar(); return { ok: false, error: 'Pedido no encontrado.' } }
    if ((ped as { stock_descontado: boolean | null }).stock_descontado === true) {
      const { count: movsRama, error: errRama } = await supabase.from('stock_movimientos').select('id', { count: 'exact', head: true }).eq('pedido_id', a.pedido_id).not('rama_id', 'is', null)
      if (errRama) { await soltar(); console.error('[revision] no se pudo leer el libro de stock', errRama.message); return { ok: false, error: 'No se pudo devolver el stock. Reintentá.' } }
      if ((movsRama ?? 0) > 0) {
        const { data: dev, error } = await supabase.rpc('devolver_stock_pedido_caja', { p_empresa: a.empresa_id, p_pedido: a.pedido_id, p_dispositivo: a.dispositivo_id })
        if (error) { await soltar(); console.error('[revision] devolver_stock_pedido_caja', error.message); return { ok: false, error: 'No se pudo devolver el stock. Reintentá.' } }
        const est = (dev as { estado?: string } | null)?.estado
        if (est !== 'devuelto' && est !== 'sin_efecto') { await soltar(); return { ok: false, error: 'El stock de este pedido requiere revisión manual: la base no lo movió.' } }
      } else {
        const { error } = await supabase.rpc('devolver_stock_pedido', { p_empresa_id: a.empresa_id, p_pedido_id: a.pedido_id })
        if (error) { await soltar(); console.error('[revision] devolver_stock_pedido', error.message); return { ok: false, error: 'No se pudo devolver el stock. Reintentá.' } }
      }
    }
    const { error: errSab } = await supabase.rpc('devolver_sabores_pedido', { p_empresa: a.empresa_id, p_pedido: a.pedido_id })
    if (errSab && errSab.code !== 'PGRST202' && errSab.code !== '42883') { await soltar(); console.error('[revision] devolver_sabores_pedido', errSab.message); return { ok: false, error: 'No se pudo devolver el stock de sabores. Reintentá.' } }
  } catch (e) {
    await soltar(); console.error('[revision] excepción al devolver stock (reclamo liberado, reintentar):', e)
    return { ok: false, error: 'No se pudo confirmar la devolución de stock. Reintentá.' }
  }
  return { ok: true }
}

// ───────────────────────── Resolución de Luci (orquestación) ─────────────────────────
export interface ResultadoResolucion { ok: boolean; status?: number; error?: string; codigo?: string; resolucion?: string; ya_resuelta?: boolean; reembolso_pendiente?: boolean; reanudado?: boolean }

/**
 * Resuelve la revisión y completa los efectos. IDEMPOTENTE y re-ejecutable: la decisión se toma una sola vez en la base (resolver_revision_duplicado
 * bajo FOR UPDATE); los efectos (devolver stock / reanudar) se reclaman uno a uno, así que si fallaron la primera vez, repetir la acción los completa
 * sin duplicar nada. Una decisión distinta de la ya tomada se rechaza (409): Luci no puede pasar de DUPLICADO a LEGITIMO ni al revés.
 */
export async function resolverRevision(supabase: Db, a: { empresa_id: string; pedido_id: string; resolucion: string; operador_id: string | null; dispositivo_id: string; nota?: string | null }): Promise<ResultadoResolucion> {
  if (a.resolucion !== 'LEGITIMO' && a.resolucion !== 'DUPLICADO') return { ok: false, status: 400, error: 'Resolución inválida.' }
  const { data, error } = await supabase.rpc('resolver_revision_duplicado', { p_empresa: a.empresa_id, p_pedido: a.pedido_id, p_resolucion: a.resolucion, p_operador: a.operador_id, p_nota: a.nota ?? null })
  if (error) { console.error('[revision] resolver_revision_duplicado', error.message); return { ok: false, status: 500, error: 'No se pudo resolver la revisión. Reintentá.' } }
  const r = data as { estado?: string; resolucion?: string; reembolso_pendiente?: boolean } | null
  if (r?.estado === 'PEDIDO_NO_ENCONTRADO') return { ok: false, status: 404, error: 'Pedido no encontrado.' }
  if (r?.estado === 'SIN_REVISION') return { ok: false, status: 409, error: 'El pedido no tiene una revisión de duplicado.', codigo: 'SIN_REVISION' }
  if (r?.estado === 'YA_RESUELTA_DISTINTA') return { ok: false, status: 409, error: `Este pedido ya fue resuelto como ${r.resolucion === 'DUPLICADO' ? 'DUPLICADO' : 'LEGÍTIMO'}.`, codigo: 'YA_RESUELTA', resolucion: r.resolucion }
  if (r?.estado !== 'RESUELTA' && r?.estado !== 'YA_RESUELTA') return { ok: false, status: 500, error: 'Respuesta inesperada de la base.' }
  const ya = r.estado === 'YA_RESUELTA'

  let reanudado = false
  if (a.resolucion === 'DUPLICADO') {
    const st = await devolverStockDeRevision(supabase, { empresa_id: a.empresa_id, pedido_id: a.pedido_id, dispositivo_id: a.dispositivo_id })
    if (!st.ok) return { ok: false, status: 500, error: `${st.error} La revisión quedó resuelta como duplicado: repetí la acción para completar la devolución.`, codigo: 'EFECTOS_PENDIENTES' }
    await cerrarCarrerasDePago(supabase, a.empresa_id, a.pedido_id)         // un pago MP que entró justo ahora → reembolso pendiente
  } else {
    reanudado = (await reanudarSiCorresponde(supabase, a.empresa_id, a.pedido_id, a.operador_id)) === 'reanudado'
  }
  const rev = await revisionDePedido(supabase, a.empresa_id, a.pedido_id)
  return { ok: true, resolucion: a.resolucion, ya_resuelta: ya, reembolso_pendiente: rev?.reembolso_pendiente === true, reanudado }
}

/** Luci marca que el reembolso en Mercado Pago ya se gestionó A MANO (D5). No mueve plata: solo deja constancia de quién y cuándo. Idempotente. */
export async function marcarReembolsoGestionado(supabase: Db, a: { empresa_id: string; pedido_id: string; operador_id: string | null }): Promise<{ ok: boolean; error?: string }> {
  const rev = await revisionDePedido(supabase, a.empresa_id, a.pedido_id)
  if (!rev || rev.estado !== 'DUPLICADO' || !rev.reembolso_pendiente) return { ok: false, error: 'Este pedido no tiene un reembolso pendiente.' }
  if (rev.reembolso_gestionado_at) return { ok: true }
  await supabase.from('pedido_revisiones_duplicado').update({ reembolso_gestionado_at: new Date().toISOString(), reembolso_gestionado_por: a.operador_id }).eq('id', rev.id).is('reembolso_gestionado_at', null)
  return { ok: true }
}

// ───────────────────────── Datos para la Vista Caja ─────────────────────────
export interface ItemComparable { nombre: string; presentacion: string | null; cantidad: number; opciones: string[] }
export interface LineaComparacion { clave: string; nombre: string; presentacion: string | null; opciones: string[]; nuevo: number; candidato: number; estado: 'igual' | 'distinto' | 'solo_nuevo' | 'solo_candidato' }

/** Compara dos pedidos con datos REALES (producto, presentación, sabores/opciones y cantidad). Función pura. */
export function compararPedidos(nuevo: ItemComparable[], candidato: ItemComparable[]): { lineas: LineaComparacion[]; identicos: boolean } {
  const clave = (i: ItemComparable) => [i.nombre, i.presentacion ?? '', [...i.opciones].sort().join(',')].join('|')
  const agrupar = (xs: ItemComparable[]) => { const m = new Map<string, { it: ItemComparable; q: number }>(); for (const i of xs) { const k = clave(i); const g = m.get(k); if (g) g.q += Number(i.cantidad); else m.set(k, { it: i, q: Number(i.cantidad) }) } return m }
  const n = agrupar(nuevo), c = agrupar(candidato)
  const lineas: LineaComparacion[] = []
  for (const k of new Set([...n.keys(), ...c.keys()])) {
    const a = n.get(k), b = c.get(k), it = (a ?? b)!.it
    const qn = a?.q ?? 0, qc = b?.q ?? 0
    lineas.push({ clave: k, nombre: it.nombre, presentacion: it.presentacion, opciones: [...it.opciones].sort(), nuevo: qn, candidato: qc, estado: !a ? 'solo_candidato' : !b ? 'solo_nuevo' : qn === qc ? 'igual' : 'distinto' })
  }
  lineas.sort((x, y) => x.nombre.localeCompare(y.nombre))
  return { lineas, identicos: lineas.every(l => l.estado === 'igual') }
}

type PedidoItemRow = { nombre_producto_snap?: string | null; nombre_presentacion_snap?: string | null; cantidad?: number | null; pedido_item_opciones?: { nombre_snap?: string | null }[] | null }
export const itemsComparables = (rows: PedidoItemRow[] | null | undefined): ItemComparable[] =>
  (rows ?? []).map(r => ({ nombre: String(r.nombre_producto_snap ?? '—'), presentacion: r.nombre_presentacion_snap ?? null, cantidad: Number(r.cantidad ?? 0), opciones: (r.pedido_item_opciones ?? []).map(o => String(o.nombre_snap ?? '')).filter(Boolean) }))

export interface CandidatoVista { desde_foto?: boolean; numero_pedido: number; created_at: string; estado: string; cliente: string | null; items: ItemComparable[]; comparacion: ReturnType<typeof compararPedidos> }
export interface RevisionVista {
  estado: 'PENDIENTE' | 'DUPLICADO'; coincidencia: 'IDENTICA' | 'DISTINTA'; creado_at: string; resuelto_at: string | null
  reembolso_pendiente: boolean; reembolso_gestionado_at: string | null; stock_devuelto: boolean; candidatos: CandidatoVista[]
}

const nombreCliente = (p: { nombre_cliente?: string | null; datos_delivery?: { nombre?: string } | null }) => p.nombre_cliente || p.datos_delivery?.nombre || null

/**
 * Para la lista de Caja: por cada pedido retenido (PENDIENTE / DUPLICADO) de la sucursal, sus candidatos con número, hora, estado, cliente y la comparación.
 * Solo se ve desde un dispositivo CAJA de la misma empresa y sucursal (el llamador ya lo validó): los candidatos se buscan con empresa + sucursal del dispositivo.
 * Falla en silencio hacia "sin revisiones" solo si el SQL no está aplicado; cualquier otro error se loguea y devuelve null (la UI no inventa estados).
 */
export async function revisionesParaCaja(supabase: Db, a: { empresa_id: string; sucursal_id: string; pedidos: { id: string; items: ItemComparable[] }[] }): Promise<Map<string, RevisionVista> | null> {
  const out = new Map<string, RevisionVista>()
  if (a.pedidos.length === 0) return out
  const ret = await pedidosRetenidos(supabase, a.empresa_id, a.pedidos.map(p => p.id))
  if (!ret.ok) return null
  if (ret.retenidos.size === 0) return out
  const ids = [...ret.retenidos.keys()]
  const { data: peds, error: e1 } = await supabase.from('pedidos').select('id, operacion_id').eq('empresa_id', a.empresa_id).in('id', ids)
  if (e1) { console.error('[revision] lectura de pedidos retenidos', e1.message); return null }
  const opDe = new Map<string, string>(((peds ?? []) as { id: string; operacion_id: string | null }[]).filter(p => p.operacion_id).map(p => [p.id, p.operacion_id as string]))
  const { data: revs, error: e2 } = await supabase.from('pedido_revisiones_duplicado').select(COLS_REV).eq('empresa_id', a.empresa_id).eq('sucursal_id', a.sucursal_id).in('operacion_id', [...opDe.values()])
  if (e2) { console.error('[revision] lectura de revisiones', e2.message); return null }
  const revDeOp = new Map<string, RevisionFila>(((revs ?? []) as RevisionFila[]).map(r => [r.operacion_id, r]))
  const opsCand = [...new Set([...revDeOp.values()].flatMap(r => r.candidatos ?? []))]
  const candPorOp = new Map<string, { numero_pedido: number; created_at: string; estado: string; nombre_cliente: string | null; datos_delivery: { nombre?: string } | null; pedido_items: PedidoItemRow[] }>()
  if (opsCand.length > 0) {
    const { data: cps, error: e3 } = await supabase.from('pedidos')
      .select('operacion_id, numero_pedido, created_at, estado, nombre_cliente, datos_delivery, pedido_items(nombre_producto_snap, nombre_presentacion_snap, cantidad, pedido_item_opciones(nombre_snap))')
      .eq('empresa_id', a.empresa_id).eq('sucursal_id', a.sucursal_id).in('operacion_id', opsCand)
    if (e3) { console.error('[revision] lectura de candidatos', e3.message); return null }
    for (const c of (cps ?? []) as { operacion_id: string; numero_pedido: number; created_at: string; estado: string; nombre_cliente: string | null; datos_delivery: { nombre?: string } | null; pedido_items: PedidoItemRow[] }[]) candPorOp.set(c.operacion_id, c)
  }
  for (const [pid, est] of ret.retenidos) {
    const op = opDe.get(pid); const rev = op ? revDeOp.get(op) : undefined
    if (!rev) continue                                                     // retenido pero de OTRA sucursal: la Caja no lo ve
    const mio = a.pedidos.find(p => p.id === pid)!
    const candidatos: CandidatoVista[] = (rev.candidatos ?? []).flatMap(o => {   // el orden de la base = mejor coincidencia primero
      const c = candPorOp.get(o)
      if (!c) {                                                            // el pedido candidato ya no existe (eliminado): se usa la FOTO tomada al detectar; sin foto, no se inventa
        const f = (rev.candidatos_snapshot ?? []).find(x => x?.operacion_id === o); if (!f) return []
        const items = (f.items ?? []).map(i => ({ nombre: String(i.nombre ?? '—'), presentacion: i.presentacion ?? null, cantidad: Number(i.cantidad ?? 0), opciones: (i.opciones ?? []).map(String) }) as ItemComparable)
        return [{ desde_foto: true, numero_pedido: f.numero_pedido, created_at: f.created_at, estado: f.estado, cliente: f.cliente ?? null, items, comparacion: compararPedidos(mio.items, items) }]
      }
      const items = itemsComparables(c.pedido_items)
      return [{ numero_pedido: c.numero_pedido, created_at: c.created_at, estado: c.estado, cliente: nombreCliente(c), items, comparacion: compararPedidos(mio.items, items) }]
    })
    out.set(pid, { estado: est, coincidencia: rev.coincidencia, creado_at: rev.creado_at, resuelto_at: rev.resuelto_at, reembolso_pendiente: rev.reembolso_pendiente, reembolso_gestionado_at: rev.reembolso_gestionado_at, stock_devuelto: !!rev.stock_devuelto_at, candidatos })
  }
  return out
}
