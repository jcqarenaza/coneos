import type { SupabaseClient } from '@supabase/supabase-js'

// CONFIRMACIÓN ADMINISTRATIVA DE UN ARQUEO DE STOCK — PROPUESTA M0 (sin SQL nuevo).
//
// Toda la confirmación corre dentro de UNA llamada a la RPC transaccional que YA existe en
// producción: confirmar_arqueo_stock(p_empresa_id, p_arqueo_id, p_confirmado_por).
//   · lock de fila del arqueo → dos confirmaciones simultáneas se serializan; la 2ª ve 'confirmado'
//   · ítems bloqueados FOR UPDATE, orden por producto_id/id
//   · ajustes + marcas `ajustado` + cierre en la misma transacción: todo o nada
//   · reintento tras cualquier error = estado limpio (nada aplicado) o ya confirmado (ya_confirmado)
// Autorización en SQL: admin de la empresa (auth_empresa_id) o SUPER_ADMIN; anon sin EXECUTE.
// Límite: la diferencia es la del momento del conteo (fisico - teorico) y se aplica como DELTA al
// stock actual; ventas entre conteo y confirmación no se recalculan (decisión de producto aparte).

export interface ResultadoConfirmacion {
  ok: boolean
  ajustados?: number
  error?: string
  yaConfirmado?: boolean
}

const MENSAJES: Record<string, string> = {
  ARQUEO_NO_ENCONTRADO: 'No se encontró el arqueo. Se actualizó la lista.',
  // La RPC rechaza CUALQUIER estado ≠ pendiente (hoy el CHECK admite pendiente|confirmado|descartado). El error no dice cuál,
  // así que NO se afirma "ya confirmado": el estado real lo muestra la lista al recargar.
  ARQUEO_NO_PENDIENTE: 'Este arqueo ya no está pendiente (cambió de estado). Se actualizó la lista: revisá su estado.',
  DIFERENCIA_NO_ENTERA: 'Hay una diferencia que no es un número entero. Descartá ese ítem antes de confirmar.',
  FORBIDDEN: 'No tenés permiso para confirmar este arqueo.',
  USUARIO_SIN_PERMISO_STOCK: 'No tenés permiso de stock sobre esta sucursal.',
  USUARIO_NO_AUTORIZADO: 'No tenés permiso para confirmar este arqueo.',
  SALDO_NEGATIVO: 'Un ajuste dejaría un saldo negativo (se vendió stock después del conteo). No se aplicó nada: descartá ese ítem o recontá.',
  HOJA_SUCURSAL_NO_INICIALIZADA: 'La sucursal no tiene el stock por rama activado para un producto del arqueo. No se aplicó nada.',
  HOJA_NO_INICIALIZADA: 'Falta la hoja de stock de un producto del arqueo. No se aplicó nada.',
}

export async function confirmarArqueoStock(
  sb: SupabaseClient,
  p: {
    empresaId: string
    arqueoId: string
    confirmadoPor: string
    nombreProducto?: (productoId: string) => string   // ya no se usa; se conserva por compatibilidad con el llamador
    formatFecha?: (yyyyMmDd: string) => string        // ídem
  },
): Promise<ResultadoConfirmacion> {
  const { data, error } = await sb.rpc('confirmar_arqueo_stock', {
    p_empresa_id: p.empresaId, p_arqueo_id: p.arqueoId, p_confirmado_por: p.confirmadoPor,
  })
  if (error) {
    const clave = Object.keys(MENSAJES).find(k => (error.message ?? '').includes(k)) ?? (error.code === '42501' ? 'FORBIDDEN' : undefined)
    if (clave) return { ok: false, error: MENSAJES[clave] }
    // Error de red / 5xx / desconocido: el resultado es AMBIGUO (la transacción pudo haberse confirmado antes de cortarse
    // la respuesta). Reintentar es seguro: si ya se confirmó, la RPC responde ya_confirmado y no repite ajustes.
    return { ok: false, error: 'No se pudo confirmar el arqueo (error de conexión o del servidor). Reintentá: si ya se había confirmado, se mostrará como confirmado y no se repite ningún ajuste.' }
  }
  // Validación defensiva del contrato { ok: true, ya_confirmado: boolean, ajustados: entero >= 0 }.
  // Sin error pero con otra forma NO se informa éxito: el resultado es ambiguo (puede haberse confirmado). Reintentar es seguro.
  const r = data as { ok?: unknown; ya_confirmado?: unknown; ajustados?: unknown } | null
  const valido = !!r && typeof r === 'object' && !Array.isArray(r) && r.ok === true && typeof r.ya_confirmado === 'boolean'
    && typeof r.ajustados === 'number' && Number.isInteger(r.ajustados) && r.ajustados >= 0
  if (!valido) {
    return { ok: false, error: 'Respuesta inesperada del servidor al confirmar el arqueo. Recargá la lista para ver su estado; reintentar es seguro (si ya se confirmó no se repite ningún ajuste).' }
  }
  if (r.ya_confirmado) return { ok: false, yaConfirmado: true, error: 'Este arqueo ya fue confirmado. Se actualizó la lista.' }
  return { ok: true, ajustados: r.ajustados as number }
}
