// Pedidos repetidos + idempotencia por operación (GO CTO 8/11/2026). Lógica de SERVIDOR.
// La decisión (nuevo / reintento / repetido) la toma la función SQL reclamar_operacion_pedido, de forma atómica;
// acá solo se calcula la huella del contenido, se normaliza la identidad y se orquesta la respuesta.
import { createHash } from 'node:crypto'

export const MENSAJE_REPETIDO = 'Estás cargando un pedido igual al que realizaste hace unos minutos. ¿Querés generar otro pedido?'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export interface ItemHuella {
  presentacion_id?: string | null; cantidad: number
  promo_id?: string | null; promo_slot_id?: string | null
  opciones?: { opcion_id: string }[]
}

/**
 * Huella canónica del CONTENIDO COMERCIAL: sucursal, modalidad (tipo/origen/mesa) y, por línea, presentación +
 * promo/slot + opciones (ordenadas) con la cantidad total. No incluye importes (derivan de los ítems), notas,
 * método de pago ni horas. Dos carritos con el mismo contenido dan la misma huella aunque el orden o el
 * agrupamiento de las líneas sea distinto; cualquier cambio de cantidad, variante u opción la cambia.
 */
export function calcularHuella(p: { sucursal_id: string; tipo_pedido?: string | null; origen?: string | null; numero_mesa?: number | string | null; items: ItemHuella[] }): string {
  const lineas = new Map<string, number>()
  for (const it of p.items) {
    const ops = (it.opciones ?? []).map(o => String(o.opcion_id)).sort().join(',')
    const clave = [it.presentacion_id ?? '', it.promo_id ?? '', it.promo_slot_id ?? '', ops].join('|')
    lineas.set(clave, (lineas.get(clave) ?? 0) + Number(it.cantidad))
  }
  const cuerpo = [...lineas.entries()].map(([k, q]) => `${k}x${q}`).sort().join(';')
  const modalidad = [p.tipo_pedido ?? '', p.origen ?? '', p.numero_mesa == null ? '' : String(Number(p.numero_mesa))].join('/')
  return createHash('sha256').update(`${p.sucursal_id}#${modalidad}#${cuerpo}`).digest('hex')
}

export const soloDigitos = (v: unknown): string | null => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 6 ? d : null }

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
export type Reclamo =
  | { tipo: 'NUEVA' }
  | { tipo: 'EXISTENTE'; pedido_id: string | null }
  | { tipo: 'DUPLICADO'; ventana_minutos: number; existente: { pedido_id: string | null; numero_pedido: number | null; estado: string | null } }
  | { tipo: 'EN_PROCESO' }
  | { tipo: 'OPERACION_INVALIDA' }
  | { tipo: 'SIN_PROTECCION' }          // la base no respondió (p. ej. SQL aún no aplicado): se sigue SIN protección, jamás se frena una venta

export async function reclamarOperacion(
  supabase: RpcClient,
  a: { empresa_id: string; sucursal_id: string; operacion_id: string; huella: string; telefono: string | null; visitante: string | null; dispositivo_id: string | null; confirmar: boolean },
  opts: { esperaMs?: number; intentos?: number; dormir?: (ms: number) => Promise<void> } = {},
): Promise<Reclamo> {
  const dormir = opts.dormir ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const intentos = opts.intentos ?? 25, esperaMs = opts.esperaMs ?? 400
  for (let i = 0; i <= intentos; i++) {
    let r: { estado?: string; pedido_id?: string | null; ventana_minutos?: number; existente?: { pedido_id?: string | null; numero_pedido?: number | null; estado?: string | null } } | null = null
    try {
      const { data, error } = await supabase.rpc('reclamar_operacion_pedido', {
        p_empresa_id: a.empresa_id, p_sucursal_id: a.sucursal_id, p_operacion_id: a.operacion_id, p_huella: a.huella,
        p_telefono: a.telefono, p_visitante: a.visitante, p_dispositivo_id: a.dispositivo_id, p_confirmar: a.confirmar,
      })
      if (error) { console.error('[pedidos] reclamar_operacion_pedido falló (se sigue SIN protección):', error.message); return { tipo: 'SIN_PROTECCION' } }
      r = data as typeof r
    } catch (e) { console.error('[pedidos] reclamar_operacion_pedido excepción (se sigue SIN protección):', e); return { tipo: 'SIN_PROTECCION' } }
    switch (r?.estado) {
      case 'NUEVA': return { tipo: 'NUEVA' }
      case 'EXISTENTE': return { tipo: 'EXISTENTE', pedido_id: r.pedido_id ?? null }
      case 'OPERACION_INVALIDA': return { tipo: 'OPERACION_INVALIDA' }
      case 'DUPLICADO': return { tipo: 'DUPLICADO', ventana_minutos: Number(r.ventana_minutos ?? 0), existente: { pedido_id: r.existente?.pedido_id ?? null, numero_pedido: r.existente?.numero_pedido ?? null, estado: r.existente?.estado ?? null } }
      case 'EN_CURSO': if (i < intentos) { await dormir(esperaMs); continue } return { tipo: 'EN_PROCESO' }
      default: console.error('[pedidos] estado de operación desconocido (se sigue SIN protección):', r); return { tipo: 'SIN_PROTECCION' }
    }
  }
  return { tipo: 'EN_PROCESO' }
}
