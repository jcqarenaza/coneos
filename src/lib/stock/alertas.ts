// Alertas de stock (header de la Caja y card «Stock por reponer» del dashboard): UNA sola definición, la misma que usa el catálogo
// (/api/kiosk/catalogo) para marcar AGOTADO:
//   · producto contable: SOLO filas con controla = true en esa sucursal, con cantidad <= stock_minimo (0 = agotado, >0 = bajo);
//   · producto en modelo 'rama': habilitación 'activa' en la sucursal; CADA presentación (subgrupo) con saldo < 1 se lista aparte
//     como «Producto · Presentación» (cantidad 0). El catálogo solo ofrece las presentaciones con saldo, así que una sin saldo ya no se vende.
// Antes se leía solo producto_stock sin mirar `controla`: contaba filas sin control y no veía los productos de rama (Bomboncitos).
// Lectura server-side (service_role): stock_rama y stock_rama_habilitacion no tienen policies para el panel.
import type { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

export type AlertaStock = { producto: string; sucursal_id: string; cantidad: number; stock_minimo: number }

type FilaStock = { cantidad: number | string; stock_minimo: number | string; controla: boolean | null; sucursal_id: string; productos: { nombre: string } | { nombre: string }[] | null }

export async function alertasStock(supabase: Db, empresaId: string, sucursalIds: string[]): Promise<AlertaStock[]> {
  if (sucursalIds.length === 0) return []
  const out: AlertaStock[] = []

  const { data: st, error: eSt } = await supabase.from('producto_stock')
    .select('cantidad, stock_minimo, controla, sucursal_id, productos(nombre)')
    .eq('empresa_id', empresaId).in('sucursal_id', sucursalIds)
  if (eSt) console.error('[alertas-stock] producto_stock', eSt.message)
  for (const r of ((st ?? []) as unknown as FilaStock[])) {
    if (r.controla !== true) continue
    if (Number(r.cantidad) > Number(r.stock_minimo)) continue
    const p = Array.isArray(r.productos) ? r.productos[0] : r.productos
    out.push({ producto: p?.nombre ?? '—', sucursal_id: r.sucursal_id, cantidad: Number(r.cantidad), stock_minimo: Number(r.stock_minimo) })
  }

  // Rama: falla abierta (igual que el catálogo): si no se puede leer, no se inventa nada.
  const { data: ramaProds, error: eRp } = await supabase.from('productos')
    .select('id, nombre').eq('empresa_id', empresaId).eq('activo', true).is('deleted_at', null)
    .eq('controla_stock', true).eq('modelo_stock', 'rama')
  if (eRp) { console.error('[alertas-stock] productos rama', eRp.message); return out }
  const prods = (ramaProds ?? []) as unknown as { id: string; nombre: string }[]
  if (prods.length === 0) return out
  const ids = prods.map(p => p.id)
  const [{ data: pres, error: ePr }, { data: hojas, error: eHo }, { data: habs, error: eHa }] = await Promise.all([
    supabase.from('presentaciones').select('id, producto_id, nombre').eq('empresa_id', empresaId).eq('activo', true).in('producto_id', ids),
    supabase.from('stock_rama').select('presentacion_id, sucursal_id, cantidad').eq('empresa_id', empresaId).in('sucursal_id', sucursalIds),
    supabase.from('stock_rama_habilitacion').select('producto_id, sucursal_id').eq('empresa_id', empresaId).eq('estado', 'activa').in('sucursal_id', sucursalIds).in('producto_id', ids),
  ])
  if (ePr || eHo || eHa) { console.error('[alertas-stock] rama', ePr?.message ?? eHo?.message ?? eHa?.message); return out }
  const presDe = new Map<string, { id: string; nombre: string }[]>()
  for (const r of ((pres ?? []) as unknown as { id: string; producto_id: string; nombre: string }[])) { const l = presDe.get(r.producto_id) ?? []; l.push({ id: r.id, nombre: r.nombre }); presDe.set(r.producto_id, l) }
  const saldo = new Map<string, number>()
  for (const h of ((hojas ?? []) as unknown as { presentacion_id: string; sucursal_id: string; cantidad: number | string }[])) saldo.set(`${h.sucursal_id}|${h.presentacion_id}`, Number(h.cantidad))
  const nombre = new Map(prods.map(p => [p.id, p.nombre]))
  for (const h of ((habs ?? []) as unknown as { producto_id: string; sucursal_id: string }[])) {
    for (const pr of presDe.get(h.producto_id) ?? []) {
      if ((saldo.get(`${h.sucursal_id}|${pr.id}`) ?? 0) >= 1) continue
      out.push({ producto: `${nombre.get(h.producto_id) ?? '—'} · ${pr.nombre}`, sucursal_id: h.sucursal_id, cantidad: 0, stock_minimo: 0 })
    }
  }
  return out
}
