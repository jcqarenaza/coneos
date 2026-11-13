import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  const sucursal_id = searchParams.get('sucursal_id')
  // CANAL (GO CTO 03/10): el servidor decide qué devolver; el cliente solo
  // dice quién es. Default 'kiosk' = comportamiento histórico intacto.
  const CANALES = ['kiosk', 'delivery', 'mesa', 'takeaway', 'operacion'] as const
  const canal = (searchParams.get('canal') ?? 'kiosk') as (typeof CANALES)[number]

  if (!empresa_id || !sucursal_id) {
    return NextResponse.json({ error: 'Parámetros requeridos' }, { status: 400 })
  }
  if (!CANALES.includes(canal)) {
    return NextResponse.json({ error: `Canal inválido: ${canal}` }, { status: 400 })
  }
  // PRODUCTO · ¿en qué canales existe? 'operacion' = caja: SIN filtro de canal
  // (caja no es una vidriera). Presentación/opción: visible_kiosk sigue siendo
  // EL ojito único del catálogo para todos, caja incluida (semántica histórica).
  const colCanal: Record<string, string | null> = {
    kiosk: 'visible_kiosk', delivery: 'visible_delivery', mesa: 'visible_mesa',
    takeaway: 'visible_takeaway', operacion: null,
  }

  const supabase = createAdminClient()

  const [{ data: categorias }, { data: productos }, { data: presentaciones }, { data: grupos }, { data: opciones }, { data: inventario }, { data: presGrupos }, { data: catalogoConfig }, { data: stockRows }] =
    await Promise.all([
      supabase.from('categorias').select('id, nombre, icono_url, orden').eq('empresa_id', empresa_id).eq('activo', true).is('deleted_at', null).order('orden'),
      (() => { let q = supabase.from('productos').select('id, nombre, descripcion, imagen_url, categoria_id, orden, controla_stock, modelo_stock, visible_delivery').eq('empresa_id', empresa_id).eq('activo', true).is('deleted_at', null); const col = colCanal[canal]; if (col) q = q.eq(col, true); return q.order('orden') })(),
      supabase.from('presentaciones').select('id, nombre, precio, permite_opciones, opciones_min, opciones_max, orden, producto_id, imagen_url, es_novedad').eq('empresa_id', empresa_id).eq('activo', true).eq('visible_kiosk', true).order('orden'),
      supabase.from('grupos_opciones').select('id, nombre, orden').eq('empresa_id', empresa_id).eq('activo', true).order('orden'),
      supabase.from('opciones').select('id, nombre, descripcion, emoji, color, imagen_url, grupo_id, orden, precio_adicional, es_novedad').eq('empresa_id', empresa_id).eq('activo', true).eq('visible_kiosk', true).is('deleted_at', null).order('orden'),
      supabase.from('inventario_opciones').select('opcion_id, disponible').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id),
      supabase.from('presentacion_grupos').select('presentacion_id, grupo_id'),
      supabase.from('sucursal_catalogo_config').select('entidad_id, entidad_tipo, disponible').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id),
      supabase.from('producto_stock').select('producto_id, cantidad').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id),
    ])

  // Toggle por empresa (default OFF = ocultar, comportamiento histórico)
  const { data: cfgAgotados } = await supabase.from('empresa_config').select('mostrar_agotados').eq('empresa_id', empresa_id).maybeSingle()
  const mostrarAgotados = cfgAgotados?.mostrar_agotados === true

  // Mapa de disponibilidad por sucursal
  const dispoMap: Record<string, boolean> = {}
  ;(catalogoConfig ?? []).forEach((r: { entidad_id: string; disponible: boolean }) => { dispoMap[r.entidad_id] = r.disponible })

  // Filtrar productos y presentaciones no disponibles en esta sucursal.
  // STOCK: producto contable (controla_stock) con cantidad 0 — o sin fila de
  // stock para esta sucursal — se marca AGOTADO (misma regla que la RPC al
  // vender: sin fila = sin stock). Un solo punto para los 4 canales.
  const stockMap: Record<string, number> = {}
  ;(stockRows ?? []).forEach((s: { producto_id: string; cantidad: number }) => { stockMap[s.producto_id] = s.cantidad })

  // ══ STOCK POR RAMA (GO CTO 13/11, defecto D1) ══
  // Un producto en modelo 'rama' NO guarda su existencia en producto_stock sino en
  // stock_rama (una hoja por sucursal × presentación). Misma regla que la RPC al vender
  // (crear_pedido_stock v1.8): el producto debe tener habilitación 'activa' en la sucursal y
  // cada presentación necesita su hoja con saldo (sin hoja o saldo 0 = no se puede vender).
  //  · Producto rama con alguna presentación vendible → aparece, y solo con esas presentaciones.
  //  · Producto rama sin ninguna presentación vendible → AGOTADO (respeta mostrar_agotados).
  // Falla abierta: si no se pueden leer las hojas, el producto se trata como antes (la RPC protege la venta).
  const ramaProdIds = ((productos ?? []) as { id: string; controla_stock?: boolean; modelo_stock?: string | null }[])
    .filter(p => p.controla_stock === true && p.modelo_stock === 'rama').map(p => p.id)
  const saldoRama: Record<string, number> = {}
  const ramaConStock = new Set<string>()   // productos rama con al menos una presentación vendible
  const ramaControlada = new Set<string>() // productos rama cuya existencia se pudo leer
  if (ramaProdIds.length > 0) {
    const [{ data: hojas, error: eHojas }, { data: habs, error: eHabs }] = await Promise.all([
      supabase.from('stock_rama').select('presentacion_id, cantidad').eq('empresa_id', empresa_id).eq('sucursal_id', sucursal_id),
      supabase.from('stock_rama_habilitacion').select('producto_id').eq('empresa_id', empresa_id).eq('sucursal_id', sucursal_id).eq('estado', 'activa').in('producto_id', ramaProdIds),
    ])
    if (!eHojas && !eHabs) {
      ;(hojas ?? []).forEach((h: { presentacion_id: string; cantidad: number | string }) => { saldoRama[h.presentacion_id] = Number(h.cantidad) })
      const habilitados = new Set((habs ?? []).map((h: { producto_id: string }) => h.producto_id))
      ramaProdIds.forEach(id => {
        ramaControlada.add(id)
        if (habilitados.has(id) && (presentaciones ?? []).some((pr: { id: string; producto_id: string }) => pr.producto_id === id && saldoRama[pr.id] >= 1)) ramaConStock.add(id)
      })
    }
  }
  const sinStock = (p: { id: string; controla_stock?: boolean }) =>
    ramaControlada.has(p.id) ? !ramaConStock.has(p.id) : p.controla_stock === true && !(stockMap[p.id] > 0)

  // ── AGOTADO VISIBLE (orden CTO 19/09): el sin-stock ya NO se oculta ──
  // El producto sigue en el catálogo con flag `agotado: true`; el cliente lo
  // muestra diferenciado y bloquea la selección. La lógica de descuento de
  // stock NO se toca: este flag es solo exposición. controla_stock sigue sin
  // viajar al cliente.
  const conFlag = (productos ?? [])
    .filter((p: { id: string }) => dispoMap[p.id] !== false)
    .map(({ controla_stock: _cs, modelo_stock: _ms, ...p }: { id: string; controla_stock?: boolean; modelo_stock?: string | null }) => ({ ...p, agotado: sinStock({ id: p.id, controla_stock: _cs }) }))
  // Toggle OFF → poda como siempre (producto y sus presentaciones fuera).
  // Toggle ON → viajan con el flag y el kiosk los muestra griseados.
  const agotadosSet = new Set(conFlag.filter((p: { id: string; agotado: boolean }) => p.agotado).map((p: { id: string }) => p.id))
  const productosFiltrados = mostrarAgotados ? conFlag : conFlag.filter((p: { id: string; agotado: boolean }) => !p.agotado)
  // Producto rama con stock: la presentación sin saldo no se ofrece (el cliente no tiene flag por presentación).
  const presentacionesFiltradas = (presentaciones ?? []).filter((p: { id: string; producto_id: string }) =>
    dispoMap[p.id] !== false && (mostrarAgotados || !agotadosSet.has(p.producto_id))
    && !(ramaConStock.has(p.producto_id) && !(saldoRama[p.id] >= 1)))

  // ── MICRO-FIX (orden CTO 18/09): PODA DE PADRES ──
  // Un producto sin NINGUNA presentación visible no se lista (antes quedaba
  // la card vacía). Filtrar presentaciones → ¿quedó alguna? → si no, fuera.
  //
  // SEMÁNTICA DOCUMENTADA (CTO): visible_kiosk controla EXPOSICIÓN en el
  // catálogo público. NO constituye regla de disponibilidad ni autorización
  // de venta: algo oculto de la vidriera sigue siendo vendible por un flujo
  // ya iniciado (carrito pre-armado). Para impedir nuevas ventas se usan
  // `activo` y las reglas de stock. No mezclar los conceptos.
  const productosConPresentacion = new Set(presentacionesFiltradas.map((p: { producto_id: string }) => p.producto_id))
  const productosFinal = productosFiltrados.filter((p: { id: string }) => productosConPresentacion.has(p.id))

  // Filtrar opciones por inventario_opciones (sabores sin stock)
  const inventarioMap: Record<string, boolean> = {}
  ;(inventario ?? []).forEach((i: { opcion_id: string; disponible: boolean }) => { inventarioMap[i.opcion_id] = i.disponible })
  // SABORES POR KILO: sabor con fila de stock en esta sucursal y 0 kg = AGOTADO.
  // Viaja con flag (el cliente lo muestra y bloquea). Sin fila = no se controla.
  const sinKg = new Set<string>()
  {
    const { data: kgRows, error: kgErr } = await supabase.from('stock_sabor').select('opcion_id, kg').eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id)
    if (!kgErr) (kgRows ?? []).forEach((r: { opcion_id: string; kg: number | string }) => { if (Number(r.kg) <= 0) sinKg.add(r.opcion_id) })
  }
  const opcionesFiltradas = (opciones ?? [])
    .filter((op: { id: string }) => inventarioMap[op.id] !== false)
    .map((op: { id: string }) => (sinKg.has(op.id) ? { ...op, agotado: true } : op))

  // ══ PROMOCIONES V1 — E1-C (GO CTO 11/10): promos VIGENTES del canal ══
  // Vigencia por fecha de SERVER (hora argentina, la misma del RPC). Solo
  // viajan promos cuyos slots tienen TODAS sus presentaciones visibles en
  // este catálogo (si una variedad está oculta/agotada-podada, la promo no
  // se ofrece a medias). Campo nuevo: los clientes viejos lo ignoran.
  const hoyArg = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const colPromo: Record<string, string | null> = {
    kiosk: 'visible_kiosk', delivery: 'visible_delivery', mesa: 'visible_mesa',
    takeaway: 'visible_takeaway', operacion: null,
  }
  let qPromo = supabase.from('promociones')
    .select('id, nombre, descripcion, imagen_url, precio, precio_regular, es_novedad, visible_delivery, vigencia_desde, vigencia_hasta, promo_slots(id, orden, titulo, cantidad, promo_slot_presentaciones(presentacion_id))')
    .eq('empresa_id', empresa_id).eq('activo', true)
  const colP = colPromo[canal]
  if (colP) qPromo = qPromo.eq(colP, true)
  const { data: promosRaw } = await qPromo
  const presVisibles = new Set(presentacionesFiltradas.map((p: { id: string }) => p.id))
  type SlotRaw = { id: string; orden: number; titulo: string; cantidad?: number | null; promo_slot_presentaciones: { presentacion_id: string }[] }
  const promociones = (promosRaw ?? [])
    .filter((pr: { vigencia_desde?: string | null; vigencia_hasta?: string | null } & Record<string, unknown>) => true)
    .map((pr: Record<string, unknown>) => ({
      id: pr.id, nombre: pr.nombre, descripcion: pr.descripcion, imagen_url: pr.imagen_url,
      precio: Number(pr.precio), precio_regular: pr.precio_regular != null ? Number(pr.precio_regular) : null,
      es_novedad: pr.es_novedad === true,
      visible_delivery: pr.visible_delivery !== false,
      vigencia_desde: (pr as { vigencia_desde?: string | null }).vigencia_desde ?? null,
      vigencia_hasta: (pr as { vigencia_hasta?: string | null }).vigencia_hasta ?? null,
      slots: ((pr.promo_slots ?? []) as SlotRaw[])
        .sort((a, b) => a.orden - b.orden)
        .map(s => ({ id: s.id, orden: s.orden, titulo: s.titulo, cantidad: Math.max(1, Number(s.cantidad ?? 1)),
          presentaciones: s.promo_slot_presentaciones.map(x => x.presentacion_id).filter(id => presVisibles.has(id)) })),
    }))
    .filter(pr => {
      const desdeOk = !pr.vigencia_desde || hoyArg >= pr.vigencia_desde
      const hastaOk = !pr.vigencia_hasta || hoyArg <= pr.vigencia_hasta
      const slotsOk = pr.slots.length > 0 && pr.slots.every(s => s.presentaciones.length > 0)
      return desdeOk && hastaOk && slotsOk
    })

  // Categorías vacías en la vidriera (JC 12/11): si en este canal/sucursal no queda
  // ningún producto visible en una categoría, la categoría tampoco se muestra.
  // La caja ('operacion') conserva la lista completa.
  const categoriasFinal = canal === 'operacion'
    ? categorias
    : (categorias ?? []).filter((c: { id: string }) => (productosFinal as unknown as { categoria_id: string }[]).some(p => p.categoria_id === c.id))

  return NextResponse.json({ categorias: categoriasFinal, productos: productosFinal, presentaciones: presentacionesFiltradas, grupos, opciones: opcionesFiltradas, presentacion_grupos: presGrupos ?? [], promociones })
}
