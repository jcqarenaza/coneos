import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { UUID_RE, validarItems, validarMotivo, soloContados, estadoStock, traducirErrorAjuste } from '@/lib/stock/ajuste'
import { validarMinimo, unidadesVendibles } from '@/lib/stock/habilitar'

// ============================================================
// /api/stock — STOCK ETAPA 1 (GO CTO 08/11)
// Inventario · Ajuste general (previsualizar / aplicar) · Movimientos.
// QUIÉN PUEDE (corregido 08/11 según cómo funciona hoy el panel):
//   El acceso al panel lo da usuarios_admin (empresa + activo); la tabla de roles casi no se usa
//   (los administradores reales NO tienen fila de rol). Entonces:
//   · usuario ACTIVO de usuarios_admin sin rol, o con ADMIN_EMPRESA → ve y ajusta TODAS las sucursales de SU empresa;
//   · con ADMIN_SUCURSAL (y sin ADMIN_EMPRESA) → SOLO su sucursal;
//   · SUPER_ADMIN solo, operadores de caja/colaboradores (no son usuarios_admin) y gente sin sesión: fuera.
// Identidad: Bearer del administrador → la sesión, el usuario y la sucursal se validan ACÁ, en el servidor.
// La empresa sale SIEMPRE de la sucursal validada, jamás del body.
// Todo movimiento de stock lo hace la función SQL aplicar_ajuste_stock
// (que usa ajustar_stock): esta ruta no escribe cantidades por su cuenta.
// ETAPA 1.1 (GO CTO 08/11): ESTA ES LA ÚNICA PUERTA para habilitar/quitar el control de stock (productos.controla_stock)
// y para editar el mínimo (producto_stock.stock_minimo). El Catálogo ya no escribe stock.
//   · habilitar / quitar control es del PRODUCTO (todas las sucursales): solo administradores con alcance de toda la empresa.
//   · el mínimo es por sucursal: cualquier administrador con acceso a esa sucursal.
// ============================================================

const err = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status })

type Sucursal = { id: string; nombre: string; empresa_id: string }

async function autorizar(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return { fail: err('No autorizado', 401) }
  const supabase = createAdminClient()
  const { data: u, error: eu } = await supabase.auth.getUser(auth.slice(7))
  if (eu || !u?.user?.id) return { fail: err('No autorizado', 401) }
  const userId = u.user.id

  // 1) El usuario tiene que ser un administrador ACTIVO del panel
  const { data: ua } = await supabase.from('usuarios_admin').select('nombre, empresa_id, activo').eq('id', userId).maybeSingle()
  if (!ua || ua.activo !== true || !ua.empresa_id) return { fail: err('Solo los administradores pueden gestionar el stock.', 403) }

  // 2) Alcance: sin fila de rol (o ADMIN_EMPRESA) = toda su empresa; solo ADMIN_SUCURSAL = su sucursal; SUPER_ADMIN solo = fuera
  const { data: roles } = await supabase.from('usuario_admin_roles').select('empresa_id, sucursal_id, rol').eq('usuario_id', userId)
  const filas = (roles ?? []) as { empresa_id: string; sucursal_id: string | null; rol: string }[]
  const conEmpresa = filas.some(r => r.rol === 'ADMIN_EMPRESA' && r.empresa_id === ua.empresa_id)
  const deSucursal = filas.filter(r => r.rol === 'ADMIN_SUCURSAL' && r.empresa_id === ua.empresa_id && r.sucursal_id)
  if (filas.length > 0 && !conEmpresa && deSucursal.length === 0) return { fail: err('Solo los administradores pueden gestionar el stock.', 403) }   // p. ej. SUPER_ADMIN solo

  let q = supabase.from('sucursales').select('id, nombre, empresa_id').eq('empresa_id', ua.empresa_id)
  if (!conEmpresa && deSucursal.length > 0) q = q.in('id', deSucursal.map(r => r.sucursal_id as string))
  const { data: sucs } = await q
  const sucursales = (sucs ?? []) as Sucursal[]
  if (sucursales.length === 0) return { fail: err('No tenés sucursales asignadas.', 403) }

  const empresaCompleta = conEmpresa || filas.length === 0   // sin fila de rol = administrador de toda su empresa
  return { supabase, userId, nombre: (ua.nombre as string | undefined) ?? null, sucursales, empresaCompleta }
}

