// Pedidos repetidos + idempotencia por operación (GO CTO 8/11/2026). Lógica de SERVIDOR.
// La decisión (nuevo / reintento / repetido) la toma la función SQL reclamar_operacion_pedido, de forma atómica;
// acá solo se calcula la huella del contenido, se normaliza la identidad y se orquesta la respuesta.
import { createHash } from 'node:crypto'

export const MENSAJE_REPETIDO = 'Estás cargando un pedido igual al que realizaste hace unos minutos. ¿Querés generar otro pedido?'
// Aviso de posible duplicado (opción C, CTO 13/11; D1 del GO condicionado 14/11: ya no hay bloqueo duro, ni siquiera con contenido idéntico).
// Este texto lo ven también las pestañas viejas que no conocen `bloqueo` (solo leen `error`).
export const MENSAJE_PEDIDO_ACTIVO = '¡Atención! Este teléfono ya tiene un pedido en curso. Revisá que no estés cargando el mismo pedido nuevamente para evitar preparar dos veces lo mismo.'

/**
 * ALCANCE del bloqueo (CTO 13/11): SOLO delivery y take away ONLINE. Kiosco, caja (venta_caja) y mesas quedan fuera.
 * Función pura: la decisión de alcance vive en un único lugar y se prueba sola.
 */
