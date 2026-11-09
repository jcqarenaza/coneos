import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { UUID_RE, validarItems, validarMotivo, soloContados, estadoStock, traducirErrorAjuste } from '@/lib/stock/ajuste'

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
// (que usa ajustar_stock): esta ruta no escribe stock por su cuenta.
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

  return { supabase, userId, nombre: (ua.nombre as string | undefined) ?? null, sucursales }
}

export async function POST(request: Request) {
  const a = await autorizar(request)
  if ('fail' in a && a.fail) return a.fail
  const { supabase, userId, nombre, sucursales } = a as Exclude<typeof a, { fail: NextResponse }>

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const accion = body.accion

  if (accion === 'sucursales') {
    return NextResponse.json({ sucursales: sucursales.map(s => ({ id: s.id, nombre: s.nombre })) })
  }

  const sucursalId = body.sucursal_id
  if (typeof sucursalId !== 'string' || !UUID_RE.test(sucursalId)) return err('Elegí una sucursal.')
  const suc = sucursales.find(s => s.id === sucursalId)
  if (!suc) return err('No tenés acceso a esa sucursal.', 403)
  const empresaId = suc.empresa_id

  // ── Inventario: existencias, mínimo y estado por sucursal ──
  if (accion === 'inventario') {
    const [{ data: prods }, { data: cats }, { data: filas }] = await Promise.all([
      supabase.from('productos').select('id, nombre, categoria_id').eq('empresa_id', empresaId).eq('controla_stock', true).eq('activo', true).is('deleted_at', null).order('nombre'),
      supabase.from('categorias').select('id, nombre, orden').eq('empresa_id', empresaId).order('orden'),
      supabase.from('producto_stock').select('producto_id, cantidad, stock_minimo, updated_at').eq('empresa_id', empresaId).eq('sucursal_id', sucursalId),
    ])
    const porProducto = new Map((filas ?? []).map(f => [f.producto_id as string, f]))
    const catNombre = new Map((cats ?? []).map(c => [c.id as string, c.nombre as string]))
    const items = (prods ?? []).map(p => {
      const f = porProducto.get(p.id as string)
      const cantidad = f ? Number(f.cantidad) : null
      const minimo = f ? Number(f.stock_minimo) : null
      return { producto_id: p.id, nombre: p.nombre, categoria_id: p.categoria_id, categoria: catNombre.get(p.categoria_id as string) ?? null,
        cantidad, minimo, estado: estadoStock(cantidad, minimo), actualizado: f?.updated_at ?? null }
    })
    return NextResponse.json({ sucursal: { id: suc.id, nombre: suc.nombre }, ahora: new Date().toISOString(), items,
      categorias: (cats ?? []).map(c => ({ id: c.id, nombre: c.nombre })) })
  }

  // ── Iniciar el conteo: el SERVIDOR congela y guarda la base (snapshot) ──
  if (accion === 'iniciar') {
    const { data, error } = await supabase.rpc('iniciar_conteo_stock', { p_empresa_id: empresaId, p_sucursal_id: sucursalId, p_usuario_id: userId, p_usuario_nombre: nombre })
    if (error) { const t = traducirErrorAjuste(error); if (t.status === 500) console.error('[stock] iniciar', error.message); return err(t.error, t.status, { codigo: t.codigo }) }
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
    if (typeof body.motivo === 'string' && ['venta', 'devolucion', 'compra', 'devolucion_compra', 'ajuste', 'arqueo'].includes(body.motivo)) q = q.eq('motivo', body.motivo)
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