export async function POST(request: Request) {
  const a = await autorizar(request)
  if ('fail' in a && a.fail) return a.fail
  const { supabase, userId, nombre, sucursales, empresaCompleta } = a as Exclude<typeof a, { fail: NextResponse }>

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const accion = body.accion

  if (accion === 'sucursales') {
    return NextResponse.json({ sucursales: sucursales.map(s => ({ id: s.id, nombre: s.nombre })), puede_habilitar: empresaCompleta })
  }

  const sucursalId = body.sucursal_id
  if (typeof sucursalId !== 'string' || !UUID_RE.test(sucursalId)) return err('Elegí una sucursal.')
  const suc = sucursales.find(s => s.id === sucursalId)
  if (!suc) return err('No tenés acceso a esa sucursal.', 403)
  const empresaId = suc.empresa_id

  // ── Inventario: existencias, mínimo y estado por sucursal. todos=true suma los productos SIN control de stock (para habilitarlos) ──
  if (accion === 'inventario') {
    const todos = body.todos === true
    let qp = supabase.from('productos').select('id, nombre, categoria_id, codigo, controla_stock, orden, modelo_stock').eq('empresa_id', empresaId).eq('activo', true).is('deleted_at', null)
    if (!todos) qp = qp.eq('controla_stock', true)
    const [{ data: prods }, { data: cats }, { data: filas }, { data: pres }, { data: hojas }] = await Promise.all([
      qp.order('nombre'),
      supabase.from('categorias').select('id, nombre, orden').eq('empresa_id', empresaId).order('orden'),
      supabase.from('producto_stock').select('producto_id, cantidad, stock_minimo, updated_at').eq('empresa_id', empresaId).eq('sucursal_id', sucursalId),
      supabase.from('presentaciones').select('id, producto_id, nombre, factor_stock, orden').eq('empresa_id', empresaId).eq('activo', true).order('orden'),
      // E2-b: saldo de cada hoja (sucursal x presentación) de los productos en modelo 'rama'
      supabase.from('stock_rama').select('presentacion_id, cantidad').eq('empresa_id', empresaId).eq('sucursal_id', sucursalId),
    ])
    const saldoHoja = new Map((hojas ?? []).map(h => [h.presentacion_id as string, Number(h.cantidad)]))
    const porProducto = new Map((filas ?? []).map(f => [f.producto_id as string, f]))
    const catNombre = new Map((cats ?? []).map(c => [c.id as string, c.nombre as string]))
    const presDe = new Map<string, { id: string; nombre: string; factor: number }[]>()
    for (const r of pres ?? []) { const l = presDe.get(r.producto_id as string) ?? []; l.push({ id: r.id as string, nombre: r.nombre as string, factor: Math.max(1, Math.floor(Number(r.factor_stock) || 1)) }); presDe.set(r.producto_id as string, l) }
    const items = (prods ?? []).map(p => {
      const controla = p.controla_stock === true
      if (p.modelo_stock === 'rama') {
        const ps = (presDe.get(p.id as string) ?? []).map(x => ({ ...x, vendibles: null, saldo: saldoHoja.get(x.id) ?? null }))
        return { producto_id: p.id, nombre: p.nombre, codigo: p.codigo ?? null, categoria_id: p.categoria_id, categoria: catNombre.get(p.categoria_id as string) ?? null,
          controla, modelo: 'rama', cantidad: null, minimo: null, estado: controla ? (ps.some(x => x.saldo !== null) ? 'ok' : 'sin_alta') : 'sin_control', actualizado: null, presentaciones: ps }
      }
      const f = porProducto.get(p.id as string)
      const cantidad = controla && f ? Number(f.cantidad) : null
      const minimo = controla && f ? Number(f.stock_minimo) : null
      return { producto_id: p.id, nombre: p.nombre, codigo: p.codigo ?? null, categoria_id: p.categoria_id, categoria: catNombre.get(p.categoria_id as string) ?? null,
        controla, cantidad, minimo, estado: controla ? estadoStock(cantidad, minimo) : 'sin_control', actualizado: f?.updated_at ?? null,
        presentaciones: (presDe.get(p.id as string) ?? []).map(x => ({ ...x, vendibles: unidadesVendibles(cantidad, x.factor) })) }
    })
    return NextResponse.json({ sucursal: { id: suc.id, nombre: suc.nombre }, ahora: new Date().toISOString(), items,
      categorias: (cats ?? []).map(c => ({ id: c.id, nombre: c.nombre })), puede_habilitar: empresaCompleta })
  }

  // ── Etapa 1.1: habilitar / quitar el control de stock de un PRODUCTO (todas las sucursales de la empresa) ──
  if (accion === 'habilitar' || accion === 'deshabilitar') {
    if (!empresaCompleta) return err('Solo un administrador de toda la empresa puede habilitar o quitar el control de stock.', 403)
    const productoId = body.producto_id
    if (typeof productoId !== 'string' || !UUID_RE.test(productoId)) return err('Producto inválido.')
    // La empresa del producto se valida contra la sucursal autorizada: un producto de otra empresa no existe para este administrador
    const { data: prod } = await supabase.from('productos').select('id, nombre, controla_stock').eq('id', productoId).eq('empresa_id', empresaId).is('deleted_at', null).maybeSingle()
    if (!prod) return err('Producto no encontrado.', 404)
    if (accion === 'habilitar') {
      const { data: act } = await supabase.from('productos').select('activo').eq('id', productoId).eq('empresa_id', empresaId).maybeSingle()
      if (act?.activo !== true) return err('El producto no está activo: activalo antes de cargarle stock.', 409, { codigo: 'PRODUCTO_INACTIVO' })
      if (prod.controla_stock !== true) {
        const { error } = await supabase.from('productos').update({ controla_stock: true }).eq('id', productoId).eq('empresa_id', empresaId)
        if (error) { console.error('[stock] habilitar', error.message); return err('No se pudo habilitar el control de stock.', 500) }
      }
      return NextResponse.json({ ok: true, producto_id: productoId, controla: true })
    }
    // Quitar el control con existencias: el servidor pide una confirmación explícita (no se ocultan existencias por un clic)
    const { data: ex } = await supabase.from('producto_stock').select('cantidad').eq('empresa_id', empresaId).eq('producto_id', productoId)
    const existencias = (ex ?? []).reduce((t, r) => t + Math.max(0, Number(r.cantidad) || 0), 0)
    if (existencias > 0 && body.confirmar !== true) {
      return err(`«${prod.nombre}» tiene ${existencias} unidades en stock. Si le quitás el control, las ventas dejan de descontar y las existencias dejan de verse. Si lo volvés a habilitar, contalo de nuevo.`, 409, { codigo: 'CONFIRMAR_QUITAR', existencias })
    }
    if (prod.controla_stock === true) {
      const { error } = await supabase.from('productos').update({ controla_stock: false }).eq('id', productoId).eq('empresa_id', empresaId)
      if (error) { console.error('[stock] deshabilitar', error.message); return err('No se pudo quitar el control de stock.', 500) }
    }
    return NextResponse.json({ ok: true, producto_id: productoId, controla: false })
  }

  // ── Alta inicial en LOTE: habilitar el control de varios productos de una sola vez (solo HABILITAR; quitar sigue siendo uno a uno, con confirmación) ──
  // Mismas reglas que 'habilitar': solo administrador de toda la empresa, productos de SU empresa y no borrados. No toca existencias.
  if (accion === 'habilitar_lote') {
    if (!empresaCompleta) return err('Solo un administrador de toda la empresa puede habilitar o quitar el control de stock.', 403)
    const ids = body.producto_ids
    if (!Array.isArray(ids) || ids.length === 0) return err('No hay productos para habilitar.')
    if (ids.length > 500) return err('Demasiados productos de una vez (máximo 500). Filtrá por categoría y repetí.')
    if (!ids.every(x => typeof x === 'string' && UUID_RE.test(x))) return err('Producto inválido.')
    const unicos = [...new Set(ids as string[])]
    const { data: hechos, error } = await supabase.from('productos').update({ controla_stock: true })
      .in('id', unicos).eq('empresa_id', empresaId).eq('activo', true).is('deleted_at', null).neq('controla_stock', true).select('id')
    if (error) { console.error('[stock] habilitar_lote', error.message); return err('No se pudo habilitar el control de stock.', 500) }
    return NextResponse.json({ ok: true, habilitados: (hechos ?? []).length, pedidos: unicos.length })
  }

  // ── Etapa 1.1: mínimo de aviso (configuración por sucursal; no es un movimiento de stock) ──
  if (accion === 'minimo') {
    const productoId = body.producto_id
    if (typeof productoId !== 'string' || !UUID_RE.test(productoId)) return err('Producto inválido.')
    const eMin = validarMinimo(body.minimo); if (eMin) return err(eMin)
    const { data: prod } = await supabase.from('productos').select('id, controla_stock').eq('id', productoId).eq('empresa_id', empresaId).is('deleted_at', null).maybeSingle()
    if (!prod) return err('Producto no encontrado.', 404)
    const { data: fila } = await supabase.from('producto_stock').select('producto_id').eq('empresa_id', empresaId).eq('sucursal_id', sucursalId).eq('producto_id', productoId).maybeSingle()
    if (prod.controla_stock !== true || !fila) return err('Este producto todavía no tiene stock cargado en esta sucursal. Cargalo primero con un Ajuste general.', 409, { codigo: 'SIN_ALTA' })
    const { error } = await supabase.from('producto_stock').update({ stock_minimo: body.minimo }).eq('empresa_id', empresaId).eq('sucursal_id', sucursalId).eq('producto_id', productoId)
    if (error) { console.error('[stock] minimo', error.message); return err('No se pudo guardar el mínimo.', 500) }
    return NextResponse.json({ ok: true, producto_id: productoId, minimo: body.minimo })
  }

  // ── Iniciar el conteo: el SERVIDOR congela y guarda la base (snapshot) ──
  if (accion === 'iniciar') {
    const { data, error } = await supabase.rpc('iniciar_conteo_stock', { p_empresa_id: empresaId, p_sucursal_id: sucursalId, p_usuario_id: userId, p_usuario_nombre: nombre })
    if (error) { const t = traducirErrorAjuste(error); if (t.status === 500) console.error('[stock] iniciar', error.message); return err(t.error, t.status, { codigo: t.codigo }) }
    return NextResponse.json(data)
  }

  // ── E2-b: ajuste directo de UNA hoja (sucursal x presentación) de un producto en modelo 'rama' ──
  // La autorización de rol se re-valida en la base (_validar_usuario_stock); el saldo nunca queda negativo; idempotente por operacion_id.
  // ── STOCK POR SABOR EN KILOS (helado por kilo) ──
  // sabores: lista los sabores (opciones) de los grupos ligados a presentaciones con kilos, con los kg de ESTA sucursal.
  // kg_presentacion: cuántos kg representa una presentación (producto → toda la empresa: solo admin de empresa).
  // ajustar_sabor: fija o suma kilos de un sabor en esta sucursal (todo lo hace ajustar_stock_sabor).
  if (accion === 'sabores') {
    const { data: presKg, error: eP } = await supabase.from('presentaciones').select('id, nombre, producto_id, kg_por_unidad, activo, orden').eq('empresa_id', empresaId).eq('activo', true)
    if (eP) {
      if (eP.code === '42703') return err('El stock por sabor todavía no está habilitado en la base.', 503, { codigo: 'SIN_SQL' })
      console.error('[stock] sabores', eP.message); return err('No se pudieron leer los sabores.', 500)
    }
    const { data: pg } = await supabase.from('presentacion_grupos').select('presentacion_id, grupo_id').in('presentacion_id', (presKg ?? []).map(x => x.id as string))
    const conGrupos = new Set((pg ?? []).map(x => x.presentacion_id as string))
    const presSab0 = (presKg ?? []).filter(x => conGrupos.has(x.id as string))
    const prodIds = [...new Set(presSab0.map(x => x.producto_id as string))]
    const { data: prods } = prodIds.length ? await supabase.from('productos').select('id, nombre').in('id', prodIds).is('deleted_at', null) : { data: [] }
    const nomProd = new Map((prods ?? []).map(x => [x.id as string, x.nombre as string]))
    // Los baldes se venden cerrados: llevan stock por unidad, no kilos de sabor (salvo que ya tengan kilos cargados). Conos y helado por kilo sí descuentan kilos.
    const presSab = presSab0.filter(x => x.kg_por_unidad != null || !/balde/i.test(`${nomProd.get(x.producto_id as string) ?? ''} ${x.nombre}`))
    const grupoIds = [...new Set((pg ?? []).filter(x => presSab.some(p => p.id === x.presentacion_id && p.kg_por_unidad != null)).map(x => x.grupo_id as string))]
    const [{ data: grs }, { data: ops }, { data: stk }] = await Promise.all([
      grupoIds.length ? supabase.from('grupos_opciones').select('id, nombre, orden').in('id', grupoIds) : Promise.resolve({ data: [] }),
      grupoIds.length ? supabase.from('opciones').select('id, grupo_id, nombre, orden').eq('empresa_id', empresaId).in('grupo_id', grupoIds).eq('activo', true).is('deleted_at', null) : Promise.resolve({ data: [] }),
      supabase.from('stock_sabor').select('opcion_id, kg').eq('empresa_id', empresaId).eq('sucursal_id', sucursalId),
    ])
    const kgDe = new Map((stk ?? []).map(x => [x.opcion_id as string, Number(x.kg)]))
    const nomGrupo = new Map((grs ?? []).map(x => [x.id as string, x.nombre as string]))
    return NextResponse.json({
      puede_configurar: empresaCompleta,
      presentaciones: presSab.sort((a, b) => (nomProd.get(a.producto_id as string) ?? '').localeCompare(nomProd.get(b.producto_id as string) ?? '') || Number(a.orden ?? 0) - Number(b.orden ?? 0))
        .map(x => ({ id: x.id as string, producto: nomProd.get(x.producto_id as string) ?? '', nombre: x.nombre as string, kg: x.kg_por_unidad == null ? null : Number(x.kg_por_unidad) })),
      sabores: (ops ?? []).map(o => ({ id: o.id as string, nombre: o.nombre as string, grupo: nomGrupo.get(o.grupo_id as string) ?? '', orden: Number(o.orden ?? 0), kg: kgDe.has(o.id as string) ? kgDe.get(o.id as string)! : null }))
        .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.orden - b.orden || a.nombre.localeCompare(b.nombre)),
    })
  }
  if (accion === 'kg_presentacion') {
    if (!empresaCompleta) return err('Solo un administrador de toda la empresa puede cambiar los kilos de una presentación.', 403)
    const presId = body.presentacion_id
    if (typeof presId !== 'string' || !UUID_RE.test(presId)) return err('Presentación inválida.')
    const kg = body.kg === null ? null : body.kg
    if (kg !== null && (typeof kg !== 'number' || !isFinite(kg) || kg <= 0 || kg > 1000)) return err('Los kilos deben ser un número mayor a 0.')
    const { data: upd, error } = await supabase.from('presentaciones').update({ kg_por_unidad: kg === null ? null : Math.round(kg * 1000) / 1000 }).eq('id', presId).eq('empresa_id', empresaId).select('id').maybeSingle()
    if (error) { console.error('[stock] kg_presentacion', error.message); return err('No se pudo guardar.', 500) }
    if (!upd) return err('Presentación no encontrada.', 404)
    return NextResponse.json({ ok: true })
  }
  if (accion === 'ajustar_sabor') {
    const opId = body.opcion_id, operacionId = body.operacion_id
    if (typeof opId !== 'string' || !UUID_RE.test(opId)) return err('Sabor inválido.')
    if (typeof operacionId !== 'string' || !UUID_RE.test(operacionId)) return err('Falta el identificador de la operación.')
    if (body.modo !== 'set' && body.modo !== 'delta') return err('Modo de ajuste inválido.')
    if (typeof body.kg !== 'number' || !isFinite(body.kg) || Math.abs(body.kg) > 1_000_000) return err('Los kilos deben ser un número.')
    if (body.modo === 'set' && body.kg < 0) return err('Los kilos no pueden ser negativos.')
    const motivoS = typeof body.motivo === 'string' ? body.motivo.trim() : ''
    if (motivoS.length < 3 || motivoS.length > 200) return err('Indicá el motivo (3 a 200 caracteres).')
    {
      const { data: op } = await supabase.from('opciones').select('activo, deleted_at').eq('id', opId).eq('empresa_id', empresaId).maybeSingle()
      if (!op || op.activo !== true || op.deleted_at) return err('El sabor no está activo: activalo antes de cargarle kilos.', 409, { codigo: 'PRODUCTO_INACTIVO' })
    }
    const { data, error } = await supabase.rpc('ajustar_stock_sabor', {
      p_empresa_id: empresaId, p_sucursal_id: sucursalId, p_opcion_id: opId, p_modo: body.modo, p_kg: body.kg,
      p_motivo: motivoS, p_usuario_id: userId, p_usuario_nombre: nombre, p_operacion_id: operacionId,
    })
    if (error) {
      const m = error.message ?? ''
      if (error.code === 'PGRST202' || error.code === '42883') return err('El stock por sabor todavía no está habilitado en la base.', 503)
      if (m.includes('SALDO_NEGATIVO')) return err('No puede quedar en negativo.', 409)
      if (m.includes('SABOR_INVALIDO')) return err('Sabor no encontrado.', 404)
      if (m.includes('CANTIDAD_INVALIDA')) return err('Los kilos deben ser un número válido.')
      if (m.includes('USUARIO') || m.includes('PERMISO') || m.includes('NO_AUTORIZADO')) return err('No tenés permiso para ajustar el stock de esta sucursal.', 403)
      console.error('[stock] ajustar_sabor', m); return err('No se pudo guardar. Reintentá.', 500)
    }
    return NextResponse.json(data)
  }

  // ── Alta del modelo "stock por presentación" (rama): info previa + habilitación. Es del PRODUCTO (todas las sucursales): solo admin de toda la empresa ──
  if (accion === 'rama_info' || accion === 'habilitar_rama') {
    if (!empresaCompleta) return err('Solo un administrador de toda la empresa puede pasar un producto a stock por presentación.', 403)
    const productoId = body.producto_id
    if (typeof productoId !== 'string' || !UUID_RE.test(productoId)) return err('Producto inválido.')
    const { data: prod } = await supabase.from('productos').select('id, nombre, modelo_stock, deleted_at, activo').eq('id', productoId).eq('empresa_id', empresaId).maybeSingle()
    if (!prod || prod.deleted_at) return err('Producto no encontrado.', 404)
    if (prod.activo !== true) return err('El producto no está activo: activalo antes de cargarle stock.', 409, { codigo: 'PRODUCTO_INACTIVO' })
    if (prod.modelo_stock === 'rama') return err('Este producto ya tiene stock por presentación.', 409, { codigo: 'PRODUCTO_YA_RAMA' })
    const [rS, rP] = await Promise.all([
      supabase.rpc('_rama_conjunto_s', { p_empresa: empresaId, p_producto: productoId }),
      supabase.rpc('_rama_presentaciones_activas', { p_empresa: empresaId, p_producto: productoId }),
    ])
    if (rS.error || rP.error) { console.error('[stock] rama_info', rS.error?.message ?? rP.error?.message); return err('No se pudo leer el producto. Reintentá.', 500) }
    const sIds = (rS.data ?? []) as string[], pIds = (rP.data ?? []) as string[]

    if (accion === 'rama_info') {
      const [{ data: sucs }, { data: pres }, { data: saldos }, { data: grupos }, { data: arts }] = await Promise.all([
        sIds.length ? supabase.from('sucursales').select('id, nombre').in('id', sIds) : Promise.resolve({ data: [] }),
        pIds.length ? supabase.from('presentaciones').select('id, nombre, factor_stock, orden').in('id', pIds).order('orden') : Promise.resolve({ data: [] }),
        supabase.from('producto_stock').select('sucursal_id, cantidad').eq('producto_id', productoId),
        supabase.from('presentaciones').select('id, presentacion_grupos(id)').eq('producto_id', productoId),
        supabase.from('articulos').select('id').eq('producto_id', productoId).eq('activo', true).is('deleted_at', null).limit(1),
      ])
      const bloqueos: string[] = []
      if (pIds.length === 0) bloqueos.push('El producto no tiene presentaciones activas.')
      const raros = (pres ?? []).filter(x => Number(x.factor_stock) !== 1)
      if (raros.length) bloqueos.push(`Estas presentaciones descuentan más de 1 unidad del producto (${raros.map(x => x.nombre).join(', ')}). Para stock por presentación tienen que descontar 1.`)
      if ((grupos ?? []).some(g => Array.isArray((g as { presentacion_grupos?: unknown[] }).presentacion_grupos) && ((g as { presentacion_grupos: unknown[] }).presentacion_grupos).length > 0))
        bloqueos.push('El producto tiene opciones (por ejemplo sabores). Si se vende por unidad (por ejemplo baldes), activá el tilde «Ctrl.» y cargalo en Ajuste general. Si es helado por kilo, usá la pestaña «Sabores (kg)».')
      if ((arts ?? []).length) bloqueos.push('El producto está vinculado a un artículo de compras.')
      const saldoDe = new Map((saldos ?? []).map(x => [x.sucursal_id as string, Number(x.cantidad)]))
      return NextResponse.json({
        producto: { id: prod.id, nombre: prod.nombre },
        sucursales: (sucs ?? []).map(x => ({ id: x.id as string, nombre: x.nombre as string, saldo: saldoDe.get(x.id as string) ?? 0 })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
        presentaciones: (pres ?? []).map(x => ({ id: x.id as string, nombre: x.nombre as string })),
        bloqueos,
      })
    }

    const operacionId = body.operacion_id
    if (typeof operacionId !== 'string' || !UUID_RE.test(operacionId)) return err('Falta el identificador de la operación.')
    const motivoH = typeof body.motivo === 'string' ? body.motivo.trim() : ''
    if (motivoH.length < 3 || motivoH.length > 200) return err('Indicá el motivo del alta (3 a 200 caracteres).')
    const conteos = body.conteos
    if (!Array.isArray(conteos) || conteos.length === 0 || conteos.length > 500) return err('Faltan las cantidades.')
    const conteosOk: { sucursal_id: string; presentacion_id: string; cantidad: number }[] = []
    for (const c of conteos as Record<string, unknown>[]) {
      if (typeof c?.sucursal_id !== 'string' || !UUID_RE.test(c.sucursal_id) || typeof c?.presentacion_id !== 'string' || !UUID_RE.test(c.presentacion_id)) return err('Conteo inválido.')
      if (typeof c.cantidad !== 'number' || !Number.isInteger(c.cantidad) || c.cantidad < 0 || c.cantidad > 1_000_000) return err('Las cantidades deben ser números enteros de 0 en adelante.')
      conteosOk.push({ sucursal_id: c.sucursal_id, presentacion_id: c.presentacion_id, cantidad: c.cantidad })
    }
    const decisiones = sIds.map(s => ({ sucursal_id: s, decision: 'contar', motivo: motivoH }))
    const { data, error } = await supabase.rpc('habilitar_modelo_rama', {
      p_empresa_id: empresaId, p_producto_id: productoId, p_usuario_id: userId, p_usuario_nombre: nombre,
      p_operacion_id: operacionId, p_decisiones: decisiones, p_conteos: conteosOk,
    })
    if (error) {
      const m = error.message ?? ''
      const mapa: [string, string, number][] = [
        ['HABILITACION_BLOQUEADA', 'El producto no se puede pasar a stock por presentación todavía (opciones, factor, artículo vinculado o una operación de stock pendiente). Abrí de nuevo el panel para ver el detalle.', 409],
        ['PRODUCTO_YA_RAMA', 'Este producto ya tiene stock por presentación.', 409],
        ['COBERTURA_', 'Cambiaron las sucursales o presentaciones. Cerrá el panel, abrilo de nuevo y reintentá.', 409],
        ['CONJUNTO_CAMBIO', 'Cambiaron las sucursales o presentaciones. Reintentá.', 409],
        ['OPERACION', 'Esta operación ya se usó con otros datos. Cerrá el panel y volvé a abrirlo.', 409],
        ['CANTIDAD_INVALIDA', 'Las cantidades deben ser números enteros de 0 en adelante.', 400],
        ['MOTIVO_REQUERIDO', 'Indicá el motivo del alta.', 400],
      ]
      const hit = mapa.find(([k]) => m.includes(k))
      if (hit) return err(hit[1], hit[2], { codigo: hit[0].replace(/_$/, '') })
      console.error('[stock] habilitar_rama', m)
      return err('No se pudo habilitar. No se modificó el stock. Reintentá.', 500)
    }
    return NextResponse.json(data)
  }

  if (accion === 'ajustar_rama') {
    const presId = body.presentacion_id, operacionId = body.operacion_id
    if (typeof presId !== 'string' || !UUID_RE.test(presId)) return err('Presentación inválida.')
    if (typeof operacionId !== 'string' || !UUID_RE.test(operacionId)) return err('Falta el identificador de la operación.')
    if (body.modo !== 'set' && body.modo !== 'delta') return err('Modo de ajuste inválido.')
    if (typeof body.cantidad !== 'number' || !Number.isInteger(body.cantidad) || Math.abs(body.cantidad) > 1_000_000) return err('La cantidad debe ser un número entero.')
    const motivoR = typeof body.motivo === 'string' ? body.motivo.trim() : ''
    if (motivoR.length < 3 || motivoR.length > 200) return err('Indicá el motivo del ajuste (3 a 200 caracteres).')
    const obs = typeof body.observacion === 'string' && body.observacion.trim() ? body.observacion.trim().slice(0, 300) : null
    {
      const { data: pr } = await supabase.from('presentaciones').select('activo, productos(activo)').eq('id', presId).eq('empresa_id', empresaId).maybeSingle()
      const prodAct = (pr as { productos?: { activo?: boolean } | null } | null)?.productos?.activo
      if (!pr || pr.activo !== true || prodAct !== true) return err('El producto o la presentación no está activo: no se le puede cargar stock.', 409, { codigo: 'PRODUCTO_INACTIVO' })
    }
    const { data, error } = await supabase.rpc('ajustar_stock_rama', {
      p_empresa_id: empresaId, p_sucursal_id: sucursalId, p_presentacion_id: presId, p_modo: body.modo, p_cantidad: body.cantidad,
      p_motivo: motivoR, p_observacion: obs, p_usuario_id: userId, p_usuario_nombre: nombre, p_operacion_id: operacionId,
    })
    if (error) { const t = traducirErrorAjuste(error); if (t.status === 500) console.error('[stock] ajustar_rama', error.message); return err(t.error, t.status, { codigo: t.codigo }) }
    return NextResponse.json(data)
  }

  // ── Ajuste general: previsualizar y aplicar (la base sale del snapshot del servidor, no del navegador) ──
  if (accion === 'previsualizar' || accion === 'aplicar') {
    const loteId = body.lote_id
    if (typeof loteId !== 'string' || !UUID_RE.test(loteId)) return err('Falta iniciar el conteo.')
    const eItems = validarItems(body.items); if (eItems) return err(eItems)
    const eMotivo = validarMotivo(body.motivo_tipo, body.descripcion); if (eMotivo) return err(eMotivo)
    const motivo = body.motivo_tipo as string
    const descripcion = typeof body.descripcion === 'string' ? body.descripcion : null
    // E2-b: el ajuste general trabaja sobre producto_stock; los productos en modelo 'rama' se ajustan por hoja (acción ajustar_rama)
    {
      const idsAj = (body.items as { producto_id: string }[]).map(i => i.producto_id)
      const { data: ramas, error: eRamas } = await supabase.from('productos').select('id').eq('empresa_id', empresaId).eq('modelo_stock', 'rama').in('id', idsAj)
      if (eRamas) { console.error('[stock] modelo', eRamas.message); return err('No se pudo validar el ajuste. No se modificó el stock. Reintentá.', 500) }
      const { data: inact, error: eInact } = await supabase.from('productos').select('id').eq('empresa_id', empresaId).eq('activo', false).in('id', idsAj)
      if (eInact) { console.error('[stock] activo', eInact.message); return err('No se pudo validar el ajuste. No se modificó el stock. Reintentá.', 500) }
      if ((inact ?? []).length > 0) return err('Hay productos inactivos en el ajuste: activalos o sacalos antes de cargar stock.', 409, { codigo: 'PRODUCTO_INACTIVO' })
      if ((ramas ?? []).length > 0) return err('Hay productos con stock por rama: se ajustan desde Inventario, en cada presentación.', 409, { codigo: 'PRODUCTO_MODELO_RAMA' })
    }

    if (accion === 'previsualizar') {
      const { data, error } = await supabase.rpc('previsualizar_ajuste_stock', {
        p_empresa_id: empresaId, p_sucursal_id: sucursalId, p_lote_id: loteId, p_motivo_tipo: motivo, p_descripcion: descripcion, p_items: soloContados(body.items),
      })
      if (error) { const t = traducirErrorAjuste(error); if (t.status === 500) console.error('[stock] previsualizar', error.message); return err(t.error, t.status, { codigo: t.codigo }) }
      return NextResponse.json(data)
    }

    const huella = typeof body.huella_confirmada === 'string' && /^[0-9a-f]{64}$/.test(body.huella_confirmada) ? body.huella_confirmada : null
    const { data, error } = await supabase.rpc('aplicar_ajuste_stock', {
      p_empresa_id: empresaId, p_sucursal_id: sucursalId, p_lote_id: loteId, p_usuario_id: userId, p_usuario_nombre: nombre,
      p_motivo_tipo: motivo, p_descripcion: descripcion, p_items: soloContados(body.items), p_huella_confirmada: huella,
    })
    if (error) { const t = traducirErrorAjuste(error); if (t.status === 500) console.error('[stock] aplicar', error.message); return err(t.error, t.status, { codigo: t.codigo }) }
    return NextResponse.json(data)
  }

  // ── Movimientos con trazabilidad ──
  if (accion === 'movimientos') {
    const limite = Math.min(Math.max(Number(body.limite) || 50, 1), 200)
    const pagina = Math.max(Number(body.pagina) || 0, 0)
    let q = supabase.from('stock_movimientos').select('id, producto_id, articulo_id, delta, motivo, pedido_id, detalle, created_at, ajuste_id, usuario_id')
      .eq('empresa_id', empresaId).eq('sucursal_id', sucursalId).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(pagina * limite, pagina * limite + limite)
    if (typeof body.producto_id === 'string' && UUID_RE.test(body.producto_id)) q = q.eq('producto_id', body.producto_id)
    if (typeof body.motivo === 'string' && ['venta', 'devolucion', 'compra', 'devolucion_compra', 'ajuste', 'arqueo', 'ingreso'].includes(body.motivo)) q = q.eq('motivo', body.motivo)
    const { data: movs, error } = await q
    if (error) { console.error('[stock] movimientos', error.message); return err('No se pudieron leer los movimientos.', 500) }
    const filas = movs ?? []
    const hay = filas.length > limite
    const pagina_ = filas.slice(0, limite)

    const ids = <T,>(k: string) => [...new Set(pagina_.map(m => (m as Record<string, unknown>)[k]).filter((v): v is T => !!v))]
    const prodIds = ids<string>('producto_id'), artIds = ids<string>('articulo_id'), pedIds = ids<string>('pedido_id'), loteIds = ids<string>('ajuste_id')
    const [pr, ar, pe, lo] = await Promise.all([
      prodIds.length ? supabase.from('productos').select('id, nombre').in('id', prodIds) : Promise.resolve({ data: [] }),
      artIds.length ? supabase.from('articulos').select('id, nombre').in('id', artIds) : Promise.resolve({ data: [] }),
      pedIds.length ? supabase.from('pedidos').select('id, numero_pedido, origen, operator_session_id, dispositivo_id').eq('empresa_id', empresaId).in('id', pedIds) : Promise.resolve({ data: [] }),
      loteIds.length ? supabase.from('stock_ajustes').select('id, usuario_nombre, motivo_tipo, descripcion').eq('empresa_id', empresaId).in('id', loteIds) : Promise.resolve({ data: [] }),
    ])
    const sesIds = [...new Set((pe.data ?? []).map(p => p.operator_session_id).filter(Boolean) as string[])]
    const dispIds = [...new Set((pe.data ?? []).map(p => p.dispositivo_id).filter(Boolean) as string[])]
    const [se, di] = await Promise.all([
      sesIds.length ? supabase.from('operator_sessions').select('id, operador_id').in('id', sesIds) : Promise.resolve({ data: [] }),
      dispIds.length ? supabase.from('dispositivos').select('id, nombre, tipo').in('id', dispIds) : Promise.resolve({ data: [] }),
    ])
    const opIds = [...new Set((se.data ?? []).map(s => s.operador_id).filter(Boolean) as string[])]
    const op = opIds.length ? await supabase.from('operadores').select('id, nombre').in('id', opIds) : { data: [] }

    const mProd = new Map((pr.data ?? []).map(x => [x.id, x.nombre])), mArt = new Map((ar.data ?? []).map(x => [x.id, x.nombre]))
    const mPed = new Map((pe.data ?? []).map(x => [x.id, x])), mLote = new Map((lo.data ?? []).map(x => [x.id, x]))
    const mSes = new Map((se.data ?? []).map(x => [x.id, x.operador_id])), mDisp = new Map((di.data ?? []).map(x => [x.id, x]))
    const mOp = new Map((op.data ?? []).map(x => [x.id, x.nombre]))

    const NO_REG = 'No registrado'
    const items = pagina_.map(m => {
      let responsable = NO_REG, motivoTipo: string | null = null, descripcion: string | null = null
      if (m.motivo === 'ajuste' && m.ajuste_id) {
        const l = mLote.get(m.ajuste_id); responsable = l?.usuario_nombre || 'Administrador'; motivoTipo = l?.motivo_tipo ?? null; descripcion = l?.descripcion ?? null
      } else if (m.motivo === 'venta' && m.pedido_id) {
        // Cruce con el pedido: solo posible mientras el pedido exista (si se eliminó, el pedido ya no está)
        const p = mPed.get(m.pedido_id)
        if (p) {
          const opn = p.operator_session_id ? mOp.get(mSes.get(p.operator_session_id) ?? '') : null
          const d = p.dispositivo_id ? mDisp.get(p.dispositivo_id) : null
          responsable = opn ? `Caja: ${opn}` : d ? `${d.tipo === 'KIOSK' ? 'Kiosco' : d.tipo === 'CAJA' ? 'Caja' : 'Dispositivo'}: ${d.nombre}` : (p.origen === 'ONLINE' || p.origen === 'APP') ? 'Cliente (online)' : NO_REG
        }
      }
      return { id: m.id, fecha: m.created_at, tipo: m.motivo, delta: Number(m.delta), detalle: m.detalle,
        producto: m.producto_id ? (mProd.get(m.producto_id) ?? null) : m.articulo_id ? (mArt.get(m.articulo_id) ?? null) : null,
        es_articulo: !m.producto_id && !!m.articulo_id, responsable, lote_id: m.ajuste_id ?? null, motivo_tipo: motivoTipo, descripcion }
    })
    return NextResponse.json({ items, hay_mas: hay, pagina })
  }

  return err('Acción no válida.')
}
