import { createAdminClient } from '@/lib/supabase/admin'

// ============================================================
// RESOLVER CENTRAL DE PAGOS — Fase 2 canales-medios-pago-v1
// Única fuente de resolución de cuenta efectiva por canal+medio.
// SOLO LECTURA: jamás modifica la base (test K por construcción).
// Sin consumidores todavía (Fase 4 los migra de a uno).
// Server-authoritative: no confía en la coherencia de los UUIDs
// del llamador — valida pertenencia contra la base (patrón
// crear_pedido_stock v1.1).
// ============================================================

export type CanalPago = 'KIOSK' | 'DELIVERY' | 'MESA' | 'TAKEAWAY' | 'CAJA'
export type MedioPago = 'TRANSFERENCIA' | 'MERCADO_PAGO'

export type ResolucionPago =
  | {
      ok: true
      medio: 'TRANSFERENCIA'
      origen: 'explicito' | 'legacy'
      cuenta: {
        id: string | null            // null solo en legacy (sucursal_pagos no es una cuenta)
        nombre: string | null
        alias: string | null
        cbu: string | null
        titular: string | null
        empresa_id: string
        sucursal_id: string | null
      } | null                       // null = la sucursal no tiene datos de transferencia
    }
  | {
      ok: true
      medio: 'MERCADO_PAGO'
      origen: 'explicito' | 'legacy'
      credencial: {
        id: string
        mp_user_id: string
        access_token: string
        public_key: string | null
        expires_at: string | null
        empresa_id: string
        sucursal_id: string | null   // null = cuenta de la marca
      } | null                       // null = sin credencial (ni sucursal ni marca)
    }
  | { ok: false; error: 'SUCURSAL_INVALIDA' | 'CUENTA_OTRA_EMPRESA' | 'CUENTA_OTRA_SUCURSAL' | 'CUENTA_INACTIVA' | 'MAPEO_CORRUPTO' }

