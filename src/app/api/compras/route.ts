import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

// ============================================================
// /api/compras — COMPRAS/REMITOS V1 · T2 (GO CTO 29/09)
// Maestros: Proveedores + Artículos + Presentaciones de compra.
// Identidad: Bearer del admin bajo RLS (patrón /api/admin/cuits);
// mutación: admin client server-side con la empresa SIEMPRE de la
// sesión, jamás del body.
// GUARDIAS T2: módulo compras ON obligatorio (403) · baja LÓGICA
// siempre (no existe el delete físico) · sello 1 artículo ↔ 1
// producto de venta (error humano) · factor > 0 · CUIT con dígito
// verificador si viene · controla_stock es solo un flag — CERO
// lógica de stock/recepción acá (eso es T4).
// ============================================================

const err = (mensaje: string, status = 400) => NextResponse.json({ error: mensaje }, { status })

function rlsClient(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  )
}
async function empresaDelAdmin(db: NonNullable<ReturnType<typeof rlsClient>>) {
  const { data } = await db.from('empresas').select('id').limit(1).maybeSingle()
  return data?.id as string | undefined
}

function cuitValido(cuit: string): boolean {
  const d = (cuit ?? '').replace(/\D/g, '')
  if (d.length !== 11) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = mult.reduce((a, m, i) => a + m * Number(d[i]), 0)
  const resto = 11 - (suma % 11)
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto
  return dv === Number(d[10])
}

const TIPOS = ['mercaderia', 'insumo', 'material']
const UNIDADES = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro']

