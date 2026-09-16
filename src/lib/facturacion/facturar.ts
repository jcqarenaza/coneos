// ============================================================
// 9c — HOOK DE FACTURACIÓN COMPARTIDO
// Reubicado desde /api/pedidos/estado SIN MODIFICAR (cuerpos
// byte-idénticos): la venta manual de caja (nace cobrada, no pasa
// por el estado route) necesita disparar la misma facturación.
// ============================================================
import { createAdminClient } from '@/lib/supabase/admin'

export async function resolverFactConfig(supabase: ReturnType<typeof createAdminClient>, empresaId: string, sucursalId: string | null, columnas: string) {
  if (sucursalId) {
    const { data } = await supabase.from('facturacion_config')
      .select(columnas).eq('empresa_id', empresaId).eq('sucursal_id', sucursalId).maybeSingle()
    if (data) return data
  }
  const { data } = await supabase.from('facturacion_config')
    .select(columnas).eq('empresa_id', empresaId).is('sucursal_id', null).maybeSingle()
  return data
}

export async function facturarSiCorresponde(pedido_id: string) {
  try {
    const supabase = createAdminClient()
    const { data: pedido } = await supabase.from('pedidos')
      .select('empresa_id, sucursal_id, metodo_pago, receptor_doc_tipo, receptor_doc_nro, receptor_cond_iva')
      .eq('id', pedido_id).maybeSingle()
    if (!pedido?.metodo_pago) return
    const cfg = await resolverFactConfig(supabase, pedido.empresa_id, pedido.sucursal_id ?? null,
      'activo, auto_facturar, metodos_auto, cert_pem, key_pem') as
      { activo: boolean; auto_facturar: boolean | null; metodos_auto: unknown; cert_pem: string | null; key_pem: string | null } | null
    if (!cfg?.activo || !cfg.cert_pem || !cfg.key_pem) return
    if (cfg.auto_facturar === false) return
    const metodos = Array.isArray(cfg.metodos_auto) ? cfg.metodos_auto as string[] : ['transferencia']
    if (!metodos.includes(pedido.metodo_pago)) return

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return
    // FA-1: si el pedido tiene receptor fiscal, viajan los parámetros que la
    // Edge YA acepta (docTipo/docNro/condIvaReceptor). Sin receptor: body
    // idéntico al de siempre.
    const conReceptor = pedido.receptor_doc_nro
      ? { docTipo: pedido.receptor_doc_tipo ?? 80, docNro: pedido.receptor_doc_nro, condIvaReceptor: pedido.receptor_cond_iva ?? 5 }
      : {}
    const res = await fetch(`${url}/functions/v1/arca-facturar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: pedido.empresa_id, pedido_id, accion: 'facturar', ...conReceptor }),
    })
    const d = await res.json().catch(() => null)
    console.log('[facturacion]', pedido_id, d?.ok ? `CAE ${d.cae} Nro ${d.nro_cbte}` : (d?.error ?? 'sin respuesta'))
  } catch (e) {
    console.error('[facturacion] hook error', e)
  }
}