export function esAlcanceBloqueo(a: { origen?: unknown; esMesa?: boolean; venta_caja?: boolean }): boolean {
  if (a.venta_caja || a.esMesa) return false
  const o = String(a.origen ?? '').toUpperCase()
  return o === 'DELIVERY' || o === 'TAKEAWAY'
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export interface ItemHuella {
  presentacion_id?: string | null; cantidad: number
  promo_id?: string | null; promo_slot_id?: string | null
  /** Identifica la INSTANCIA de un combo (uuid aleatorio del cliente): NUNCA entra crudo a la huella (cambiaría en cada intento);
   *  se usa para agrupar los componentes de cada instancia y representarla por su CONTENIDO. */
  combo_ref?: string | null
  opciones?: { opcion_id: string }[]
}

/**
 * Huella canónica del CONTENIDO COMERCIAL: sucursal, modalidad (tipo/origen/mesa) y, por línea, presentación +
 * promo/slot + opciones (ordenadas) con la cantidad total. No incluye importes (derivan de los ítems), notas,
 * método de pago ni horas. Dos carritos con el mismo contenido dan la misma huella aunque el orden o el
 * agrupamiento de las líneas sea distinto; cualquier cambio de cantidad, variante u opción la cambia.
 * COMBOS (revisión CTO 8/11): los componentes que comparten combo_ref forman UNA instancia, representada por la promoción y el
 * conjunto ordenado de (presentación|slot|opciones) de sus componentes. Así dos combos con las elecciones CRUZADAS
 * (pizza A + bebida X y pizza B + bebida Y, frente a A+Y y B+X) tienen huellas distintas, y el mismo carrito reabierto
 * (combo_ref nuevo) conserva la misma huella.
 */
export function calcularHuella(p: { sucursal_id: string; tipo_pedido?: string | null; origen?: string | null; numero_mesa?: number | string | null; items: ItemHuella[] }): string {
  const lineas = new Map<string, number>()
  const combos = new Map<string, { promo: string; comps: string[] }>()
  const claveDe = (it: ItemHuella) => {
    const ops = (it.opciones ?? []).map(o => String(o.opcion_id)).sort().join(',')
    return [it.presentacion_id ?? '', it.promo_id ?? '', it.promo_slot_id ?? '', ops].join('|')
  }
  for (const it of p.items) {
    if (it.combo_ref) {
      const g = combos.get(String(it.combo_ref)) ?? { promo: String(it.promo_id ?? ''), comps: [] }
      g.comps.push(`${claveDe(it)}x${Number(it.cantidad)}`)
      combos.set(String(it.combo_ref), g)
    } else {
      const clave = claveDe(it)
      lineas.set(clave, (lineas.get(clave) ?? 0) + Number(it.cantidad))
    }
  }
  const instancias = [...combos.values()].map(g => `C(${g.promo}:${g.comps.sort().join(',')})`)
  const cuerpo = [...[...lineas.entries()].map(([k, q]) => `${k}x${q}`), ...instancias].sort().join(';')
  const modalidad = [p.tipo_pedido ?? '', p.origen ?? '', p.numero_mesa == null ? '' : String(Number(p.numero_mesa))].join('/')
  return createHash('sha256').update(`${p.sucursal_id}#${modalidad}#${cuerpo}`).digest('hex')
}

/**
 * Rechazos de crear_pedido_stock cuyo ROLLBACK está demostrado y que implican AUSENCIA de pedido: cada uno es un
 * `RAISE EXCEPTION ... USING errcode='P0001'` de la propia función, que aborta TODA la transacción (descuento, numeración,
 * pedido, ítems y libro). Esta lista debe coincidir EXACTAMENTE con los RAISE de la función viva versionada
 * (supabase/versionado/crear_pedido_stock.vivo-2026-11-17.sql; hay una prueba que lo verifica leyendo el archivo SQL) y cada
 * código se prueba contra la base (prueba_sql.py, grupo E): sin pedido, sin stock descontado, sin libro y con la operación
 * reclamable de nuevo. SUCURSAL_PENDIENTE_ACTIVACION y HOJA_NO_INICIALIZADA (stock por rama) se prueban en el bloque E-RAMA
 * contra la crear_pedido_stock v1.9 REAL (migración stock-control-por-sucursal.sql); HOJA_NO_INICIALIZADA, además, DESPUÉS de una
 * escritura previa efectiva (descuento de otra hoja en la misma llamada), que también queda revertida.
 */
export const ERRORES_CREAR_CON_ROLLBACK_DEMOSTRADO = [
  'SUCURSAL_INVALIDA', 'PRESENTACION_INVALIDA', 'PROMO_COMPONENTE_INVALIDO', 'PROMO_INVALIDA', 'PROMO_VENCIDA',
  'PROMO_SLOTS_INVALIDOS', 'PROMO_PRESENTACION_NO_PERMITIDA', 'PROMO_PRECIO_INVALIDO', 'OPCION_INVALIDA',
  'PRECIO_INVALIDO', 'FACTOR_STOCK_INVALIDO', 'SIN_STOCK', 'SUCURSAL_PENDIENTE_ACTIVACION', 'HOJA_NO_INICIALIZADA',
] as const
/** Además: deadlock_detected (40P01). PostgreSQL elige una víctima y ABORTA su transacción por completo antes de responder
 *  (probado con un deadlock real en prueba_sql.py). */
export const SQLSTATE_ROLLBACK_DEMOSTRADO = ['40P01'] as const

/**
 * ¿El error devuelto por crear_pedido_stock PRUEBA que la transacción hizo rollback (no se creó pedido)?
 * LISTA EXPLÍCITA (revisión CTO 8/11): solo (a) code P0001 con un mensaje de ERRORES_CREAR_CON_ROLLBACK_DEMOSTRADO o
 * (b) un SQLSTATE de SQLSTATE_ROLLBACK_DEMOSTRADO. TODO lo demás conserva la operación: errores sin código (transporte, timeout,
 * gateway), 23505 (puede ser el índice de operacion_id: el pedido YA existe), clases 08/57P/40003, cualquier otro SQLSTATE o
 * mensaje desconocido. Conservar la operación es siempre seguro: el reintento recupera el pedido por pedidos.operacion_id.
 */
export function errorProbadoSinPedido(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  if ((SQLSTATE_ROLLBACK_DEMOSTRADO as readonly string[]).includes(code)) return true
  if (code !== 'P0001') return false
  const nombre = String(error.message ?? '').split(/[:\n]/)[0].trim()
  return (ERRORES_CREAR_CON_ROLLBACK_DEMOSTRADO as readonly string[]).includes(nombre)
}

export const soloDigitos = (v: unknown): string | null => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 6 ? d : null }

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
/**
 * PRIVACIDAD (CTO 14/11): en modo bloqueo la coincidencia de TELÉFONO detecta el pedido activo pero no autoriza a verlo. El pedido
 * (id = llave pública del seguimiento, número y estado) solo viaja si es del MISMO VISITANTE; si no, los tres quedan en null y
 * `mismo_visitante` en false. Se vuelve a imponer acá aunque la base ya lo filtre (defensa en profundidad).
 */
export type ExistenteBloqueo = { mismo_visitante: boolean; pedido_id: string | null; numero_pedido: number | null; estado: string | null }
type ExistenteCrudo = { mismo_visitante?: boolean; pedido_id?: string | null; numero_pedido?: number | null; estado?: string | null }
export function existenteBloqueo(e: ExistenteCrudo | null | undefined): ExistenteBloqueo {
  if (e?.mismo_visitante !== true) return { mismo_visitante: false, pedido_id: null, numero_pedido: null, estado: null }
  return { mismo_visitante: true, pedido_id: e.pedido_id ?? null, numero_pedido: e.numero_pedido ?? null, estado: e.estado ?? null }
}
export type Reclamo =
  | { tipo: 'NUEVA' }
  | { tipo: 'EXISTENTE'; pedido_id: string | null }
  | { tipo: 'DUPLICADO'; ventana_minutos: number; existente: { pedido_id: string | null; numero_pedido: number | null; estado: string | null } }
  | { tipo: 'PEDIDO_ACTIVO'; ventana_horas: number; coincidencia: 'IDENTICA' | 'DISTINTA'; existente: ExistenteBloqueo }   // modo bloqueo: aviso; sigue con la excepción explícita (queda en revisión en Caja)
  | { tipo: 'EN_PROCESO' }
  | { tipo: 'OPERACION_INVALIDA' }
  | { tipo: 'SIN_PROTECCION' }          // la base no respondió (p. ej. SQL aún no aplicado): FAIL-CLOSED, el endpoint NO crea el pedido sin protección (503 recuperable)

