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
    return NextResponse.json({ ok: true, proveedores, articulos, presentaciones, productos })
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

  return err('Acción desconocida')
}
