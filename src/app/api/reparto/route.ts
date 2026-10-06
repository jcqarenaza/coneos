import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { facturarSiCorresponde } from '@/lib/facturacion/facturar'

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
    .select('id, empresa_id, sucursal_id, nombre, rol, activo, emoji_reparto')
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

  // ── PEDIDO PÚBLICO: la pantalla del cliente (/pedido/[numero]) — resuelto
  // SERVER-SIDE (bug 29/09: la page leía pedidos/empresas con el anon del
  // browser; en la PC "andaba" por la sesión de admin, en el celu del cliente
  // real RLS la bloqueaba → "Pedido no encontrado"). SIN gate de módulo:
  // el estado del pedido es de todos los canales; reparto solo gobierna el mapa.
  if (body.accion === 'pedido_publico') {
    // 🔒 INCIDENTE 30/09 (un cliente vio el pedido de otro): el número de
    // pedido NO es único (colisiona entre sucursales/canales) y además es
    // ENUMERABLE. La llave pública pasa a ser el UUID — inadivinable y
    // único. Referencias numéricas: rechazadas, no existe el fallback.
    const { empresa_slug } = body
    const ref = String(body.pedido_ref ?? body.numero ?? '')
    if (!empresa_slug || !ref) return err('Datos requeridos')
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)
    if (!esUuid) return NextResponse.json({ ok: true, encontrado: false })
    const { data: emp } = await supabase.from('empresas')
      .select('id, nombre').eq('slug', empresa_slug).maybeSingle()
    if (!emp) return NextResponse.json({ ok: true, encontrado: false })
    const { data: cfg } = await supabase.from('empresa_config')
      .select('primary_color, secondary_color, logo_url, modulos').eq('empresa_id', emp.id).maybeSingle()
    const { data: p } = await supabase.from('pedidos')
      .select(`id, numero_pedido, codigo_retiro, estado, total, metodo_pago, created_at, tipo_pedido, costo_envio, datos_delivery, colaborador_id, colaborador_nombre, sucursal_id,
        pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
          pedido_item_opciones(nombre_snap, emoji_snap))`)
      .eq('empresa_id', emp.id).eq('id', ref).maybeSingle()
    if (!p) return NextResponse.json({ ok: true, encontrado: false })
    // Vuelta a la tienda (JC 29/09): la pantalla del pedido era un callejón
    // sin salida en PWA — el server arma el link al canal de SU sucursal.
    const { data: sucVuelta } = p.sucursal_id
      ? await supabase.from('sucursales').select('slug').eq('id', p.sucursal_id).maybeSingle()
      : { data: null }
    const volver_url = sucVuelta?.slug
      ? `/${empresa_slug}/${p.tipo_pedido === 'takeaway' ? 'takeaway' : 'delivery'}/${sucVuelta.slug}`
      : null
    // Identidad visual del cadete (GO CTO 29/09) — una casa: colaboradores
    const { data: colPed } = p.colaborador_id
      ? await supabase.from('colaboradores').select('emoji_reparto, alias_publico').eq('id', p.colaborador_id).maybeSingle()
      : { data: null }
    return NextResponse.json({ ok: true, encontrado: true,
      pedido: { ...p, colaborador_nombre: p.colaborador_nombre ? (colPed?.alias_publico ?? p.colaborador_nombre) : null,
        colaborador_emoji: colPed?.emoji_reparto ?? '🛵' }, volver_url,
      marca: { nombre: emp.nombre, empresa_id: emp.id,
        primary_color: cfg?.primary_color ?? '#1E3A5F', secondary_color: cfg?.secondary_color ?? '#F5C842',
        logo_url: cfg?.logo_url ?? null,
        reparto: ((cfg?.modulos ?? {}) as Record<string, unknown>).reparto === true } })
  }

  // ── CONTEXTO de la puerta (público): resuelve la sucursal por slug o id
  // SERVER-SIDE — la tabla sucursales no es legible por el anon del browser
  // (RLS), y la puerta no debe depender de policies públicas nuevas.
  if (body.accion === 'contexto') {
    // La puerta NO usa Supabase desde el browser (RLS anon la frenaba en
    // celulares sin sesión de admin — R2): empresa por SLUG, marca, módulo,
    // sucursal y lista de cadetes salen TODOS de acá, admin client.
    const { empresa_slug, sucursal } = body
    if (!empresa_slug || !sucursal) return err('Datos requeridos')
    const { data: emp } = await supabase.from('empresas')
      .select('id, nombre').eq('slug', empresa_slug).maybeSingle()
    if (!emp) return NextResponse.json({ ok: true, habilitado: false, motivo: 'empresa' })
    const { data: cfg } = await supabase.from('empresa_config')
      .select('modulos, primary_color, logo_url').eq('empresa_id', emp.id).maybeSingle()
    if ((cfg?.modulos as Record<string, unknown> | null)?.reparto !== true) {
      return NextResponse.json({ ok: true, habilitado: false, motivo: 'modulo' })
    }
    const { data: sucs } = await supabase.from('sucursales')
      .select('id, nombre, slug, activo').eq('empresa_id', emp.id).eq('activo', true)
    const suc = (sucs ?? []).find(x => x.slug === sucursal) ?? (sucs ?? []).find(x => x.id === sucursal)
    if (!suc) return NextResponse.json({ ok: true, habilitado: false, motivo: 'sucursal' })
    // Cadetes elegibles de la puerta (UX CTO: lista → tap → PIN)
    const { data: cads } = await supabase.from('colaboradores')
      .select('id, nombre, sucursal_id, emoji_reparto').eq('empresa_id', emp.id)
      .eq('rol', 'cadete').eq('activo', true).order('nombre')
    const cadetes = (cads ?? []).filter(c => c.sucursal_id === suc.id || c.sucursal_id === null)
      .map(c => ({ id: c.id, nombre: c.nombre, emoji: c.emoji_reparto ?? '🛵' }))
    return NextResponse.json({ ok: true, habilitado: true, empresa_id: emp.id, empresa_nombre: emp.nombre,
      color: cfg?.primary_color ?? '#1E3A5F', logo: cfg?.logo_url ?? null,
      sucursal_id: suc.id, sucursal_nombre: suc.nombre, cadetes })
  }

  // ── LOGIN: cadete elegido de la lista + PIN (UX CTO 28/09) ──
  if (body.accion === 'login') {
    const { empresa_id, sucursal_id, colaborador_id, pin } = body
    if (!empresa_id || !sucursal_id || !colaborador_id || !pin) return err('Datos requeridos')
    if (!(await moduloReparto(supabase, empresa_id))) return err('Módulo no disponible', 403)
    const { data: col } = await supabase.from('colaboradores')
      .select('id, nombre, pin_hash, sucursal_id, emoji_reparto')
      .eq('id', colaborador_id).eq('empresa_id', empresa_id)
      .eq('rol', 'cadete').eq('activo', true).maybeSingle()
    const valido = col && (col.sucursal_id === sucursal_id || col.sucursal_id === null) && col.pin_hash
    if (!valido) return err('PIN incorrecto', 401)  // genérico
    const { data: pinValido } = await supabase.rpc('verificar_pin_operador', { p_pin: String(pin), p_hash: col.pin_hash })
    if (!pinValido) return err('PIN incorrecto', 401)
    const expira = new Date(Date.now() + SESION_DIAS * 24 * 3600 * 1000).toISOString()
    const { data: ses, error: e } = await supabase.from('colaborador_sesiones')
      .insert({ colaborador_id: col.id, empresa_id, expira_at: expira }).select('token').single()
    if (e || !ses) return err('No se pudo iniciar sesión', 500)
    return NextResponse.json({ ok: true, token: ses.token, cadete: { id: col.id, nombre: col.nombre, emoji: col.emoji_reparto ?? '🛵' } })
  }

  // ── POSICIÓN DEL CADETE → PARA EL CLIENTE (público, sin token) ──
  // Solo devuelve la moto del pedido consultado, y solo si está EN
  // REPARTO (READY + cadete) con el módulo prendido. D5: jamás otros.
  if (body.accion === 'cliente_posicion') {
    const { empresa_id } = body
    const refPos = String(body.pedido_id ?? body.numero_pedido ?? '')
    if (!empresa_id || !refPos) return err('Datos requeridos')
    // 🔒 Misma llave que pedido_publico: UUID o nada (el número colisiona)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refPos)) {
      return NextResponse.json({ ok: true, activo: false })
    }
    if (!(await moduloReparto(supabase, empresa_id))) return NextResponse.json({ ok: true, activo: false })
    const { data: ped } = await supabase.from('pedidos')
      .select('colaborador_id, colaborador_nombre, estado, tipo_pedido')
      .eq('empresa_id', empresa_id).eq('id', refPos).maybeSingle()
    if (!ped || ped.tipo_pedido !== 'delivery' || ped.estado !== 'READY' || !ped.colaborador_id) {
      return NextResponse.json({ ok: true, activo: false })
    }
    const { data: pos } = await supabase.from('reparto_posiciones')
      .select('lat, lng, updated_at').eq('colaborador_id', ped.colaborador_id).eq('empresa_id', empresa_id).maybeSingle()
    // Alias publico (GO CTO 06/10): la frontera de privacidad vive ACA — el
    // JSON publico jamas lleva el nombre real si hay alias cargado.
    const { data: colAlias } = await supabase.from('colaboradores')
      .select('alias_publico').eq('id', ped.colaborador_id).maybeSingle()
    return NextResponse.json({ ok: true, activo: !!pos, nombre: colAlias?.alias_publico ?? ped.colaborador_nombre, ...(pos ?? {}) })
  }

  // ── Todo lo demás exige sesión de cadete ──
  const col = await validarSesion(supabase, body.token)
  if (!col) return err('Sesión inválida — volvé a ingresar', 401)
  if (!(await moduloReparto(supabase, col.empresa_id))) return err('Módulo no disponible', 403)

  // ── MIS PEDIDOS (B7: el cadete ve SOLO lo suyo) ──
  if (body.accion === 'mis_pedidos') {
    const pedidos = await pedidosActivos(supabase, col.id, col.empresa_id)
    return NextResponse.json({ ok: true, cadete: { id: col.id, nombre: col.nombre, emoji: col.emoji_reparto ?? '🛵' }, pedidos })
  }

  // ── LLEGUÉ AL LOCAL: el cadete corta el modo regreso — la posición se
  // borra por SU botón (privacidad: él decide el fin del tracking) ──
  if (body.accion === 'llegue') {
    await supabase.from('reparto_posiciones').delete().eq('colaborador_id', col.id)
    return NextResponse.json({ ok: true })
  }

  // ── POSICIÓN: con reparto activo, o en MODO REGRESO (≤30 min de la
  // última entrega — D4 re-sellada JC 29/09, seguridad del cadete) ──
  if (body.accion === 'posicion') {
    const lat = Number(body.lat), lng = Number(body.lng)
    if (!isFinite(lat) || !isFinite(lng)) return err('Posición inválida')
    const activos = await pedidosActivos(supabase, col.id, col.empresa_id)
    if (activos.length === 0) {
      const corteRegreso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      const { count: recientes } = await supabase.from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('colaborador_id', col.id).eq('estado', 'DELIVERED').gte('entregado_at', corteRegreso)
      if ((recientes ?? 0) === 0) {
        await supabase.from('reparto_posiciones').delete().eq('colaborador_id', col.id)  // tope duro (C7)
        return err('Sin reparto activo', 403)
      }
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
    // Guard atómico: solo transiciona si SIGUE en READY.
    // entregado_at = la marca de tiempo de la entrega en la puerta.
    // COBRO EN LA PUERTA (JC 29/09): si el pedido era EFECTIVO sin pagar, la
    // entrega ES el cobro — el cadete confirmó "cobraste $X" en el panel
    // verde. pagado=true recién acá: la plata entra al resumen del día cuando
    // existe. La facturación automática decide sola (idempotente, respeta
    // auto_facturar + metodos_auto del cliente).
    const { data: pedCobro } = await supabase.from('pedidos')
      .select('metodo_pago, pagado').eq('id', pedido_id).eq('empresa_id', col.empresa_id).maybeSingle()
    const cobraEnPuerta = pedCobro?.metodo_pago === 'efectivo' && pedCobro?.pagado === false
    const { data: upd } = await supabase.from('pedidos')
      .update({ estado: 'DELIVERED', updated_at: new Date().toISOString(), entregado_at: new Date().toISOString(),
        ...(cobraEnPuerta ? { pagado: true } : {}) })
      .eq('id', pedido_id).eq('empresa_id', col.empresa_id).eq('estado', 'READY').select('id')
    if (!upd?.length) return err('El pedido cambió de estado — actualizá', 409)
    await supabase.from('pedido_estados_log').insert({
      pedido_id, operador_id: null, estado_anterior: 'READY', estado_nuevo: 'DELIVERED',
    }).then(() => {}, () => {})
    if (cobraEnPuerta) await facturarSiCorresponde(pedido_id).catch(() => {})
    // D4 re-sellada (JC 29/09, seguridad del cadete): entregado el ÚLTIMO
    // pedido ya NO se borra la posición — arranca el MODO REGRESO: la caja
    // lo sigue viendo volver en el 🗺️. El corte lo da el cadete con
    // "Llegué al local" (accion llegue) o el tope de 30 min del server.
    const restantes = await pedidosActivos(supabase, col.id, col.empresa_id)
    return NextResponse.json({ ok: true, quedan: restantes.length, modo_regreso: restantes.length === 0 })
  }

  return err('Acción desconocida')
}
