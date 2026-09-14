import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverPago, type CanalPago } from '@/lib/pagos/resolver'

// ============================================================
// MERCADO PAGO MULTI-CUENTA — Fase 3 canales-medios-pago-v1
// Toda la lógica MP compartida vive acá. Los routes (connect,
// callback, preferencia, webhook) son cáscaras finas sobre esto.
// La RESOLUCIÓN de cuenta es siempre resolverPago() (Fase 2) —
// acá no se duplica ninguna cascada.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>

export type CredencialMP = {
  id: string
  mp_user_id: string
  access_token: string
  refresh_token: string | null
  public_key: string | null
  expires_at: string | null
  activo: boolean
  empresa_id: string
  sucursal_id: string | null
}

const SELECT_CRED = 'id, mp_user_id, access_token, refresh_token, public_key, expires_at, activo, empresa_id, sucursal_id'

// ── OAUTH: guardar credencial por IDENTIDAD (empresa + alcance + mp_user) ──
// A) cuenta nueva → INSERT.  B) misma cuenta → UPDATE (reconexión, reactiva).
// C) segunda cuenta → INSERT sin tocar la primera.
// El hint (mp_credencial_id del state) solo informa si la cuenta conectada
// resultó ser OTRA que la que el admin quiso reconectar.
export async function guardarCredencialOAuth(
  db: DB,
  params: {
    empresa_id: string
    sucursal_id: string | null
    mp_user_id: string
    access_token: string
    refresh_token: string | null
    public_key: string | null
    expires_at: string
    credencial_hint_id?: string | null
  }
): Promise<{ id: string; accion: 'creada' | 'actualizada'; distinta_del_hint: boolean }> {
  let q = db.from('mp_credenciales').select('id')
    .eq('empresa_id', params.empresa_id).eq('mp_user_id', params.mp_user_id)
  q = params.sucursal_id === null ? q.is('sucursal_id', null) : q.eq('sucursal_id', params.sucursal_id)
  const { data: existente } = await q.maybeSingle()

  const tokens = {
    access_token: params.access_token,
    refresh_token: params.refresh_token,
    public_key: params.public_key,
    expires_at: params.expires_at,
    activo: true, // reconectar SIEMPRE reactiva (cura el estado "requiere reconexión")
    updated_at: new Date().toISOString(),
  }

  if (existente) {
    await db.from('mp_credenciales').update(tokens).eq('id', existente.id)
    return { id: existente.id, accion: 'actualizada', distinta_del_hint: !!params.credencial_hint_id && params.credencial_hint_id !== existente.id }
  }
  const { data: nueva, error } = await db.from('mp_credenciales').insert({
    empresa_id: params.empresa_id, sucursal_id: params.sucursal_id, mp_user_id: params.mp_user_id, ...tokens,
  }).select('id').single()
  if (error || !nueva) throw new Error(`No se pudo guardar la credencial: ${error?.message}`)
  return { id: nueva.id, accion: 'creada', distinta_del_hint: !!params.credencial_hint_id }
}

// ── REFRESH ON-DEMAND (sin cron, sin refresh masivo) ──
// Solo se llama cuando la credencial VA a usarse. Margen: 7 días.
// Falla el refresh → activo=false (no utilizable / requiere reconexión).
const MARGEN_REFRESH_MS = 7 * 24 * 60 * 60 * 1000

export async function conTokenFresco(
  db: DB,
  cred: CredencialMP
): Promise<{ ok: true; access_token: string; refrescado: boolean } | { ok: false; motivo: 'INACTIVA' | 'REFRESH_FALLIDO' }> {
  if (!cred.activo) return { ok: false, motivo: 'INACTIVA' }

  const vence = cred.expires_at ? new Date(cred.expires_at).getTime() : null
  const necesitaRefresh = vence !== null && vence - Date.now() < MARGEN_REFRESH_MS
  if (!necesitaRefresh) return { ok: true, access_token: cred.access_token, refrescado: false }

  if (!cred.refresh_token) {
    await db.from('mp_credenciales').update({ activo: false, updated_at: new Date().toISOString() }).eq('id', cred.id)
    return { ok: false, motivo: 'REFRESH_FALLIDO' }
  }
  try {
    const res = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.MP_CLIENT_ID,
        client_secret: process.env.MP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: cred.refresh_token,
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.access_token) throw new Error(data?.message ?? 'refresh rechazado')
    const expires_at = new Date(Date.now() + (data.expires_in ?? 15552000) * 1000).toISOString()
    await db.from('mp_credenciales').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? cred.refresh_token, // MP rota el refresh; si no manda, conservamos
      expires_at, activo: true, updated_at: new Date().toISOString(),
    }).eq('id', cred.id)
    return { ok: true, access_token: data.access_token, refrescado: true }
  } catch (e) {
    console.error('[mp/refresh] Falló refresh de credencial', cred.id, e)
    await db.from('mp_credenciales').update({ activo: false, updated_at: new Date().toISOString() }).eq('id', cred.id)
    return { ok: false, motivo: 'REFRESH_FALLIDO' }
  }
}

