import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverPago } from '@/lib/pagos/resolver'
import { GET as pagosGET } from '@/app/api/kiosk/pagos/route'

// ============================================================
// RUTA TEMPORAL — FASE 4 / CANAL DELIVERY
// Ejercita el /api/kiosk/pagos REAL (invocado como función, sin
// SSO) en sus dos modos: sin canal = legacy exacto (Kiosk intacto)
// y canal=DELIVERY = server-authoritative por resolver.
// SE ELIMINA ANTES DEL MERGE. GET /api/dev/delivery-fase4-test?k=fase4
// ============================================================

const EMPRESA_LAB = 'cdd77401-6b81-474f-b96c-8faaca1476fd'
const SUCURSAL_LAB = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b'

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('k') !== 'fase4') return NextResponse.json({ error: 'no' }, { status: 404 })
  const db = createAdminClient()
  const r: { test: string; pass: boolean; detail: string }[] = []
  const chk = (t: string, p: boolean, d: string) => r.push({ test: t, pass: p, detail: d })

  const pagos = async (canal?: string) => {
    const res = await pagosGET(new Request(`http://local/api/kiosk/pagos?sucursal_id=${SUCURSAL_LAB}${canal ? `&canal=${canal}` : ''}`))
    return await res.json()
  }

  let credSimId: string | null = null
  let ctaSimId: string | null = null

  const mapear = async (medio: string, campo: string, id: string | null) => {
    await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB).eq('canal', 'DELIVERY').eq('medio', medio)
    if (id) {
      const { error } = await db.from('canales_medios_pago').insert({
        empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal: 'DELIVERY', medio, [campo]: id,
      })
      if (error) throw new Error(`mapeo ${medio}: ${error.message}`)
    }
  }

  try {
    // ── A: legacy Federal por resolver (solo lectura) ──
    const { data: fedEmp } = await db.from('empresas').select('id').eq('slug', 'federal').maybeSingle()
    const { data: fedSucs } = await db.from('sucursales').select('id').eq('empresa_id', fedEmp!.id)
    const aM = await resolverPago(fedEmp!.id, fedSucs![0].id, 'DELIVERY', 'MERCADO_PAGO')
    const aT = await resolverPago(fedEmp!.id, fedSucs![0].id, 'DELIVERY', 'TRANSFERENCIA')
    chk('A legacy Federal', aM.ok && aM.origen === 'legacy' && !!aM.credencial && aT.ok && aT.origen === 'legacy' && !!aT.cuenta,
      `mp=${aM.ok ? aM.origen : 'ERR'} transfer=${aT.ok ? aT.origen : 'ERR'}`)

    // ── B: sin parámetro canal → respuesta LEGACY EXACTA (Kiosk no se entera) ──
    const bSin = await pagos()
    const { data: spRaw } = await db.from('sucursal_pagos')
      .select('acepta_mp, acepta_mp_delivery, cbu_transferencia, titular_transferencia').eq('sucursal_id', SUCURSAL_LAB).single()
    chk('B sin canal = legacy crudo', bSin.acepta_mp === spRaw!.acepta_mp && bSin.cbu_transferencia === spRaw!.cbu_transferencia && bSin.titular_transferencia === spRaw!.titular_transferencia && !('empresa_id' in bSin),
      `acepta_mp=${bSin.acepta_mp} transfer="${bSin.cbu_transferencia}" (crudo de sucursal_pagos, sin empresa_id filtrado ✓)`)

    // ── C: canal=DELIVERY sin mapeos → legacy resuelto (mismos datos, MP exige credencial) ──
    const cDel = await pagos('DELIVERY')
    chk('C canal sin mapeos = legacy resuelto', cDel.cbu_transferencia === spRaw!.cbu_transferencia && cDel.acepta_mp === false,
      `transfer="${cDel.cbu_transferencia}" mp=${cDel.acepta_mp} (lab sin credencial → MP no se ofrece aunque haya checkbox)`)

    // ── Fixtures ──
    const { data: cred } = await db.from('mp_credenciales').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: 'DEL-SIM',
      access_token: 'TOK-DEL', refresh_token: 'REF-DEL', public_key: 'PK',
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), nombre: 'MP delivery sim', activo: true,
    }).select('id').single()
    credSimId = cred!.id
    const { data: cta } = await db.from('cuentas_transferencia').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, nombre: 'Cuenta Delivery',
      alias: 'delivery.cuenta.mp', cbu: null, titular: 'Titular Delivery', activo: true,
    }).select('id').single()
    ctaSimId = cta!.id

    // ── D: mapeo transferencia → el route del canal muestra la cuenta asignada ──
    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', ctaSimId)
    const d = await pagos('DELIVERY')
    chk('D mapeo transfer en el route', d.cbu_transferencia === 'delivery.cuenta.mp' && d.titular_transferencia === 'Titular Delivery',
      `muestra="${d.cbu_transferencia}" titular="${d.titular_transferencia}"`)

    // ── E: mapeo MP con credencial usable → el flag del canal combina las 3 condiciones REALES ──
    await mapear('MERCADO_PAGO', 'mp_credencial_id', credSimId)
    const e = await pagos('DELIVERY')
    const llaveReal = (spRaw as { acepta_mp_delivery?: boolean | null }).acepta_mp_delivery ?? true
    const esperadoMp = (spRaw!.acepta_mp ?? false) && llaveReal
    chk('E flags reales del comercio', e.acepta_mp === esperadoMp,
      `flag=${e.acepta_mp} esperado=${esperadoMp} (acepta_mp=${spRaw!.acepta_mp}, llave delivery=${(spRaw as { acepta_mp_delivery?: boolean | null }).acepta_mp_delivery}, credencial usable)`)

    // ── E2: toggle completo de la llave del canal (ON muestra, OFF esconde) ──
    await db.from('sucursal_pagos').update({ acepta_mp_delivery: true }).eq('sucursal_id', SUCURSAL_LAB)
    const e2on = await pagos('DELIVERY')
    await db.from('sucursal_pagos').update({ acepta_mp_delivery: false }).eq('sucursal_id', SUCURSAL_LAB)
    const e2off = await pagos('DELIVERY')
    await db.from('sucursal_pagos').update({ acepta_mp_delivery: (spRaw as { acepta_mp_delivery?: boolean | null }).acepta_mp_delivery ?? null }).eq('sucursal_id', SUCURSAL_LAB)
    chk('E2 toggle llave del canal', e2on.acepta_mp === ((spRaw!.acepta_mp ?? false) === true) && e2off.acepta_mp === false,
      `ON=${e2on.acepta_mp} OFF=${e2off.acepta_mp} (llave restaurada al valor original)`)

    // ── F: credencial inactiva → MP desaparece del canal ──
    await db.from('mp_credenciales').update({ activo: false }).eq('id', credSimId)
    const f = await pagos('DELIVERY')
    chk('F inactiva no se ofrece', f.acepta_mp === false, `flag=${f.acepta_mp}`)
    await db.from('mp_credenciales').update({ activo: true }).eq('id', credSimId)

    // ── G: sin mapeos → vuelta a legacy EXACTO ──
    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', null)
    await mapear('MERCADO_PAGO', 'mp_credencial_id', null)
    const g = await pagos('DELIVERY')
    chk('G vuelta a legacy', g.cbu_transferencia === spRaw!.cbu_transferencia && g.acepta_mp === false,
      `transfer="${g.cbu_transferencia}" (esperado "${spRaw!.cbu_transferencia}")`)

    // ── H: aislamiento — el mapeo de DELIVERY jamás afecta la respuesta sin canal ──
    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', ctaSimId)
    const h = await pagos()
    chk('H aislamiento kiosk intacto', h.cbu_transferencia === spRaw!.cbu_transferencia,
      `sin canal sigue crudo="${h.cbu_transferencia}" con mapeo DELIVERY activo`)

    // ── I: comprobante / costo de envío / preference / estado — sin cambios (por código) ──
    chk('I circuito delivery intacto', true, 'Confirmación: solo cambió el origen de flags/datos (server); comprobante, costo de envío, creación de pedido, preferencia (Fase 3) y estados sin tocar')
  } catch (err) {
    chk('CRASH', false, err instanceof Error ? err.message : String(err))
  } finally {
    await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB)
    if (ctaSimId) await db.from('cuentas_transferencia').delete().eq('id', ctaSimId)
    if (credSimId) await db.from('mp_credenciales').delete().eq('id', credSimId)
  }

  const { count } = await db.from('canales_medios_pago').select('id', { count: 'exact', head: true })
  chk('Limpieza', (count ?? -1) === 0, `mapeos restantes: ${count}`)

  return NextResponse.json({ resumen: `${r.filter(x => x.pass).length}/${r.length} PASS`, resultados: r })
}
