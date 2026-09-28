import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ============================================================
// /api/reparto — REPARTO V1 (brief CTO 28/09)
// Puerta del CADETE (colaborador rol 'cadete', la casa existente)
// + posición para el mapa del cliente. TODO server-side.
// Reglas duras: módulo empresa_config.modulos.reparto gatea todo ·
// la autoridad la valida el server en cada request (token → sesión
// vigente + colaborador activo + rol cadete + empresa) · posición
// aceptada SOLO con reparto activo (≥1 pedido delivery asignado en
// PREPARING/READY) · Entregado solo desde READY (409 si no) · al
// cerrar el último, la posición se BORRA (garantizado acá, no en el
// frontend) · el PIN se verifica con el MISMO motor bcrypt/pgcrypto
// de operadores (verificar_pin_operador) · 401 genérico sin filtrar
// si el nombre existe.
// ============================================================

const err = (mensaje: string, status = 400) => NextResponse.json({ ok: false, error: mensaje }, { status })
const SESION_DIAS = 14

async function moduloReparto(supabase: ReturnType<typeof createAdminClient>, empresaId: string): Promise<boolean> {
  const { data } = await supabase.from('empresa_config').select('modulos').eq('empresa_id', empresaId).maybeSingle()
  return (data?.modulos as Record<string, unknown> | null)?.reparto === true
}

// Valida token → { colaborador } o null. Sesión vencida/colaborador
// inactivo o sin rol cadete = null (G3/G5: el token no es autoridad).
async function validarSesion(supabase: ReturnType<typeof createAdminClient>, token: string) {
  if (!token) return null
  const { data: ses } = await supabase.from('colaborador_sesiones')
    .select('colaborador_id, empresa_id, expira_at').eq('token', token).maybeSingle()
  if (!ses || new Date(ses.expira_at) < new Date()) return null
  const { data: col } = await supabase.from('colaboradores')
    .select('id, empresa_id, sucursal_id, nombre, rol, activo')
    .eq('id', ses.colaborador_id).eq('empresa_id', ses.empresa_id).maybeSingle()
  if (!col?.activo || col.rol !== 'cadete') return null
  return col
}

