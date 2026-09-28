// ============================================================
// 9c — HOOK DE FACTURACIÓN COMPARTIDO
// Reubicado desde /api/pedidos/estado SIN MODIFICAR (cuerpos
// byte-idénticos): la venta manual de caja (nace cobrada, no pasa
// por el estado route) necesita disparar la misma facturación.
// ============================================================
import { createAdminClient } from '@/lib/supabase/admin'

// ══ MULTI-CUIT B1 (JC 25/09) — RESOLUCIÓN ÚNICA ══
// Este archivo es LA única casa de la resolución del emisor fiscal.
// Las copias de /api/facturacion/emitir y /api/mp/webhook MURIERON: importan
// de acá. En B1 el comportamiento es BYTE-IDÉNTICO al histórico (sucursal →
// marca). La prioridad cuenta→config entra en B2, junto con la Edge que
// honra el emisor — jamás por separado (mitad de la cadena = CUIT cruzado).

export async function resolverFactConfig(supabase: ReturnType<typeof createAdminClient>, empresaId: string, sucursalId: string | null, columnas: string) {
  // B2: el fallback SOLO ve configs es_fallback=true — un CUIT adicional
  // (cargado por la tab) jamás secuestra la resolución por sucursal (T4).
  // La fila histórica de cada cliente es true por default: byte-idéntico.
  if (sucursalId) {
    const { data } = await supabase.from('facturacion_config')
      .select(columnas).eq('empresa_id', empresaId).eq('sucursal_id', sucursalId)
      .eq('es_fallback', true).maybeSingle()
    if (data) return data
  }
  const { data } = await supabase.from('facturacion_config')
    .select(columnas).eq('empresa_id', empresaId).is('sucursal_id', null)
    .eq('es_fallback', true).maybeSingle()
  return data
}

// ══ B2 — EL RESOLVER DEL EMISOR (única fuente, para EMISIÓN NUEVA; la NC no
// lo llama: recupera el emisor de su factura original) ══
// Prioridad: ① cuenta del pedido con facturacion_config_id → ESA config,
// exigiendo estado='validado' (sin fallback silencioso hacia otra cuenta ni
// hacia la marca si la config vinculada no está en condiciones: eso es un
// error visible, no una factura del CUIT equivocado) · ② sin cuenta o cuenta
// sin vínculo → resolverFactConfig (sucursal→marca), comportamiento histórico.
// Devuelve la config con su id; el caller decide sobre activo/auto/metodos.
type PedidoFiscal = { empresa_id: string; sucursal_id: string | null; metodo_pago: string | null; transferencia_cuenta_id?: string | null; mp_credencial_id?: string | null }
export async function resolverEmisor(supabase: ReturnType<typeof createAdminClient>, pedido: PedidoFiscal, columnas: string):
  Promise<{ cfg: Record<string, unknown> | null; vinculada: boolean; error?: string }> {
  let configId: string | null = null
  if (pedido.metodo_pago === 'transferencia' && pedido.transferencia_cuenta_id) {
    const { data } = await supabase.from('cuentas_transferencia')
      .select('facturacion_config_id').eq('id', pedido.transferencia_cuenta_id)
      .eq('empresa_id', pedido.empresa_id).maybeSingle()
    configId = (data?.facturacion_config_id as string | null) ?? null
  } else if (pedido.metodo_pago === 'mp' && pedido.mp_credencial_id) {
    const { data } = await supabase.from('mp_credenciales')
      .select('facturacion_config_id').eq('id', pedido.mp_credencial_id)
      .eq('empresa_id', pedido.empresa_id).maybeSingle()
    configId = (data?.facturacion_config_id as string | null) ?? null
  }
  if (configId) {
    const { data } = await supabase.from('facturacion_config')
      .select(columnas.includes('id,') || columnas.startsWith('id') ? columnas : `id, estado, ${columnas}`)
      .eq('id', configId).eq('empresa_id', pedido.empresa_id).maybeSingle()
    if (!data) return { cfg: null, vinculada: true, error: 'La cuenta del pedido apunta a un CUIT inexistente' }
    if ((data as { estado?: string }).estado !== 'validado') return { cfg: null, vinculada: true, error: 'El CUIT vinculado a la cuenta no está validado' }
    return { cfg: data as Record<string, unknown>, vinculada: true }
  }
  const cfg = await resolverFactConfig(supabase, pedido.empresa_id, pedido.sucursal_id ?? null,
    columnas.includes('id,') || columnas.startsWith('id') ? columnas : `id, estado, ${columnas}`)
  return { cfg: cfg as Record<string, unknown> | null, vinculada: false }
}

export async function facturarSiCorresponde(pedido_id: string) {
  try {
    const supabase = createAdminClient()
    const { data: pedido } = await supabase.from('pedidos')
      .select('empresa_id, sucursal_id, metodo_pago, receptor_doc_tipo, receptor_doc_nro, receptor_cond_iva, transferencia_cuenta_id, mp_credencial_id')
      .eq('id', pedido_id).maybeSingle()
    if (!pedido?.metodo_pago) return
    // B2: el emisor sale de la CUENTA del pedido si tiene CUIT vinculado; si
    // no, fallback histórico. La config resuelta gobierna TODO (activo, auto,
    // métodos, certificados). Config vinculada no validada = no factura + log.
    const r = await resolverEmisor(supabase, pedido, 'id, estado, activo, auto_facturar, metodos_auto, cert_pem, key_pem')
    if (r.error) { console.error('[facturacion] emisor vinculado no usable:', pedido_id, r.error); return }
    const cfg = r.cfg as { id: string; activo: boolean; auto_facturar: boolean | null; metodos_auto: unknown; cert_pem: string | null; key_pem: string | null } | null
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
      // B2: el emisor viaja explícito; la Edge lo RE-VERIFICA (empresa +
      // validado + activo) — jamás confía en el id a ciegas (regla CTO).
      body: JSON.stringify({ empresa_id: pedido.empresa_id, pedido_id, accion: 'facturar', facturacion_config_id: cfg.id, ...conReceptor }),
    })
    const d = await res.json().catch(() => null)
    console.log('[facturacion]', pedido_id, d?.ok ? `CAE ${d.cae} Nro ${d.nro_cbte}` : (d?.error ?? 'sin respuesta'))
  } catch (e) {
    console.error('[facturacion] hook error', e)
  }
}
