import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

// ARQUEO DE STOCK — lado SERVIDOR de la caja (Stock V2 · R1, orden CTO 21/10/2026).
//
// Antes, la caja leía y escribía arqueos_stock / arqueo_items / producto_stock
// con el cliente del navegador: empresa, sucursal, quién contó y el teórico los
// decidía el cliente, y todo dependía de una sesión de admin "prestada".
// Ahora el navegador solo manda lo que contó; todo lo demás sale de acá.
//
// POST { accion: 'preparar' | 'guardar', device_token, session_id, ... }
//
// IDENTIDAD (nunca un id público como única credencial):
//   · device_token  → dispositivo ACTIVO de tipo CAJA (de ahí salen empresa y sucursal)
//   · session_id    → sesión de operador ACTIVA, creada recién después del PIN, que
//                     debe pertenecer a ESE dispositivo / empresa / sucursal
//   · operador      → el de la sesión (no uno declarado por el cliente): activo, sin baja,
//                     de la misma empresa, de esta sucursal (o de toda la empresa) y con
//                     permiso de cobrar (el que ya exige la pantalla de caja)
// Cualquier falla de identidad responde el mismo 403 genérico: no se revela cuál.
//
// ATOMICIDAD (límite conocido, SIN SQL): arqueo e ítems son dos inserts. Si fallan los
// ítems se borra el arqueo creado por ESTA operación (compensación). No equivale a una
// transacción y NO garantiza un único pendiente ante envíos simultáneos: la unicidad
// definitiva requiere una RPC transaccional + restricción (orden SQL aparte).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 500
const MAX_FISICO = 1_000_000
const MAX_OBS = 500

const NO_AUTORIZADO = () => NextResponse.json({ error: 'No autorizado' }, { status: 403 })
const ERR = (error: string, status: number, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status })

interface Ctx {
  empresa_id: string
  sucursal_id: string
  operador_nombre: string
}

