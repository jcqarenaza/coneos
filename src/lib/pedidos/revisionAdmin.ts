// Admin: marcas EN REVISIÓN / DUPLICADO y exclusión de totales operativos (CTO 14/11, ajuste 1).
// Funciones puras + un fetch al endpoint de solo lectura. NO toca otros criterios de los reportes.
import { createClient } from '@/lib/supabase/client'

export type MarcaRevision = 'PENDIENTE' | 'DUPLICADO'
export type MapaRevisiones = Record<string, MarcaRevision>

export const ROTULO_REVISION: Record<MarcaRevision, string> = { PENDIENTE: 'EN REVISIÓN', DUPLICADO: 'DUPLICADO' }

/** Trae las marcas de revisión de estos pedidos. null = no se pudo verificar (el llamador NO debe asumir «sin revisión»). */
export async function traerRevisiones(ids: string[]): Promise<MapaRevisiones | null> {
  if (ids.length === 0) return {}
  try {
    const { data: { session } } = await createClient().auth.getSession()
    if (!session) return null
    const out: MapaRevisiones = {}
    for (let i = 0; i < ids.length; i += 1000) {
      const res = await fetch('/api/admin/pedidos-revision', {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_ids: ids.slice(i, i + 1000) }),
      })
      if (!res.ok) return null
      Object.assign(out, ((await res.json()) as { revisiones?: MapaRevisiones }).revisiones ?? {})
    }
    return out
  } catch { return null }
}

/** Saca de una lista los pedidos EN REVISIÓN o DUPLICADO. Sin mapa (null) no se excluye nada. */
export function sinRevision<T extends { id: string }>(filas: T[], mapa: MapaRevisiones | null): T[] {
  return mapa ? filas.filter(f => !mapa[f.id]) : filas
}