export async function resolverPago(
  empresa_id: string,
  sucursal_id: string,
  canal: CanalPago,
  medio: MedioPago
): Promise<ResolucionPago> {
  const supabase = createAdminClient()

  // ── Server-authoritative: la sucursal debe pertenecer a la empresa ──
  const { data: suc } = await supabase.from('sucursales')
    .select('id').eq('id', sucursal_id).eq('empresa_id', empresa_id).maybeSingle()
  if (!suc) return { ok: false, error: 'SUCURSAL_INVALIDA' }

  // ── ¿Existe mapeo explícito para (sucursal, canal, medio)? ──
  const { data: mapeo } = await supabase.from('canales_medios_pago')
    .select('id, empresa_id, mp_credencial_id, transferencia_cuenta_id')
    .eq('sucursal_id', sucursal_id).eq('canal', canal).eq('medio', medio)
    .maybeSingle()

  if (mapeo) {
    // Defensa extra sobre lo que la DB ya garantiza por FK compuesta:
    if (mapeo.empresa_id !== empresa_id) return { ok: false, error: 'CUENTA_OTRA_EMPRESA' }

    if (medio === 'TRANSFERENCIA') {
      if (!mapeo.transferencia_cuenta_id) return { ok: false, error: 'MAPEO_CORRUPTO' } // CHECK lo impide, cinturón igual
      const { data: cta } = await supabase.from('cuentas_transferencia')
        .select('id, nombre, alias, cbu, titular, activo, empresa_id, sucursal_id')
        .eq('id', mapeo.transferencia_cuenta_id).maybeSingle()
      if (!cta) return { ok: false, error: 'MAPEO_CORRUPTO' }
      if (cta.empresa_id !== empresa_id) return { ok: false, error: 'CUENTA_OTRA_EMPRESA' }
      // Cuenta exclusiva de sucursal: solo su sucursal. (cuentas_transferencia
      // tiene sucursal_id NOT NULL, la regla aplica directa.)
      if (cta.sucursal_id !== sucursal_id) return { ok: false, error: 'CUENTA_OTRA_SUCURSAL' }
      if (!cta.activo) return { ok: false, error: 'CUENTA_INACTIVA' }
      return {
        ok: true, medio, origen: 'explicito',
        cuenta: { id: cta.id, nombre: cta.nombre, alias: cta.alias, cbu: cta.cbu, titular: cta.titular, empresa_id: cta.empresa_id, sucursal_id: cta.sucursal_id },
      }
    }

    // MERCADO_PAGO explícito
    if (!mapeo.mp_credencial_id) return { ok: false, error: 'MAPEO_CORRUPTO' }
    const { data: cred } = await supabase.from('mp_credenciales')
      .select('id, mp_user_id, access_token, public_key, expires_at, activo, empresa_id, sucursal_id')
      .eq('id', mapeo.mp_credencial_id).maybeSingle()
    if (!cred) return { ok: false, error: 'MAPEO_CORRUPTO' }
    if (cred.empresa_id !== empresa_id) return { ok: false, error: 'CUENTA_OTRA_EMPRESA' }
    // Cuenta de marca (sucursal_id NULL) usable por sus sucursales;
    // cuenta exclusiva de OTRA sucursal: rechazo.
    if (cred.sucursal_id !== null && cred.sucursal_id !== sucursal_id) return { ok: false, error: 'CUENTA_OTRA_SUCURSAL' }
    if (!cred.activo) return { ok: false, error: 'CUENTA_INACTIVA' }
    return {
      ok: true, medio, origen: 'explicito',
      credencial: { id: cred.id, mp_user_id: cred.mp_user_id, access_token: cred.access_token, public_key: cred.public_key, expires_at: cred.expires_at, empresa_id: cred.empresa_id, sucursal_id: cred.sucursal_id },
    }
  }

  // ── SIN mapeo → LEGACY EXACTO (test A/C/J: jamás fabrica mapeos) ──
  if (medio === 'TRANSFERENCIA') {
    // Comportamiento actual: datos planos de sucursal_pagos, tal cual están.
    const { data: sp } = await supabase.from('sucursal_pagos')
      .select('cbu_transferencia, mp_alias, titular_transferencia, empresa_id, sucursal_id')
      .eq('sucursal_id', sucursal_id).eq('empresa_id', empresa_id).maybeSingle()
    if (!sp || (!sp.cbu_transferencia && !sp.mp_alias && !sp.titular_transferencia)) {
      return { ok: true, medio, origen: 'legacy', cuenta: null }
    }
    return {
      ok: true, medio, origen: 'legacy',
      cuenta: {
        id: null, nombre: null,
        alias: sp.mp_alias || null,          // semántica cruda del legacy:
        cbu: sp.cbu_transferencia || null,   // hoy los consumidores exhiben
        titular: sp.titular_transferencia || null, // cbu_transferencia bajo la etiqueta "Alias"
        empresa_id: sp.empresa_id, sucursal_id: sp.sucursal_id,
      },
    }
  }

  // MERCADO_PAGO legacy: cascada sucursal → marca, idéntica a /api/mp/preferencia.
  const { data: credSuc } = await supabase.from('mp_credenciales')
    .select('id, mp_user_id, access_token, public_key, expires_at, empresa_id, sucursal_id')
    .eq('empresa_id', empresa_id).eq('sucursal_id', sucursal_id).maybeSingle()
  const cred = credSuc ?? (await supabase.from('mp_credenciales')
    .select('id, mp_user_id, access_token, public_key, expires_at, empresa_id, sucursal_id')
    .eq('empresa_id', empresa_id).is('sucursal_id', null).maybeSingle()).data
  if (!cred) return { ok: true, medio, origen: 'legacy', credencial: null }
  return {
    ok: true, medio, origen: 'legacy',
    credencial: { id: cred.id, mp_user_id: cred.mp_user_id, access_token: cred.access_token, public_key: cred.public_key, expires_at: cred.expires_at, empresa_id: cred.empresa_id, sucursal_id: cred.sucursal_id },
  }
}