export async function POST(request: Request) {
  const rls = rlsClient(request)
  if (!rls) return err('No autorizado', 401)
  const empresaId = await empresaDelAdmin(rls)
  if (!empresaId) return err('No autorizado', 401)

  const supabase = createAdminClient()

  // Guardia 6: módulo compras ON o nada es operable
  const { data: cfg } = await supabase.from('empresa_config')
    .select('modulos').eq('empresa_id', empresaId).maybeSingle()
  if (((cfg?.modulos ?? {}) as Record<string, unknown>).compras !== true) {
    return err('El módulo de Compras no está activo para tu empresa', 403)
  }

  const body = await request.json().catch(() => ({}))
  const accion = body?.accion as string

  // ── LISTAR: todo lo que la página necesita, en un viaje ──
  if (accion === 'factura_crear') {
    // ═══ T5-B: FACTURA DE COMPRA — un acto: documento + remitos + cargo CC ═══
    const remitoIds: string[] = Array.isArray(body.remito_ids) ? body.remito_ids.map(String) : []
    const { data, error: e } = await supabase.rpc('registrar_factura_compra', {
      p_empresa_id: empresaId,
      p_proveedor_id: String(body.proveedor_id ?? ''),
      p_letra: body.letra ? String(body.letra) : null,
      p_numero_proveedor: String(body.numero_proveedor ?? ''),
      p_fecha: body.fecha ? String(body.fecha) : null,
      p_total: Number(body.total ?? 0),
      p_remito_ids: remitoIds.length ? remitoIds : null,
      p_observaciones: body.observaciones ? String(body.observaciones) : null,
    })
    if (e) {
      const m = e.message ?? ''
      if (m.includes('PROVEEDOR_INVALIDO')) return err('Proveedor inválido o inactivo', 409)
      if (m.includes('TOTAL_INVALIDO')) return err('El total tiene que ser mayor a cero', 400)
      if (m.includes('NUMERO_REQUERIDO')) return err('Cargá el número de factura del proveedor', 400)
      if (m.includes('REMITO_YA_FACTURADO')) return err('Uno de los remitos ya está facturado en otro comprobante', 409)
      if (m.includes('REMITO_DE_OTRO_PROVEEDOR')) return err('Un remito elegido es de OTRO proveedor', 409)
      if (m.includes('REMITO_NO_CONFIRMADO')) return err('Solo se facturan remitos de recepción CONFIRMADOS', 409)
      if (m.includes('REMITO_INVALIDO')) return err('Un remito elegido no existe en esta empresa', 409)
      return err(`No se pudo registrar la factura (${m.slice(0, 120)})`, 500)
    }
    return NextResponse.json({ ok: true, ...((data ?? {}) as Record<string, unknown>) })
  }

  if (accion === 'listar') {
    const [{ data: proveedores }, { data: articulos }, { data: presentaciones }, { data: productos }] = await Promise.all([
      supabase.from('proveedores')
        .select('id, nombre, razon_social, cuit, telefono, email, direccion, observaciones, activo')
        .eq('empresa_id', empresaId).order('nombre'),
      supabase.from('articulos')
        .select('id, nombre, tipo, unidad_stock, producto_id, controla_stock, activo')
        .eq('empresa_id', empresaId).is('deleted_at', null).order('nombre'),
      supabase.from('articulo_presentaciones_compra')
        .select('id, articulo_id, nombre, factor, activo')
        .eq('empresa_id', empresaId).order('nombre'),
      supabase.from('productos')
        .select('id, nombre').eq('empresa_id', empresaId).order('nombre'),
    ])
    const [{ data: remitos }, { data: remitoItems }] = await Promise.all([
      supabase.from('remitos_compra')
        .select('id, numero, numero_proveedor, proveedor_id, sucursal_id, orden_compra_id, tipo, fecha, estado, confirmado_at, observaciones')
        .eq('empresa_id', empresaId).order('numero', { ascending: false }).limit(100),
      supabase.from('remitos_compra_items')
        .select('id, remito_id, articulo_id, presentacion_id, cantidad, factor_snap, cantidad_operativa, costo_unitario, cantidad_pedida')
        .eq('empresa_id', empresaId),
    ])
    const [{ data: sucursales }, { data: ocs }, { data: ocItems }] = await Promise.all([
      supabase.from('sucursales').select('id, nombre').eq('empresa_id', empresaId).order('nombre'),
      supabase.from('ordenes_compra')
        .select('id, numero, proveedor_id, sucursal_id, estado, fecha, observaciones, created_at')
        .eq('empresa_id', empresaId).order('numero', { ascending: false }).limit(100),
      supabase.from('ordenes_compra_items')
        .select('id, orden_compra_id, articulo_id, presentacion_id, cantidad, costo_previsto')
        .eq('empresa_id', empresaId),
    ])
    const [{ data: comprobantes }, { data: compRemitos }] = await Promise.all([
      supabase.from('comprobantes_compra').select('*').eq('empresa_id', empresaId).order('created_at', { ascending: false }),
      supabase.from('comprobantes_compra_remitos').select('comprobante_id, remito_id').eq('empresa_id', empresaId),
    ])
    return NextResponse.json({ ok: true, proveedores, articulos, presentaciones, productos, sucursales, ocs, oc_items: ocItems, remitos, remito_items: remitoItems, comprobantes, comp_remitos: compRemitos })
  }

  // ── PROVEEDORES ──
  if (accion === 'proveedor_guardar') {
    const { id, nombre, razon_social, cuit, telefono, email, direccion, observaciones } = body
    if (!nombre?.trim()) return err('El nombre es obligatorio')
    const cuitLimpio = (cuit ?? '').replace(/\D/g, '')
    if (cuitLimpio && !cuitValido(cuitLimpio)) return err('El CUIT no es válido (verificá los 11 dígitos)')
    const payload = {
      nombre: String(nombre).trim(),
      razon_social: razon_social?.trim() || null,  // vacío = se usa la fantasía
      cuit: cuitLimpio || null,
      telefono: telefono?.trim() || null, email: email?.trim() || null,
      direccion: direccion?.trim() || null, observaciones: observaciones?.trim() || null,
    }
    if (id) {
      const { data: upd } = await supabase.from('proveedores')
        .update(payload).eq('id', id).eq('empresa_id', empresaId).select('id')
      if (!upd?.length) return err('Proveedor no encontrado', 404)
      return NextResponse.json({ ok: true, id })
    }
    const { data: nuevo, error: e } = await supabase.from('proveedores')
      .insert({ ...payload, empresa_id: empresaId }).select('id').single()
    if (e) return err('No se pudo crear el proveedor', 500)
    return NextResponse.json({ ok: true, id: nuevo.id })
  }

  if (accion === 'proveedor_toggle') {
    // Baja LÓGICA (sello CTO): activo=false. El historial y los documentos
    // existentes quedan intactos — el delete físico no existe en este ABM.
    const { id, activo } = body
    if (!id || typeof activo !== 'boolean') return err('Datos requeridos')
    const { data: upd } = await supabase.from('proveedores')
      .update({ activo }).eq('id', id).eq('empresa_id', empresaId).select('id')
    if (!upd?.length) return err('Proveedor no encontrado', 404)
    return NextResponse.json({ ok: true })
  }

  // ── ARTÍCULOS ──
  if (accion === 'articulo_guardar') {
    const { id, nombre, tipo, unidad_stock, controla_stock, producto_id } = body
    if (!nombre?.trim()) return err('El nombre es obligatorio')
    if (!TIPOS.includes(tipo)) return err('Tipo inválido')
    if (!UNIDADES.includes(unidad_stock)) return err('Unidad inválida')
    const prodId = producto_id || null
    if (prodId) {
      // El producto debe ser de la empresa
      const { data: prod } = await supabase.from('productos')
        .select('id, nombre').eq('id', prodId).eq('empresa_id', empresaId).maybeSingle()
      if (!prod) return err('Ese producto no existe en tu catálogo', 404)
      // Sello 1↔1 con error HUMANO (la unique de la base es el cinturón)
      const { data: ocupado } = await supabase.from('articulos')
        .select('id, nombre').eq('producto_id', prodId).is('deleted_at', null).maybeSingle()
      if (ocupado && ocupado.id !== id) {
        return err(`Ese producto ya es la ficha del artículo "${ocupado.nombre}" — un producto de venta solo puede tener un artículo de compra`, 409)
      }
    }
    const payload = {
      nombre: String(nombre).trim(), tipo, unidad_stock,
      controla_stock: controla_stock !== false, producto_id: prodId,
    }
    if (id) {
      const { data: upd, error: eUpd } = await supabase.from('articulos')
        .update(payload).eq('id', id).eq('empresa_id', empresaId).select('id')
      if (eUpd) return err('No se pudo guardar (¿el producto ya está vinculado?)', 409)
      if (!upd?.length) return err('Artículo no encontrado', 404)
      return NextResponse.json({ ok: true, id })
    }
    const { data: nuevo, error: e } = await supabase.from('articulos')
      .insert({ ...payload, empresa_id: empresaId }).select('id').single()
    if (e) return err('No se pudo crear (¿el producto ya está vinculado?)', 409)
    return NextResponse.json({ ok: true, id: nuevo.id })
  }

  // ── IMPORTADOR DE CATÁLOGO (GO CTO 29/09) — herramienta de CARGA, no
  // una segunda casa de productos: crea artículos de reventa vinculados
  // 1↔1. Sin sincronización posterior, sin presentaciones automáticas,
  // sin tocar precio/nombre/stock del producto de venta. Concurrencia:
  // la unique parcial de la base ES el juez — el segundo pierde. ──
  if (accion === 'importar_catalogo') {
    const ids: string[] = Array.isArray(body.producto_ids) ? body.producto_ids : []
    if (!ids.length) return err('Elegí al menos un producto')
    let creados = 0
    const rechazados: string[] = []
    for (const pid of ids) {
      const { data: prod } = await supabase.from('productos')
        .select('id, nombre').eq('id', pid).eq('empresa_id', empresaId).maybeSingle()
      if (!prod) { rechazados.push('(producto inexistente)'); continue }
      const { error: e } = await supabase.from('articulos').insert({
        empresa_id: empresaId, nombre: prod.nombre, tipo: 'mercaderia',
        unidad_stock: 'unidad', controla_stock: true, producto_id: prod.id,
      })
      if (e) rechazados.push(prod.nombre)  // unique 1↔1: ya vinculado (ganó otro)
      else creados++
    }
    return NextResponse.json({ ok: true, creados, rechazados })
  }

  if (accion === 'articulo_toggle') {
    const { id, activo } = body
    if (!id || typeof activo !== 'boolean') return err('Datos requeridos')
    const { data: upd } = await supabase.from('articulos')
      .update({ activo }).eq('id', id).eq('empresa_id', empresaId).is('deleted_at', null).select('id')
    if (!upd?.length) return err('Artículo no encontrado', 404)
    return NextResponse.json({ ok: true })
  }

  // ── PRESENTACIONES DE COMPRA ──
  if (accion === 'presentacion_guardar') {
    const { id, articulo_id, nombre, factor } = body
    if (!articulo_id || !nombre?.trim()) return err('Datos requeridos')
    const f = Number(factor)
    if (!isFinite(f) || f <= 0) return err('El factor debe ser mayor a 0')
    const { data: art } = await supabase.from('articulos')
      .select('id').eq('id', articulo_id).eq('empresa_id', empresaId).is('deleted_at', null).maybeSingle()
    if (!art) return err('Artículo no encontrado', 404)
    const payload = { nombre: String(nombre).trim(), factor: f }
    if (id) {
      const { data: upd } = await supabase.from('articulo_presentaciones_compra')
        .update(payload).eq('id', id).eq('empresa_id', empresaId).select('id')
      if (!upd?.length) return err('Presentación no encontrada', 404)
      return NextResponse.json({ ok: true, id })
    }
    const { data: nuevo, error: e } = await supabase.from('articulo_presentaciones_compra')
      .insert({ ...payload, articulo_id, empresa_id: empresaId }).select('id').single()
    if (e) return err('No se pudo crear la presentación', 500)
    return NextResponse.json({ ok: true, id: nuevo.id })
  }

  if (accion === 'presentacion_borrar') {
    // JC 29/09: una presentación SIN USO en documentos no es historial —
    // fue un typo, se borra físico. Con uso (OC o remitos): es historial,
    // solo desactivar. El server es el juez, la UI solo ofrece.
    const { id } = body
    if (!id) return err('Datos requeridos')
    const [{ count: enOC }, { count: enRemitos }] = await Promise.all([
      supabase.from('ordenes_compra_items').select('id', { count: 'exact', head: true })
        .eq('presentacion_id', id).eq('empresa_id', empresaId),
      supabase.from('remitos_compra_items').select('id', { count: 'exact', head: true })
        .eq('presentacion_id', id).eq('empresa_id', empresaId),
    ])
    if ((enOC ?? 0) + (enRemitos ?? 0) > 0) {
      return err('Esta presentación ya se usó en documentos de compra — es historial: desactivala en lugar de borrarla', 409)
    }
    const { data: del } = await supabase.from('articulo_presentaciones_compra')
      .delete().eq('id', id).eq('empresa_id', empresaId).select('id')
    if (!del?.length) return err('Presentación no encontrada', 404)
    return NextResponse.json({ ok: true })
  }

  if (accion === 'presentacion_toggle') {
    const { id, activo } = body
    if (!id || typeof activo !== 'boolean') return err('Datos requeridos')
    const { data: upd } = await supabase.from('articulo_presentaciones_compra')
      .update({ activo }).eq('id', id).eq('empresa_id', empresaId).select('id')
    if (!upd?.length) return err('Presentación no encontrada', 404)
    return NextResponse.json({ ok: true })
  }

  // ── ÓRDENES DE COMPRA (T3, GO CTO 29/09) — la OC NO mueve stock:
  // solo expresa "quiero comprar esto". Numeración por RPC de la familia
  // (advisory lock en la MISMA transacción del insert). ──
  if (accion === 'oc_crear') {
    const { proveedor_id, sucursal_id, observaciones, items } = body
    if (!proveedor_id) return err('Elegí el proveedor')
    if (!Array.isArray(items) || !items.length) return err('Agregá al menos un renglón')
    for (const it of items) {
      if (!it?.articulo_id) return err('Cada renglón necesita un artículo')
      const c = Number(it.cantidad)
      if (!isFinite(c) || c <= 0) return err('La cantidad debe ser mayor a 0')
      if (it.costo_previsto !== null && it.costo_previsto !== undefined && it.costo_previsto !== '') {
        const cp = Number(it.costo_previsto)
        if (!isFinite(cp) || cp < 0) return err('El costo previsto no es válido')
      }
    }
    const { data, error: e } = await supabase.rpc('crear_orden_compra', {
      p_empresa_id: empresaId,
      p_proveedor_id: proveedor_id,
      p_sucursal_id: sucursal_id || null,   // null = compra CENTRAL
      p_observaciones: observaciones ?? null,
      p_items: items.map((it: Record<string, unknown>) => ({
        articulo_id: it.articulo_id,
        presentacion_id: it.presentacion_id || null,
        cantidad: Number(it.cantidad),
        costo_previsto: it.costo_previsto === '' || it.costo_previsto == null ? null : Number(it.costo_previsto),
      })),
    })
    if (e) {
      const m = e.message ?? ''
      if (m.includes('PROVEEDOR_INVALIDO')) return err('Ese proveedor no está activo en tu empresa', 409)
      if (m.includes('ARTICULO_INVALIDO')) return err('Un artículo del pedido no está activo en tu empresa', 409)
      if (m.includes('PRESENTACION_INVALIDA')) return err('Una presentación no corresponde a su artículo o está inactiva', 409)
      if (m.includes('SUCURSAL_INVALIDA')) return err('Esa sucursal no es de tu empresa', 409)
      if (m.includes('CANTIDAD_INVALIDA')) return err('La cantidad debe ser mayor a 0', 400)
      if (m.includes('COSTO_INVALIDO')) return err('El costo previsto no es válido', 400)
      if (m.includes('SIN_ITEMS')) return err('Agregá al menos un renglón', 400)
      return err('No se pudo crear la orden', 500)
    }
    return NextResponse.json({ ok: true, ...((data ?? {}) as Record<string, unknown>) })
  }

  if (accion === 'oc_anular') {
    // Solo ABIERTA → ANULADA. Anulada no recibe (T4 lo re-verifica) y
    // no vuelve a abrirse desde la UI — no existe la acción inversa.
    const { id } = body
    if (!id) return err('Datos requeridos')
    const { data: upd } = await supabase.from('ordenes_compra')
      .update({ estado: 'anulada' })
      .eq('id', id).eq('empresa_id', empresaId).eq('estado', 'abierta')
      .select('id')
    if (!upd?.length) return err('Solo se puede anular una orden ABIERTA', 409)
    return NextResponse.json({ ok: true })
  }

  // ── REMITOS (T4-A, GO CTO 30/09): el BORRADOR es documento editable —
  // CERO stock acá. ingresar_remito_stock (T4-B) es el ÚNICO escritor.
  // Los snapshots del borrador son VISTA PREVIA: la RPC los re-congela
  // al confirmar (ahí "congelado" empieza a significar algo).
  if (accion === 'remito_crear') {
    const { proveedor_id, sucursal_id, orden_compra_id, numero_proveedor, observaciones } = body
    const tipo = body.tipo === 'devolucion' ? 'devolucion' : 'recepcion'
    if (!proveedor_id) return err('Elegí el proveedor')
    if (!sucursal_id) return err(tipo === 'devolucion' ? 'Elegí la sucursal que devuelve' : 'Elegí la sucursal que recibe')
    const { data, error: e } = await supabase.rpc('crear_remito_borrador', {
      p_empresa_id: empresaId, p_proveedor_id: proveedor_id, p_sucursal_id: sucursal_id,
      p_orden_compra_id: tipo === 'devolucion' ? null : (orden_compra_id || null),
      p_numero_proveedor: numero_proveedor ?? null, p_observaciones: observaciones ?? null,
      p_tipo: tipo,
    })
    if (e) {
      const m = e.message ?? ''
      if (m.includes('PROVEEDOR_INVALIDO')) return err('Ese proveedor no está activo en tu empresa', 409)
      if (m.includes('SUCURSAL_INVALIDA')) return err('Esa sucursal no es de tu empresa', 409)
      if (m.includes('OC_INVALIDA')) return err('Esa orden no es de este proveedor o ya no puede recibir', 409)
      return err('No se pudo crear el remito', 500)
    }
    const nuevoId = (data as { id?: string } | null)?.id
    // JC 02/10: UN PASO — las líneas vienen en el mismo acto (sin OC).
    // Se validan TODAS antes de crear nada; si una inserción fallara,
    // se limpia el borrador entero (no nace manco).
    const confirmarYa = body.confirmar === true
    // JC 02/10: con OC los items también vienen del cliente (los pendientes
    // editados en el modal — lo que REALMENTE llegó)
    const itemsDirectos: Array<Record<string, unknown>> = Array.isArray(body.items) ? body.items : []
    if (itemsDirectos.length && nuevoId) {
      // Pre-validación del entero de reventa (mejor rebotar ANTES de crear
      // nada que limpiar después — la RPC lo re-verifica igual)
      for (const it of itemsDirectos) {
        const cant = Number(it.cantidad)
        const cb = Number(it.costo_bulto ?? 0)
        if (!it.articulo_id || !isFinite(cant) || cant <= 0 || !isFinite(cb) || cb < 0) {
          await supabase.from('remitos_compra').delete().eq('id', nuevoId).eq('empresa_id', empresaId)
          return err('Hay una línea incompleta — revisala', 400)
        }
        const { data: art } = await supabase.from('articulos')
          .select('id, producto_id, controla_stock').eq('id', String(it.articulo_id)).eq('empresa_id', empresaId).eq('activo', true).is('deleted_at', null).maybeSingle()
        if (!art) {
          await supabase.from('remitos_compra').delete().eq('id', nuevoId).eq('empresa_id', empresaId)
          return err('Una línea tiene un artículo inactivo', 409)
        }
        let factor = 1
        if (it.presentacion_id) {
          const { data: pres } = await supabase.from('articulo_presentaciones_compra')
            .select('factor').eq('id', String(it.presentacion_id)).eq('empresa_id', empresaId)
            .eq('articulo_id', String(it.articulo_id)).eq('activo', true).maybeSingle()
          if (!pres) {
            await supabase.from('remitos_compra').delete().eq('id', nuevoId).eq('empresa_id', empresaId)
            return err('Una presentación no corresponde a su artículo', 409)
          }
          factor = Number(pres.factor)
        }
        if (art.controla_stock && art.producto_id && !Number.isInteger(cant * factor)) {
          await supabase.from('remitos_compra').delete().eq('id', nuevoId).eq('empresa_id', empresaId)
          return err('Una línea de REVENTA da unidades fraccionadas — lo que se vende se cuenta entero (los insumos sí aceptan 5.2 kg)', 400)
        }
        const { error: ei } = await supabase.from('remitos_compra_items').insert({
          empresa_id: empresaId, remito_id: nuevoId,
          articulo_id: it.articulo_id, presentacion_id: it.presentacion_id || null,
          cantidad: cant, factor_snap: factor, cantidad_operativa: cant * factor,
          costo_unitario: cb / factor,
        })
        if (ei) {
          await supabase.from('remitos_compra_items').delete().eq('remito_id', nuevoId).eq('empresa_id', empresaId)
          await supabase.from('remitos_compra').delete().eq('id', nuevoId).eq('empresa_id', empresaId)
          return err('No se pudo cargar una línea — el remito no se creó', 500)
        }
      }
    }
    if (confirmarYa && nuevoId) {
      // ═══ EL ACTO ÚNICO (JC 02/10: el borrador voló de la UI — vive
      // microsegundos como mecanismo del claim). Si la RPC rebota, se
      // limpia TODO: no queda documento manco, el modal sigue abierto.
      const { data: conf, error: ec } = await supabase.rpc('ingresar_remito_stock', {
        p_empresa_id: empresaId, p_remito_id: nuevoId,
      })
      if (ec) {
        await supabase.from('remitos_compra_items').delete().eq('remito_id', nuevoId).eq('empresa_id', empresaId)
        await supabase.from('remitos_compra').delete().eq('id', nuevoId).eq('empresa_id', empresaId).eq('estado', 'borrador')
        const m = ec.message ?? ''
        if (m.includes('SIN_LINEAS')) return err('Cargá al menos una línea', 400)
        if (m.includes('LINEA_NO_ENTERA')) return err('Una línea de REVENTA da unidades fraccionadas — lo que se vende se cuenta entero', 400)
        if (m.includes('DEVOLUCION_SIN_STOCK')) return err('No hay stock suficiente para devolver esa cantidad — nada se movió', 409)
        if (m.includes('ARTICULO_INVALIDO')) return err('Una línea tiene un artículo inactivo', 409)
        if (m.includes('PRESENTACION_INVALIDA')) return err('Una presentación no corresponde a su artículo', 409)
        if (m.includes('REMITO_NO_CONFIRMABLE')) return err('El remito ya fue confirmado o no se puede confirmar', 409)
        if (m.includes('CANTIDAD_INVALIDA')) return err('Una línea tiene cantidad inválida', 400)
        // Diagnóstico: el error desconocido muestra su causa cruda
        return err(`No se pudo confirmar — nada quedó cargado (${m.slice(0, 160)})`, 500)
      }
      return NextResponse.json({ ok: true, ...((data ?? {}) as Record<string, unknown>), ...((conf ?? {}) as Record<string, unknown>) })
    }
    // Con OC sin items del cliente: precarga legado (la UI nueva ya no lo usa)
    if (orden_compra_id && nuevoId && !itemsDirectos.length) {
      const [{ data: itemsOC }, { data: remitosOC }] = await Promise.all([
        supabase.from('ordenes_compra_items')
          .select('articulo_id, presentacion_id, cantidad, costo_previsto')
          .eq('orden_compra_id', orden_compra_id).eq('empresa_id', empresaId),
        supabase.from('remitos_compra')
          .select('id').eq('orden_compra_id', orden_compra_id).eq('empresa_id', empresaId).eq('estado', 'confirmado'),
      ])
      const idsConf = (remitosOC ?? []).map(r => r.id)
      const { data: yaRecibido } = idsConf.length
        ? await supabase.from('remitos_compra_items')
            .select('articulo_id, presentacion_id, cantidad').in('remito_id', idsConf).eq('empresa_id', empresaId)
        : { data: [] }
      const { data: presTodas } = await supabase.from('articulo_presentaciones_compra')
        .select('id, factor').eq('empresa_id', empresaId)
      const factorDe = (pid: string | null) => pid ? Number(presTodas?.find(x => x.id === pid)?.factor ?? 1) : 1
      for (const it of itemsOC ?? []) {
        const recibido = (yaRecibido ?? [])
          .filter(y => y.articulo_id === it.articulo_id && (y.presentacion_id ?? null) === (it.presentacion_id ?? null))
          .reduce((a, y) => a + Number(y.cantidad), 0)
        const pendiente = Number(it.cantidad) - recibido
        if (pendiente <= 0) continue
        const f = factorDe(it.presentacion_id ?? null)
        await supabase.from('remitos_compra_items').insert({
          empresa_id: empresaId, remito_id: nuevoId,
          articulo_id: it.articulo_id, presentacion_id: it.presentacion_id ?? null,
          cantidad: pendiente, factor_snap: f, cantidad_operativa: pendiente * f,
          costo_unitario: it.costo_previsto != null ? Number(it.costo_previsto) / f : 0,
          cantidad_pedida: Number(it.cantidad),
        })
      }
    }
    return NextResponse.json({ ok: true, ...((data ?? {}) as Record<string, unknown>) })
  }

  if (accion === 'remito_item_guardar') {
    const { remito_id, item_id, articulo_id, presentacion_id, cantidad, costo_bulto } = body
    if (!remito_id || !articulo_id) return err('Datos requeridos')
    const cant = Number(cantidad)
    if (!isFinite(cant) || cant <= 0) return err('La cantidad debe ser mayor a 0')
    const cb = Number(costo_bulto)
    if (!isFinite(cb) || cb < 0) return err('El costo no es válido')
    // Solo borradores se editan — y de la empresa de la sesión
    const { data: rem } = await supabase.from('remitos_compra')
      .select('id').eq('id', remito_id).eq('empresa_id', empresaId).eq('estado', 'borrador').maybeSingle()
    if (!rem) return err('Solo se puede editar un remito en borrador', 409)
    const { data: art } = await supabase.from('articulos')
      .select('id').eq('id', articulo_id).eq('empresa_id', empresaId).eq('activo', true).is('deleted_at', null).maybeSingle()
    if (!art) return err('Ese artículo no está activo en tu empresa', 409)
    let factor = 1
    if (presentacion_id) {
      const { data: pres } = await supabase.from('articulo_presentaciones_compra')
        .select('factor').eq('id', presentacion_id).eq('empresa_id', empresaId)
        .eq('articulo_id', articulo_id).eq('activo', true).maybeSingle()
      if (!pres) return err('Esa presentación no corresponde al artículo', 409)
      factor = Number(pres.factor)
    }
    const fila = {
      articulo_id, presentacion_id: presentacion_id || null,
      cantidad: cant, factor_snap: factor, cantidad_operativa: cant * factor,
      costo_unitario: cb / factor,   // el costo viaja por BULTO; se guarda por unidad operativa
    }
    if (item_id) {
      const { data: upd } = await supabase.from('remitos_compra_items')
        .update(fila).eq('id', item_id).eq('remito_id', remito_id).eq('empresa_id', empresaId).select('id')
      if (!upd?.length) return err('Línea no encontrada', 404)
    } else {
      const { error: e } = await supabase.from('remitos_compra_items')
        .insert({ empresa_id: empresaId, remito_id, ...fila })
      if (e) return err('No se pudo agregar la línea', 500)
    }
    return NextResponse.json({ ok: true })
  }

  if (accion === 'remito_item_borrar') {
    const { remito_id, item_id } = body
    if (!remito_id || !item_id) return err('Datos requeridos')
    const { data: rem } = await supabase.from('remitos_compra')
      .select('id').eq('id', remito_id).eq('empresa_id', empresaId).eq('estado', 'borrador').maybeSingle()
    if (!rem) return err('Solo se puede editar un remito en borrador', 409)
    await supabase.from('remitos_compra_items')
      .delete().eq('id', item_id).eq('remito_id', remito_id).eq('empresa_id', empresaId)
    return NextResponse.json({ ok: true })
  }

  if (accion === 'remito_borrar') {
    // Un BORRADOR no es historial — borrado físico permitido (confirmados jamás)
    const { id } = body
    if (!id) return err('Datos requeridos')
    const { data: rem } = await supabase.from('remitos_compra')
      .select('id').eq('id', id).eq('empresa_id', empresaId).eq('estado', 'borrador').maybeSingle()
    if (!rem) return err('Solo se puede descartar un remito en borrador', 409)
    await supabase.from('remitos_compra_items').delete().eq('remito_id', id).eq('empresa_id', empresaId)
    await supabase.from('remitos_compra').delete().eq('id', id).eq('empresa_id', empresaId).eq('estado', 'borrador')
    return NextResponse.json({ ok: true })
  }

  if (accion === 'remito_confirmar') {
    // T4-B: ingresar_remito_stock — EL ÚNICO escritor del circuito.
    // Claim atómico + todo-o-nada viven en la RPC; acá solo traducimos.
    const { id } = body
    if (!id) return err('Datos requeridos')
    const { data, error: e } = await supabase.rpc('ingresar_remito_stock', {
      p_empresa_id: empresaId, p_remito_id: id,
    })
    if (e) {
      const m = e.message ?? ''
      if (m.includes('REMITO_NO_CONFIRMABLE')) return err('Este remito ya fue confirmado o no se puede confirmar', 409)
      if (m.includes('SIN_LINEAS')) return err('El remito no tiene líneas — agregá lo que llegó', 400)
      if (m.includes('ARTICULO_INVALIDO')) return err('Una línea tiene un artículo inactivo — revisala', 409)
      if (m.includes('PRESENTACION_INVALIDA')) return err('Una línea tiene una presentación que no corresponde', 409)
      if (m.includes('CANTIDAD_INVALIDA')) return err('Una línea tiene cantidad inválida', 400)
      if (m.includes('LINEA_NO_ENTERA')) return err('Una línea de REVENTA da unidades fraccionadas — lo que se vende se cuenta entero (los insumos sí aceptan 5.2 kg)', 400)
      if (m.includes('DEVOLUCION_SIN_STOCK')) return err('No hay stock suficiente para devolver esa cantidad — nada se movió', 409)
      return err('No se pudo confirmar', 500)
    }
    return NextResponse.json({ ok: true, ...((data ?? {}) as Record<string, unknown>) })
  }

  if (accion === 'remito_editar_cab') {
    const { id, numero_proveedor, observaciones, fecha } = body
    if (!id) return err('Datos requeridos')
    const { data: upd } = await supabase.from('remitos_compra')
      .update({
        numero_proveedor: numero_proveedor?.trim() || null,
        observaciones: observaciones?.trim() || null,
        ...(fecha ? { fecha } : {}),
      })
      .eq('id', id).eq('empresa_id', empresaId).eq('estado', 'borrador').select('id')
    if (!upd?.length) return err('Solo se puede editar un remito en borrador', 409)
    return NextResponse.json({ ok: true })
  }

  return err('Acción desconocida')
}