export async function reclamarOperacion(
  supabase: RpcClient,
  a: { empresa_id: string; sucursal_id: string; operacion_id: string; huella: string; telefono: string | null; visitante: string | null; dispositivo_id: string | null; confirmar: boolean;
       /** Presente SOLO si el pedido está en alcance (delivery/take away online) Y la empresa tiene la llave prendida. Ausente = llamada histórica de 8 parámetros. */
       bloqueo?: { confirmar_otro: boolean } },
  opts: { esperaMs?: number; intentos?: number; dormir?: (ms: number) => Promise<void> } = {},
): Promise<Reclamo> {
  const dormir = opts.dormir ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const intentos = opts.intentos ?? 25, esperaMs = opts.esperaMs ?? 400
  for (let i = 0; i <= intentos; i++) {
    let r: { estado?: string; pedido_id?: string | null; ventana_minutos?: number; ventana_horas?: number; coincidencia?: string; existente?: ExistenteCrudo } | null = null
    try {
      const { data, error } = await supabase.rpc('reclamar_operacion_pedido', {
        p_empresa_id: a.empresa_id, p_sucursal_id: a.sucursal_id, p_operacion_id: a.operacion_id, p_huella: a.huella,
        p_telefono: a.telefono, p_visitante: a.visitante, p_dispositivo_id: a.dispositivo_id, p_confirmar: a.confirmar,
        // Los dos parámetros nuevos viajan SOLO en modo bloqueo: sin la llave (o fuera de alcance) la llamada es idéntica a la histórica,
        // así el código nuevo convive con la base vieja (la función de 8 parámetros no conoce estos nombres).
        ...(a.bloqueo ? { p_alcance_bloqueo: true, p_confirmar_otro: a.bloqueo.confirmar_otro === true } : {}),
      })
      if (error) { console.error('[pedidos] reclamar_operacion_pedido falló (el endpoint responde 503 y NO crea el pedido):', error.message); return { tipo: 'SIN_PROTECCION' } }
      r = data as typeof r
    } catch (e) { console.error('[pedidos] reclamar_operacion_pedido excepción (el endpoint responde 503 y NO crea el pedido):', e); return { tipo: 'SIN_PROTECCION' } }
    switch (r?.estado) {
      case 'NUEVA': return { tipo: 'NUEVA' }
      case 'EXISTENTE': return { tipo: 'EXISTENTE', pedido_id: r.pedido_id ?? null }
      case 'OPERACION_INVALIDA': return { tipo: 'OPERACION_INVALIDA' }
      case 'DUPLICADO': return { tipo: 'DUPLICADO', ventana_minutos: Number(r.ventana_minutos ?? 0), existente: { pedido_id: r.existente?.pedido_id ?? null, numero_pedido: r.existente?.numero_pedido ?? null, estado: r.existente?.estado ?? null } }
      case 'PEDIDO_ACTIVO': return { tipo: 'PEDIDO_ACTIVO', ventana_horas: Number(r.ventana_horas ?? 0), coincidencia: r.coincidencia === 'IDENTICA' ? 'IDENTICA' : 'DISTINTA', existente: existenteBloqueo(r.existente) }
      case 'EN_CURSO': if (i < intentos) { await dormir(esperaMs); continue } return { tipo: 'EN_PROCESO' }
      default: console.error('[pedidos] estado de operación desconocido (el endpoint responde 503 y NO crea el pedido):', r); return { tipo: 'SIN_PROTECCION' }
    }
  }
  return { tipo: 'EN_PROCESO' }
}

type LlaveClient = { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> } } } }
/**
 * ¿La empresa tiene prendida la llave de bloqueo de duplicados? Ante CUALQUIER problema de lectura (columna inexistente porque el SQL
 * todavía no se aplicó, error de red, fila ausente) devuelve false = comportamiento anterior (advertencia con "Sí, continuar"), que
 * sigue siendo fail-closed por reclamar_operacion_pedido. Así el código se puede desplegar ANTES o DESPUÉS del SQL.
 */
export async function leerLlaveBloqueo(supabase: LlaveClient, empresa_id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('empresa_config').select('bloquear_pedidos_duplicados').eq('empresa_id', empresa_id).maybeSingle()
    if (error) { console.warn('[pedidos] llave de bloqueo no disponible (se usa el comportamiento anterior):', error.message); return false }
    return (data as { bloquear_pedidos_duplicados?: boolean } | null)?.bloquear_pedidos_duplicados === true
  } catch (e) { console.warn('[pedidos] llave de bloqueo: excepción (se usa el comportamiento anterior):', e); return false }
}