// Pedidos activos del cadete (definen "reparto activo"): delivery
// asignados a él en PREPARING o READY.
const CAMPOS_PEDIDO = 'id, numero_pedido, estado, total, metodo_pago, pagado, notas, datos_delivery, hora_retiro, created_at'
async function pedidosActivos(supabase: ReturnType<typeof createAdminClient>, colaboradorId: string, empresaId: string) {
  const { data } = await supabase.from('pedidos')
    .select(CAMPOS_PEDIDO)
    .eq('empresa_id', empresaId).eq('colaborador_id', colaboradorId)
    .eq('tipo_pedido', 'delivery').in('estado', ['PREPARING', 'READY'])
    .order('estado', { ascending: false })  // READY antes que PREPARING
    .order('created_at')
  return data ?? []
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body?.accion) return err('Acción requerida')
  const supabase = createAdminClient()

  // ── LOGIN: nombre + PIN dentro de la sucursal de la puerta ──
  if (body.accion === 'login') {
    const { empresa_id, sucursal_id, nombre, pin } = body
    if (!empresa_id || !sucursal_id || !nombre || !pin) return err('Datos requeridos')
    if (!(await moduloReparto(supabase, empresa_id))) return err('Módulo no disponible', 403)
    const { data: candidatos } = await supabase.from('colaboradores')
      .select('id, nombre, pin_hash, sucursal_id')
      .eq('empresa_id', empresa_id).eq('rol', 'cadete').eq('activo', true)
      .ilike('nombre', String(nombre).trim())
    // De la sucursal de la puerta, o "toda la empresa" (sucursal null)
    const col = (candidatos ?? []).find(c => c.sucursal_id === sucursal_id || c.sucursal_id === null)
    if (!col?.pin_hash) return err('Nombre o PIN incorrecto', 401)  // genérico: no filtra existencia
    const { data: pinValido } = await supabase.rpc('verificar_pin_operador', { p_pin: String(pin), p_hash: col.pin_hash })
    if (!pinValido) return err('Nombre o PIN incorrecto', 401)
    const expira = new Date(Date.now() + SESION_DIAS * 24 * 3600 * 1000).toISOString()
    const { data: ses, error: e } = await supabase.from('colaborador_sesiones')
      .insert({ colaborador_id: col.id, empresa_id, expira_at: expira }).select('token').single()
    if (e || !ses) return err('No se pudo iniciar sesión', 500)
    return NextResponse.json({ ok: true, token: ses.token, cadete: { id: col.id, nombre: col.nombre } })
  }

  // ── POSICIÓN DEL CADETE → PARA EL CLIENTE (público, sin token) ──
  // Solo devuelve la moto del pedido consultado, y solo si está EN
  // REPARTO (READY + cadete) con el módulo prendido. D5: jamás otros.
  if (body.accion === 'cliente_posicion') {
    const { empresa_id, numero_pedido } = body
    if (!empresa_id || !numero_pedido) return err('Datos requeridos')
    if (!(await moduloReparto(supabase, empresa_id))) return NextResponse.json({ ok: true, activo: false })
    const { data: ped } = await supabase.from('pedidos')
      .select('colaborador_id, colaborador_nombre, estado, tipo_pedido')
      .eq('empresa_id', empresa_id).eq('numero_pedido', Number(numero_pedido))
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!ped || ped.tipo_pedido !== 'delivery' || ped.estado !== 'READY' || !ped.colaborador_id) {
      return NextResponse.json({ ok: true, activo: false })
    }
    const { data: pos } = await supabase.from('reparto_posiciones')
      .select('lat, lng, updated_at').eq('colaborador_id', ped.colaborador_id).eq('empresa_id', empresa_id).maybeSingle()
    return NextResponse.json({ ok: true, activo: !!pos, nombre: ped.colaborador_nombre, ...(pos ?? {}) })
  }

  // ── Todo lo demás exige sesión de cadete ──
  const col = await validarSesion(supabase, body.token)
  if (!col) return err('Sesión inválida — volvé a ingresar', 401)
  if (!(await moduloReparto(supabase, col.empresa_id))) return err('Módulo no disponible', 403)

  // ── MIS PEDIDOS (B7: el cadete ve SOLO lo suyo) ──
  if (body.accion === 'mis_pedidos') {
    const pedidos = await pedidosActivos(supabase, col.id, col.empresa_id)
    return NextResponse.json({ ok: true, cadete: { id: col.id, nombre: col.nombre }, pedidos })
  }

  // ── POSICIÓN: aceptada SOLO con reparto activo (C1/C7) ──
  if (body.accion === 'posicion') {
    const lat = Number(body.lat), lng = Number(body.lng)
    if (!isFinite(lat) || !isFinite(lng)) return err('Posición inválida')
    const activos = await pedidosActivos(supabase, col.id, col.empresa_id)
    if (activos.length === 0) {
      await supabase.from('reparto_posiciones').delete().eq('colaborador_id', col.id)  // limpiar (C7)
      return err('Sin reparto activo', 403)
    }
    // Throttle server-side ~10s (C2/C3)
    const { data: prev } = await supabase.from('reparto_posiciones')
      .select('updated_at').eq('colaborador_id', col.id).maybeSingle()
    if (prev && Date.now() - new Date(prev.updated_at).getTime() < 8000) {
      return NextResponse.json({ ok: true, throttled: true })
    }
    const { error: e } = await supabase.from('reparto_posiciones').upsert({
      colaborador_id: col.id, empresa_id: col.empresa_id, sucursal_id: col.sucursal_id,
      lat, lng, updated_at: new Date().toISOString(),
    }, { onConflict: 'colaborador_id' })
    if (e) return err('No se pudo guardar la posición', 500)
    return NextResponse.json({ ok: true })
  }

  // ── ENTREGADO: solo READY → DELIVERED (E1-E6) ──
  if (body.accion === 'entregar') {
    const { pedido_id } = body
    if (!pedido_id) return err('Datos requeridos')
    const { data: ped } = await supabase.from('pedidos')
      .select('id, estado, colaborador_id')
      .eq('id', pedido_id).eq('empresa_id', col.empresa_id).maybeSingle()
    if (!ped || ped.colaborador_id !== col.id) return err('Ese pedido no está asignado a vos', 403)
    if (ped.estado === 'DELIVERED') return NextResponse.json({ ok: true, ya_entregado: true })  // idempotente (E3)
    if (ped.estado !== 'READY') return err('El pedido todavía no está listo para entregar', 409)  // E4
    // Guard atómico: solo transiciona si SIGUE en READY
    const { data: upd } = await supabase.from('pedidos')
      .update({ estado: 'DELIVERED', updated_at: new Date().toISOString() })
      .eq('id', pedido_id).eq('empresa_id', col.empresa_id).eq('estado', 'READY').select('id')
    if (!upd?.length) return err('El pedido cambió de estado — actualizá', 409)
    // Historial (mismo registro que usa la caja; el cadete no es operador → null)
    await supabase.from('pedido_estados').insert({
      pedido_id, operador_id: null, estado_anterior: 'READY', estado_nuevo: 'DELIVERED',
    })
    // Limpieza garantizada server-side (C6/E6): ¿era el último?
    const restantes = await pedidosActivos(supabase, col.id, col.empresa_id)
    if (restantes.length === 0) await supabase.from('reparto_posiciones').delete().eq('colaborador_id', col.id)
    return NextResponse.json({ ok: true, quedan: restantes.length })
  }

  return err('Acción desconocida')
}
