import type { SupabaseClient } from '@supabase/supabase-js'

// CONFIRMACIÓN ADMINISTRATIVA DE UN ARQUEO DE STOCK (corrección R1, 21/10/2026).
//
// Defecto corregido: al reintentar una confirmación que había fallado a mitad de
// camino, los ítems que YA estaban ajustados (ajustado = true) volvían a aplicar su
// delta (doble movimiento de stock). Además los errores al marcar `ajustado` y al
// cerrar el arqueo se ignoraban.
//
// Reglas (la semántica del ajuste NO cambia: sigue siendo DELTA por ajustar_stock):
//   · se vuelve a leer el arqueo (estado e ítems frescos); no se confía en la pantalla
//   · si ya no está pendiente → no se hace nada
//   · se saltean ítems descartados, ya ajustados o con diferencia 0
//   · una diferencia no entera se rechaza ANTES de aplicar ningún ajuste
//   · un ítem se marca ajustado SOLO después de que ajustar_stock salió bien
//   · si el ajuste falla → se corta sin marcar
//   · si el ajuste salió bien pero no se pudo marcar → se corta y se avisa (no reintentar a ciegas)
//
// LÍMITE CONOCIDO: no hay "reserva" atómica del ítem. Dos confirmaciones SIMULTÁNEAS
// (dos pestañas / dos admins en el mismo instante) pueden leer el mismo ítem como no
// ajustado y duplicar. La re-lectura reduce la ventana, no la elimina; el cierre
// definitivo requiere una RPC transaccional (orden SQL aparte).

// (tipo plano, no unión discriminada: el proyecto compila sin strictNullChecks y ahí
// la unión no se estrecha por `ok`)
export interface ResultadoConfirmacion {
  ok: boolean
  ajustados?: number
  error?: string
  yaConfirmado?: boolean
}

interface ItemFresco {
  id: string
  producto_id: string
  diferencia: number | string | null
  ajustado: boolean | null
  descartado: boolean | null
}

export async function confirmarArqueoStock(
  sb: SupabaseClient,
  p: {
    empresaId: string
    arqueoId: string
    confirmadoPor: string
    nombreProducto: (productoId: string) => string
    formatFecha: (yyyyMmDd: string) => string
  },
): Promise<ResultadoConfirmacion> {
  // 1) Estado fresco
  const { data: arq, error: eLeer } = await sb.from('arqueos_stock')
    .select('id, sucursal_id, estado, observaciones, created_at, arqueo_items(id, producto_id, diferencia, ajustado, descartado)')
    .eq('id', p.arqueoId).eq('empresa_id', p.empresaId).maybeSingle()
  if (eLeer || !arq) return { ok: false, error: 'No se pudo leer el arqueo. Reintentá.' }
  if (arq.estado !== 'pendiente') {
    return { ok: false, yaConfirmado: true, error: 'Este arqueo ya fue confirmado. Se actualizó la lista.' }
  }

  // 2) Qué falta ajustar (excluye descartados, ya ajustados y diferencia 0)
  const items = ((arq.arqueo_items ?? []) as ItemFresco[])
  const pendientes = items.filter(it => !it.descartado && !it.ajustado && Number(it.diferencia ?? 0) !== 0)

  // 3) Validar TODO antes de tocar stock (ajustar_stock recibe enteros)
  for (const it of pendientes) {
    if (!Number.isInteger(Number(it.diferencia))) {
      return { ok: false, error: `La diferencia de ${p.nombreProducto(it.producto_id)} no es un número entero. Descartá ese ítem o corregilo antes de confirmar.` }
    }
  }

  // 4) Aplicar de a uno; marcar SOLO si el ajuste salió bien
  let ajustados = 0
  for (const it of pendientes) {
    const dif = Number(it.diferencia)
    const { error } = await sb.rpc('ajustar_stock', {
      p_empresa_id: p.empresaId, p_sucursal_id: arq.sucursal_id, p_producto_id: it.producto_id,
      p_valor: dif, p_modo: 'delta', p_motivo: 'arqueo',
      p_detalle: `Arqueo ${p.formatFecha(String(arq.created_at).slice(0, 10))} — dif ${dif > 0 ? '+' : ''}${it.diferencia}${arq.observaciones ? ' · ' + arq.observaciones : ''}`,
    })
    if (error) {
      return { ok: false, error: `Error ajustando ${p.nombreProducto(it.producto_id)}: ${error.message}. Los ítems anteriores quedaron ajustados y marcados; podés reintentar sin duplicarlos.` }
    }
    ajustados++

    let marca = await sb.from('arqueo_items').update({ ajustado: true }).eq('id', it.id)
    if (marca.error) marca = await sb.from('arqueo_items').update({ ajustado: true }).eq('id', it.id) // un reintento
    if (marca.error) {
      return { ok: false, error: `El ajuste de ${p.nombreProducto(it.producto_id)} SE APLICÓ pero no se pudo marcar como ajustado. NO reintentes la confirmación sin revisar el stock de ese producto.` }
    }
  }

  // 5) Cerrar el arqueo (solo si sigue pendiente)
  const { data: cerrado, error: eCerrar } = await sb.from('arqueos_stock')
    .update({ estado: 'confirmado', confirmado_por: p.confirmadoPor, confirmado_at: new Date().toISOString() })
    .eq('id', p.arqueoId).eq('empresa_id', p.empresaId).eq('estado', 'pendiente').select('id')
  if (eCerrar) {
    return { ok: false, error: 'Los ajustes se aplicaron pero no se pudo cerrar el arqueo. Reintentá la confirmación: los ítems ya ajustados no se repiten.' }
  }
  if (!cerrado || cerrado.length === 0) {
    return { ok: false, yaConfirmado: true, error: 'El arqueo ya había sido confirmado por otra operación. Se actualizó la lista.' }
  }
  return { ok: true, ajustados }
}
