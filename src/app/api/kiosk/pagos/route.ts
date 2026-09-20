import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverPago, type CanalPago } from '@/lib/pagos/resolver'

// API pública (kiosk/delivery anónimos): NUNCA devolver credenciales.
// mp_access_token/mp_public_key se reemplazan por el booleano mp_configurado.
//
// FASE 4 — canal-aware:
//   GET ?sucursal_id=X                → respuesta LEGACY EXACTA (flags crudos
//                                       de sucursal_pagos, como siempre).
//   GET ?sucursal_id=X&canal=DELIVERY → server-authoritative vía resolverPago():
//     · acepta_mp viene RESUELTO (credencial usable Y acepta_mp Y llave del canal)
//     · cbu_transferencia/titular = datos de la cuenta resuelta del canal
//       (mapeo explícito → su alias; sin mapeo → legacy crudo, byte-idéntico)
// El cliente jamás decide disponibilidad: el checkbox solo no alcanza.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sucursal_id = searchParams.get('sucursal_id')
  const canalParam = (searchParams.get('canal') ?? '').toUpperCase()

  if (!sucursal_id) return NextResponse.json({ error: 'sucursal_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('sucursal_pagos')
    .select('empresa_id, acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_kiosk, acepta_mp_delivery, acepta_mp_takeaway, cbu_transferencia, titular_transferencia, acepta_efectivo_kiosk, acepta_efectivo_delivery, acepta_efectivo_takeaway, acepta_transferencia_kiosk, acepta_transferencia_delivery, acepta_transferencia_takeaway')
    .eq('sucursal_id', sucursal_id)
    .single()

  if (!data) {
    return NextResponse.json({ acepta_efectivo: true, acepta_transferencia: false, acepta_mp: false, acepta_mp_kiosk: false, acepta_mp_delivery: false, cbu_transferencia: null, titular_transferencia: null })
  }

  // F-C: TAKEAWAY entra al modo canal-aware (antes caía al legacy)
  const esCanalValido = canalParam === 'KIOSK' || canalParam === 'DELIVERY' || canalParam === 'TAKEAWAY'
  if (!esCanalValido) {
    // Legacy exacto (Kiosk sigue acá hasta su migración)
    const { empresa_id: _omitir, ...legacy } = data
    void _omitir
    return NextResponse.json(legacy)
  }

  const canal = canalParam as CanalPago
  const [resMp, resTransfer] = await Promise.all([
    resolverPago(data.empresa_id, sucursal_id, canal, 'MERCADO_PAGO'),
    resolverPago(data.empresa_id, sucursal_id, canal, 'TRANSFERENCIA'),
  ])

  const llaveCanal = canal === 'DELIVERY' ? (data.acepta_mp_delivery ?? true) : canal === 'TAKEAWAY' ? (data.acepta_mp_takeaway ?? true) : (data.acepta_mp_kiosk ?? true)
  const mpUsable = resMp.ok && resMp.medio === 'MERCADO_PAGO' && !!resMp.credencial && resMp.credencial.activo !== false

  const cuenta = resTransfer.ok && resTransfer.medio === 'TRANSFERENCIA' ? resTransfer.cuenta : null
  const transferMostrar = cuenta
    ? (resTransfer.ok && resTransfer.origen === 'explicito' ? (cuenta.alias ?? cuenta.cbu) : cuenta.cbu)
    : null

  // F-C: efectivo y transferencia también resueltos POR CANAL (base && llave
  // del canal, default true = histórico). La UI muestra lo que el server dice
  // — y el guard de /api/pedidos garantiza la misma regla al crear.
  const efectivoCanal = canal === 'DELIVERY' ? (data.acepta_efectivo_delivery ?? true) : canal === 'TAKEAWAY' ? (data.acepta_efectivo_takeaway ?? true) : (data.acepta_efectivo_kiosk ?? true)
  const transferCanal = canal === 'DELIVERY' ? (data.acepta_transferencia_delivery ?? true) : canal === 'TAKEAWAY' ? (data.acepta_transferencia_takeaway ?? true) : (data.acepta_transferencia_kiosk ?? true)

  return NextResponse.json({
    acepta_efectivo: (data.acepta_efectivo ?? true) && efectivoCanal,
    acepta_transferencia: (data.acepta_transferencia ?? true) && transferCanal,
    acepta_mp: mpUsable && (data.acepta_mp ?? false) && llaveCanal,
    acepta_mp_kiosk: data.acepta_mp_kiosk,
    acepta_mp_delivery: data.acepta_mp_delivery,
    cbu_transferencia: transferMostrar,
    titular_transferencia: cuenta?.titular ?? null,
  })
}