// ── CREDENCIAL PARA UN PEDIDO (la usa /api/mp/preferencia) ──
// Canal del pedido → resolverPago → refresh on-demand → SNAPSHOT.
// El snapshot (pedidos.mp_credencial_id) se escribe al preparar la
// preferencia = la cuenta REAL usada; cambios de mapeo posteriores
// no lo tocan jamás.
export function canalDePedido(tipo_pedido: string | null): CanalPago {
  switch (tipo_pedido) {
    case 'delivery': return 'DELIVERY'
    case 'mesa': return 'MESA'
    case 'takeaway': return 'TAKEAWAY'
    default: return 'KIOSK'
  }
}

export async function credencialParaPedido(
  db: DB,
  pedido: { id: string; empresa_id: string; sucursal_id: string | null; tipo_pedido: string | null }
): Promise<{ ok: true; credencial_id: string; access_token: string; sucursal_scope: string | null; origen: string } | { ok: false; error: string }> {
  let cred: CredencialMP | null = null
  let origen = 'legacy'

  if (pedido.sucursal_id) {
    const res = await resolverPago(pedido.empresa_id, pedido.sucursal_id, canalDePedido(pedido.tipo_pedido), 'MERCADO_PAGO')
    if (!res.ok) return { ok: false, error: res.error }
    if (res.medio === 'MERCADO_PAGO' && res.credencial) {
      cred = { ...res.credencial, refresh_token: null, activo: true } as CredencialMP
      // El resolver no expone refresh_token/activo: recargamos la fila completa
      const { data: full } = await db.from('mp_credenciales').select(SELECT_CRED).eq('id', res.credencial.id).maybeSingle()
      if (full) cred = full as CredencialMP
      origen = res.origen
    }
  } else {
    // Pedido sin sucursal (histórico): cuenta de la marca, igual que siempre
    const { data } = await db.from('mp_credenciales').select(SELECT_CRED)
      .eq('empresa_id', pedido.empresa_id).is('sucursal_id', null).maybeSingle()
    cred = data as CredencialMP | null
  }

  if (!cred) return { ok: false, error: 'SIN_CREDENCIAL' }

  const fresco = await conTokenFresco(db, cred)
  if (!fresco.ok) return { ok: false, error: fresco.motivo }

  // SNAPSHOT: cuenta MP real de esta preferencia (inmutable ante remapeos)
  await db.from('pedidos').update({ mp_credencial_id: cred.id }).eq('id', pedido.id)

  return { ok: true, credencial_id: cred.id, access_token: fresco.access_token, sucursal_scope: cred.sucursal_id, origen }
}

// ── RESOLUCIÓN DE CREDENCIALES PARA EL WEBHOOK ──
// Orden: ?c= (credencial exacta) → ?e=&s= (legacy firmado) → barrido (preferencias viejas).
// Devuelve candidatas en orden; el webhook conserva TODAS sus validaciones
// (payment real consultado a MP, external_reference→pedido, empresa del pedido
// vs empresa de la credencial, PENDING_PAYMENT, idempotencia).
export async function credencialesParaWebhook(
  db: DB,
  searchParams: URLSearchParams
): Promise<{ candidatas: Pick<CredencialMP, 'id' | 'empresa_id' | 'access_token'>[]; via: 'credencial' | 'legacy-firma' | 'barrido' }> {
  const cParam = searchParams.get('c')
  const eParam = searchParams.get('e')
  const sParam = searchParams.get('s')

  // 1. Credencial explícita — con refresh on-demand (va a usarse ya mismo)
  if (cParam) {
    const { data } = await db.from('mp_credenciales').select(SELECT_CRED).eq('id', cParam).maybeSingle()
    if (data) {
      const cred = data as CredencialMP
      const fresco = await conTokenFresco(db, cred)
      if (fresco.ok) return { candidatas: [{ id: cred.id, empresa_id: cred.empresa_id, access_token: fresco.access_token }], via: 'credencial' }
      // credencial muerta → seguimos a los fallbacks legacy
    }
  }

  // 2. Legacy firmado e+s (sucursal → marca), idéntico al comportamiento actual
  const candidatas: Pick<CredencialMP, 'id' | 'empresa_id' | 'access_token'>[] = []
  if (eParam) {
    if (sParam) {
      const { data } = await db.from('mp_credenciales').select('id, empresa_id, access_token')
        .eq('empresa_id', eParam).eq('sucursal_id', sParam).maybeSingle()
      if (data) candidatas.push(data)
    }
    if (candidatas.length === 0) {
      const { data } = await db.from('mp_credenciales').select('id, empresa_id, access_token')
        .eq('empresa_id', eParam).is('sucursal_id', null).maybeSingle()
      if (data) candidatas.push(data)
    }
    if (candidatas.length > 0) return { candidatas, via: 'legacy-firma' }
  }

  // 3. Barrido total (preferencias antiguas sin firma) — sin refresh masivo (§2)
  const { data } = await db.from('mp_credenciales').select('id, empresa_id, access_token')
  return { candidatas: data ?? [], via: 'barrido' }
}
