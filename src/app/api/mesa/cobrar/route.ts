import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Cobro de pedidos de MESA (F2.5): admite PAGO DIVIDIDO entre varios medios.
// POST { pedido_ids: string[], pagos: [{ metodo, monto }] }
//   (retrocompatible: { pedido_ids, metodo_pago } = un solo pago por el total)
// La suma de pagos debe igualar el total de los pedidos seleccionados.
// Cada pago se registra en pedido_pagos; el metodo_pago del pedido queda con el
// medio que más cubrió ese pedido (para resumen/facturación legacy).

const METODOS = ['efectivo', 'debito', 'credito', 'transferencia']

// FA-1: validación de CUIT (estructural + dígito verificador), server-side.
function cuitValido(cuit: string): boolean {
  const d = (cuit ?? '').replace(/\D/g, '')
  if (d.length !== 11) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = mult.reduce((a, m, i) => a + m * Number(d[i]), 0)
  const resto = 11 - (suma % 11)
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto
  return dv === Number(d[10])
}
const CONDS_VALIDAS = [1, 4, 5, 6]

async function facturarSiCorresponde(supabase: ReturnType<typeof createAdminClient>, pedido_id: string) {
  try {
    const { data: pedido } = await supabase.from('pedidos')
      .select('empresa_id, sucursal_id, metodo_pago, receptor_doc_tipo, receptor_doc_nro, receptor_cond_iva').eq('id', pedido_id).maybeSingle()
    if (!pedido?.metodo_pago) return
    const cols = 'activo, auto_facturar, metodos_auto, cert_pem, key_pem'
    type Cfg = { activo: boolean; auto_facturar: boolean | null; metodos_auto: unknown; cert_pem: string | null; key_pem: string | null }
    let cfg: Cfg | null = null
    if (pedido.sucursal_id) {
      const { data } = await supabase.from('facturacion_config')
        .select(cols).eq('empresa_id', pedido.empresa_id).eq('sucursal_id', pedido.sucursal_id).maybeSingle()
      cfg = data as Cfg | null
    }
    if (!cfg) {
      const { data } = await supabase.from('facturacion_config')
        .select(cols).eq('empresa_id', pedido.empresa_id).is('sucursal_id', null).maybeSingle()
      cfg = data as Cfg | null
    }
    if (!cfg?.activo || !cfg.cert_pem || !cfg.key_pem) return
    if (cfg.auto_facturar === false) return
    const metodos = Array.isArray(cfg.metodos_auto) ? cfg.metodos_auto as string[] : ['transferencia']
    if (!metodos.includes(pedido.metodo_pago)) return
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return
    const res = await fetch(`${url}/functions/v1/arca-facturar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: pedido.empresa_id, pedido_id, accion: 'facturar', ...(pedido.receptor_doc_nro ? { docTipo: pedido.receptor_doc_tipo ?? 80, docNro: pedido.receptor_doc_nro, condIvaReceptor: pedido.receptor_cond_iva ?? 5 } : {}) }),
    })
    const d = await res.json().catch(() => null)
    console.log('[mesa/cobrar][facturacion]', pedido_id, d?.ok ? `CAE ${d.cae}` : (d?.error ?? 'sin respuesta'))
  } catch (e) {
    console.error('[mesa/cobrar][facturacion] hook error', e)
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const pedido_ids: string[] = body.pedido_ids
  const receptor = body.receptor ?? null
  let pagos: { metodo: string; monto: number }[] = body.pagos

  if (!Array.isArray(pedido_ids) || pedido_ids.length === 0) {
    return NextResponse.json({ error: 'Sin pedidos para cobrar' }, { status: 400 })
  }
  // Retrocompatibilidad: un solo método sin montos
  if (!Array.isArray(pagos) || pagos.length === 0) {
    if (!body.metodo_pago) return NextResponse.json({ error: 'Faltan los pagos' }, { status: 400 })
    pagos = [{ metodo: body.metodo_pago, monto: -1 }] // -1 = por el total (se resuelve abajo)
  }
  for (const pg of pagos) {
    if (!METODOS.includes(pg.metodo)) return NextResponse.json({ error: `Método inválido: ${pg.metodo}` }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: pendientes } = await supabase.from('pedidos')
    .select('id, total, empresa_id, mesa_cuenta_id, created_at, receptor_doc_nro')
    .in('id', pedido_ids)
    .eq('pagado', false)
    .not('mesa_cuenta_id', 'is', null)
    .order('created_at')

  if (!pendientes || pendientes.length === 0) {
    return NextResponse.json({ error: 'Esos pedidos ya están cobrados' }, { status: 409 })
  }

  const totalSel = pendientes.reduce((a, p) => a + Number(p.total), 0)
  if (pagos.length === 1 && pagos[0].monto === -1) pagos[0].monto = totalSel
  const totalPagos = pagos.reduce((a, p) => a + Number(p.monto), 0)
  if (Math.abs(totalPagos - totalSel) > 0.01) {
    return NextResponse.json({ error: `Los pagos suman $${totalPagos.toLocaleString('es-AR')} pero lo seleccionado es $${totalSel.toLocaleString('es-AR')}` }, { status: 400 })
  }
  for (const pg of pagos) {
    if (!(Number(pg.monto) > 0)) return NextResponse.json({ error: 'Todos los montos deben ser mayores a 0' }, { status: 400 })
  }

  // ── FA-1: receptor fiscal de la operación ──
  // Regla (decisión CTO): todos los pedidos cobrados en una misma operación
  // llevan el MISMO receptor. Mezclas se RECHAZAN (cobro separado) — nunca se
  // elige un receptor silenciosamente.
  let receptorLimpio: { doc_nro: string; cond_iva: number; razon_social: string; detalle: string | null } | null = null
  if (receptor) {
    const docNro = String(receptor.doc_nro ?? '').replace(/\D/g, '')
    const condIva = Number(receptor.cond_iva)
    const razon = String(receptor.razon_social ?? '').trim()
    if (!cuitValido(docNro)) return NextResponse.json({ error: 'CUIT inválido' }, { status: 400 })
    if (!CONDS_VALIDAS.includes(condIva)) return NextResponse.json({ error: 'Condición IVA inválida' }, { status: 400 })
    if (!razon) return NextResponse.json({ error: 'Falta la razón social del receptor' }, { status: 400 })
    receptorLimpio = { doc_nro: docNro, cond_iva: condIva, razon_social: razon, detalle: String(receptor.detalle_facturable ?? '').trim() || null }
  }
  const receptoresExistentes = [...new Set(pendientes.map(p => p.receptor_doc_nro).filter(Boolean))] as string[]
  if (receptoresExistentes.length > 1) {
    return NextResponse.json({ error: 'Los pedidos seleccionados tienen receptores fiscales distintos — cobralos por separado' }, { status: 409 })
  }
  if (receptorLimpio && receptoresExistentes.length === 1 && receptoresExistentes[0] !== receptorLimpio.doc_nro) {
    return NextResponse.json({ error: 'Un pedido seleccionado ya tiene otro receptor fiscal — cobralo por separado' }, { status: 409 })
  }

  // Asignar pagos a pedidos en orden (cascada): cada pedido consume de la cola
  // de pagos hasta cubrirse. Registra el desglose real en pedido_pagos.
  const cola = pagos.map(p => ({ metodo: p.metodo, resto: Number(p.monto) }))
  let iCola = 0
  const inserts: { empresa_id: string; pedido_id: string; metodo: string; monto: number }[] = []
  const metodoPrincipal: Record<string, string> = {}
  for (const ped of pendientes) {
    let falta = Number(ped.total)
    const porMetodo: Record<string, number> = {}
    while (falta > 0.009 && iCola < cola.length) {
      const c = cola[iCola]
      const usa = Math.min(falta, c.resto)
      if (usa > 0) {
        inserts.push({ empresa_id: ped.empresa_id, pedido_id: ped.id, metodo: c.metodo, monto: Math.round(usa * 100) / 100 })
        porMetodo[c.metodo] = (porMetodo[c.metodo] ?? 0) + usa
        c.resto -= usa
        falta -= usa
      }
      if (c.resto <= 0.009) iCola++
    }
    metodoPrincipal[ped.id] = Object.entries(porMetodo).sort((a, b) => b[1] - a[1])[0]?.[0] ?? pagos[0].metodo
  }

  const { error: errPagos } = await supabase.from('pedido_pagos').insert(inserts)
  if (errPagos) return NextResponse.json({ error: errPagos.message }, { status: 500 })

  // FA-1: persistir receptor ANTES del pago/facturación (orden crítico)
  if (receptorLimpio) {
    await supabase.from('pedidos').update({
      receptor_doc_tipo: 80,
      receptor_doc_nro: receptorLimpio.doc_nro,
      receptor_cond_iva: receptorLimpio.cond_iva,
      receptor_razon_social: receptorLimpio.razon_social,
      detalle_facturable: receptorLimpio.detalle,
    }).in('id', pendientes.map(ped => ped.id))
  }

  for (const ped of pendientes) {
    await supabase.from('pedidos')
      .update({ pagado: true, metodo_pago: metodoPrincipal[ped.id] })
      .eq('id', ped.id)
  }

  for (const ped of pendientes) await facturarSiCorresponde(supabase, ped.id)

  const cuentas = [...new Set(pendientes.map(p => p.mesa_cuenta_id).filter(Boolean))] as string[]
  let cerradas = 0
  for (const cuentaId of cuentas) {
    const { data: quedan } = await supabase.from('pedidos')
      .select('id').eq('mesa_cuenta_id', cuentaId).eq('pagado', false).limit(1).maybeSingle()
    if (!quedan) {
      await supabase.from('mesa_cuentas')
        .update({ estado: 'cerrada', closed_at: new Date().toISOString() }).eq('id', cuentaId)
      cerradas++
    }
  }

  return NextResponse.json({ ok: true, cobrados: pendientes.length, cuentas_cerradas: cerradas })
}
