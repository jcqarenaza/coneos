import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Cobro de pedidos de MESA desde la caja (F2).
// POST { pedido_ids: string[], metodo_pago: 'efectivo'|'debito'|'credito'|'transferencia' }
// Marca pagado=true + método en esos pedidos, dispara facturación automática si
// corresponde, y si la cuenta queda toda saldada la CIERRA (mesa liberada).

const METODOS = ['efectivo', 'debito', 'credito', 'transferencia']

async function facturarSiCorresponde(supabase: ReturnType<typeof createAdminClient>, pedido_id: string) {
  try {
    const { data: pedido } = await supabase.from('pedidos')
      .select('empresa_id, sucursal_id, metodo_pago').eq('id', pedido_id).maybeSingle()
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
      body: JSON.stringify({ empresa_id: pedido.empresa_id, pedido_id, accion: 'facturar' }),
    })
    const d = await res.json().catch(() => null)
    console.log('[mesa/cobrar][facturacion]', pedido_id, d?.ok ? `CAE ${d.cae}` : (d?.error ?? 'sin respuesta'))
  } catch (e) {
    console.error('[mesa/cobrar][facturacion] hook error', e)
  }
}

export async function POST(request: Request) {
  const { pedido_ids, metodo_pago } = await request.json()
  if (!Array.isArray(pedido_ids) || pedido_ids.length === 0) {
    return NextResponse.json({ error: 'Sin pedidos para cobrar' }, { status: 400 })
  }
  if (!METODOS.includes(metodo_pago)) {
    return NextResponse.json({ error: 'Método de pago inválido' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Solo pedidos de mesa realmente pendientes (evita doble cobro)
  const { data: pendientes } = await supabase.from('pedidos')
    .select('id, mesa_cuenta_id')
    .in('id', pedido_ids)
    .eq('pagado', false)
    .not('mesa_cuenta_id', 'is', null)

  if (!pendientes || pendientes.length === 0) {
    return NextResponse.json({ error: 'Esos pedidos ya están cobrados' }, { status: 409 })
  }

  const ids = pendientes.map(p => p.id)
  const { error } = await supabase.from('pedidos')
    .update({ pagado: true, metodo_pago })
    .in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Facturación automática por cada pedido cobrado (misma lógica que estado/webhook)
  for (const id of ids) await facturarSiCorresponde(supabase, id)

  // Cerrar cuentas que quedaron totalmente saldadas
  const cuentas = [...new Set(pendientes.map(p => p.mesa_cuenta_id).filter(Boolean))] as string[]
  const cerradas: string[] = []
  for (const cuentaId of cuentas) {
    const { data: quedan } = await supabase.from('pedidos')
      .select('id').eq('mesa_cuenta_id', cuentaId).eq('pagado', false).limit(1).maybeSingle()
    if (!quedan) {
      await supabase.from('mesa_cuentas')
        .update({ estado: 'cerrada', closed_at: new Date().toISOString() }).eq('id', cuentaId)
      cerradas.push(cuentaId)
    }
  }

  return NextResponse.json({ ok: true, cobrados: ids.length, cuentas_cerradas: cerradas.length })
}