// Devuelve el contexto autorizado, o null si cualquier eslabón de la cadena falla.
async function autorizar(db: SupabaseClient, body: Record<string, unknown>): Promise<Ctx | null> {
  const deviceToken = typeof body.device_token === 'string' ? body.device_token : ''
  const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
  if (deviceToken.length < 8 || deviceToken.length > 200 || !UUID_RE.test(sessionId)) return null

  const { data: disp } = await db.from('dispositivos')
    .select('id, empresa_id, sucursal_id, activo, tipo')
    .eq('device_token', deviceToken).maybeSingle()
  if (!disp || disp.activo !== true || disp.tipo !== 'CAJA') return null

  const { data: ses } = await db.from('operator_sessions')
    .select('id, operador_id, dispositivo_id, empresa_id, sucursal_id, estado')
    .eq('id', sessionId).maybeSingle()
  if (!ses || ses.estado !== 'ACTIVA') return null
  // La sesión debe ser de ESTE dispositivo y de ESTA empresa/sucursal (las del servidor).
  if (ses.dispositivo_id !== disp.id || ses.empresa_id !== disp.empresa_id || ses.sucursal_id !== disp.sucursal_id) return null

  // El operador sale de la SESIÓN (no del cliente) y se revalida contra el dispositivo.
  const { data: op } = await db.from('operadores')
    .select('id, nombre, empresa_id, sucursal_id, puede_cobrar, activo, deleted_at')
    .eq('id', ses.operador_id).maybeSingle()
  if (!op || op.activo !== true || op.deleted_at) return null
  if (op.empresa_id !== disp.empresa_id) return null
  if (op.sucursal_id && op.sucursal_id !== disp.sucursal_id) return null
  if (op.puede_cobrar !== true) return null

  return { empresa_id: disp.empresa_id, sucursal_id: disp.sucursal_id, operador_nombre: String(op.nombre ?? '') }
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ERR('Datos inválidos', 400)
  const body = raw as Record<string, unknown>
  const accion = body.accion
  if (accion !== 'preparar' && accion !== 'guardar') return ERR('Acción inválida', 400)

  try {
    const db = createAdminClient() as unknown as SupabaseClient
    const ctx = await autorizar(db, body)
    if (!ctx) return NO_AUTORIZADO()

    // ───────────────────────── PREPARAR ─────────────────────────
    if (accion === 'preparar') {
      const [pend, cats, prods] = await Promise.all([
        db.from('arqueos_stock').select('id')
          .eq('empresa_id', ctx.empresa_id).eq('sucursal_id', ctx.sucursal_id).eq('estado', 'pendiente').limit(1),
        db.from('categorias').select('id, nombre')
          .eq('empresa_id', ctx.empresa_id).eq('activo', true).order('orden'),
        db.from('productos').select('id, nombre, categoria_id')
          .eq('empresa_id', ctx.empresa_id).eq('activo', true).eq('controla_stock', true).is('deleted_at', null).order('nombre'),
      ])
      if (pend.error || cats.error || prods.error) {
        console.error('[arqueo] preparar: error de lectura', { pend: !!pend.error, cats: !!cats.error, prods: !!prods.error })
        return ERR('No se pudo preparar el arqueo', 500)
      }
      return NextResponse.json({
        pendiente: (pend.data ?? []).length > 0,
        categorias: cats.data ?? [],
        productos: prods.data ?? [],
      })
    }

    // ───────────────────────── GUARDAR ─────────────────────────
    // 1) Validación de datos (el servidor no confía en el formulario)
    const alcanceIn = typeof body.alcance === 'string' ? body.alcance : ''
    const categoriaId = alcanceIn === 'completo' ? null : alcanceIn
    if (categoriaId !== null && !UUID_RE.test(categoriaId)) return ERR('Alcance inválido', 400, 'ALCANCE_INVALIDO')

    let observaciones: string | null = null
    if (body.observaciones !== undefined && body.observaciones !== null) {
      if (typeof body.observaciones !== 'string' || body.observaciones.length > MAX_OBS) {
        return ERR('Las observaciones son demasiado largas', 400, 'OBSERVACIONES_INVALIDAS')
      }
      observaciones = body.observaciones.trim() || null
    }

    const itemsIn = body.items
    if (!Array.isArray(itemsIn) || itemsIn.length === 0 || itemsIn.length > MAX_ITEMS) {
      return ERR('Cargá al menos un producto contado', 400, 'ITEMS_INVALIDOS')
    }
    const items: { producto_id: string; fisico: number }[] = []
    const vistos = new Set<string>()
    for (const it of itemsIn) {
      const r = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
      const pid = typeof r.producto_id === 'string' ? r.producto_id : ''
      if (!UUID_RE.test(pid) || vistos.has(pid)) return ERR('Productos inválidos o repetidos', 400, 'ITEMS_INVALIDOS')
      const f = r.fisico
      // Stock entero y ≥ 0: nada de decimales, negativos, NaN, infinitos ni strings
      if (typeof f !== 'number' || !Number.isInteger(f) || f < 0 || f > MAX_FISICO) {
        return ERR('Las cantidades deben ser números enteros, 0 o más', 400, 'CANTIDAD_INVALIDA')
      }
      vistos.add(pid)
      items.push({ producto_id: pid, fisico: f })
    }

    // 2) Alcance: la categoría (si hay) debe ser de la empresa autorizada
    let alcance = 'completo'
    if (categoriaId) {
      const { data: cat, error: eCat } = await db.from('categorias').select('id, nombre')
        .eq('id', categoriaId).eq('empresa_id', ctx.empresa_id).eq('activo', true).maybeSingle()
      if (eCat) return ERR('No se pudo guardar el conteo', 500)
      if (!cat) return ERR('Alcance inválido', 422, 'ALCANCE_INVALIDO')
      alcance = `categoria:${cat.nombre}`
    }

    // 3) Productos: de la empresa, activos, sin baja y con control de stock
    //    (mismos criterios que usaba la caja); y dentro del alcance elegido.
    const ids = items.map(i => i.producto_id)
    const { data: prods, error: eProds } = await db.from('productos').select('id, categoria_id')
      .eq('empresa_id', ctx.empresa_id).eq('activo', true).eq('controla_stock', true).is('deleted_at', null).in('id', ids)
    if (eProds) return ERR('No se pudo guardar el conteo', 500)
    if ((prods ?? []).length !== ids.length) return ERR('Hay productos que no corresponden al arqueo', 422, 'PRODUCTO_INVALIDO')
    if (categoriaId && (prods ?? []).some(p => p.categoria_id !== categoriaId)) {
      return ERR('Hay productos fuera del alcance elegido', 422, 'PRODUCTO_INVALIDO')
    }

    // 4) Un solo pendiente por sucursal (chequeo; ver límite de concurrencia arriba)
    const { data: pend, error: ePend } = await db.from('arqueos_stock').select('id')
      .eq('empresa_id', ctx.empresa_id).eq('sucursal_id', ctx.sucursal_id).eq('estado', 'pendiente').limit(1)
    if (ePend) return ERR('No se pudo guardar el conteo', 500)
    if ((pend ?? []).length > 0) {
      return ERR('Ya hay un arqueo PENDIENTE de esta sucursal esperando confirmación del admin.', 409, 'ARQUEO_PENDIENTE')
    }

    // 5) TEÓRICO: lo lee el servidor, con el ámbito autorizado. Sin fila = 0.
    const { data: stock, error: eStock } = await db.from('producto_stock').select('producto_id, cantidad')
      .eq('empresa_id', ctx.empresa_id).eq('sucursal_id', ctx.sucursal_id).in('producto_id', ids)
    if (eStock) return ERR('No se pudo guardar el conteo', 500)
    const teorico = new Map<string, number>((stock ?? []).map(s => [s.producto_id as string, Number(s.cantidad)]))

    // 6) Persistencia: arqueo + ítems (sin tocar stock ni generar movimientos)
    const { data: arq, error: eArq } = await db.from('arqueos_stock').insert({
      empresa_id: ctx.empresa_id, sucursal_id: ctx.sucursal_id,
      alcance, contado_por: ctx.operador_nombre || null, observaciones,
    }).select('id').single()
    if (eArq || !arq) {
      console.error('[arqueo] guardar: no se pudo crear el arqueo')
      return ERR('No se pudo guardar el conteo', 500)
    }

    const { error: eItems } = await db.from('arqueo_items').insert(items.map(i => ({
      arqueo_id: arq.id, producto_id: i.producto_id,
      teorico: teorico.get(i.producto_id) ?? 0, fisico: i.fisico,
    })))
    if (eItems) {
      // Compensación: borrar SOLO el arqueo creado por esta operación (id propio + empresa).
      const del = await db.from('arqueos_stock').delete().eq('id', arq.id).eq('empresa_id', ctx.empresa_id)
      console.error('[arqueo] guardar: falló el insert de ítems; compensación', { arqueo_id: arq.id, compensado: !del.error })
      return NextResponse.json({ error: 'No se pudo guardar el conteo', compensado: !del.error }, { status: 500 })
    }

    // 7) Anti-duplicado post-insert (mejor esfuerzo): si apareció otro pendiente en la
    //    misma sucursal, sobrevive el más antiguo (determinístico) y este se retira.
    const { data: pendientes, error: ePost } = await db.from('arqueos_stock').select('id')
      .eq('empresa_id', ctx.empresa_id).eq('sucursal_id', ctx.sucursal_id).eq('estado', 'pendiente')
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(5)
    if (ePost) {
      console.error('[arqueo] guardar: no se pudo verificar duplicados', { arqueo_id: arq.id })
    } else if ((pendientes ?? []).length > 1 && pendientes![0].id !== arq.id) {
      const del = await db.from('arqueos_stock').delete().eq('id', arq.id).eq('empresa_id', ctx.empresa_id)
      console.error('[arqueo] guardar: pendiente duplicado retirado', { arqueo_id: arq.id, retirado: !del.error })
      if (!del.error) {
        return ERR('Ya hay un arqueo PENDIENTE de esta sucursal esperando confirmación del admin.', 409, 'ARQUEO_PENDIENTE')
      }
    }

    return NextResponse.json({ ok: true, arqueo_id: arq.id, cargados: items.length })
  } catch (e) {
    console.error('[arqueo] error inesperado', e instanceof Error ? e.message : 'desconocido')
    return ERR('No se pudo completar la operación', 500)
  }
}
