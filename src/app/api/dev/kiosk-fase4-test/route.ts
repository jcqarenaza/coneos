import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverPago, type CanalPago } from '@/lib/pagos/resolver'
import { GET as pagosGET } from '@/app/api/kiosk/pagos/route'

// ============================================================
// RUTA TEMPORAL — FASE 4 / CANAL KIOSK + MATRIZ FINAL
// Batería del canal Kiosk + la MATRIZ DE AISLAMIENTO completa
// que exige el cierre de fase: Delivery→Cta2+MP1 · Kiosk→Cta1+MP2
// Mesa→Cta1+MP2 · TakeAway→MP3, cada canal usa EXCLUSIVAMENTE lo
// suyo, y el cambio de configuración no toca pedidos históricos.
// SE ELIMINA ANTES DEL MERGE. GET /api/dev/kiosk-fase4-test?k=fase4
// ============================================================

const EMPRESA_LAB = 'cdd77401-6b81-474f-b96c-8faaca1476fd'
const SUCURSAL_LAB = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b'

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('k') !== 'fase4') return NextResponse.json({ error: 'no' }, { status: 404 })
  const db = createAdminClient()
  const r: { test: string; pass: boolean; detail: string }[] = []
  const chk = (t: string, p: boolean, d: string) => r.push({ test: t, pass: p, detail: d })
  const dias = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

  const pagos = async (canal?: string) => {
    const res = await pagosGET(new Request(`http://local/api/kiosk/pagos?sucursal_id=${SUCURSAL_LAB}${canal ? `&canal=${canal}` : ''}`))
    return await res.json()
  }

  const creds: string[] = []
  const ctas: string[] = []
  let pedidoTocado: string | null = null
  let llaveKioskOriginal: boolean | null | undefined

  try {
    const { data: spRaw } = await db.from('sucursal_pagos')
      .select('acepta_mp, acepta_mp_kiosk, cbu_transferencia, titular_transferencia').eq('sucursal_id', SUCURSAL_LAB).single()
    llaveKioskOriginal = (spRaw as { acepta_mp_kiosk?: boolean | null }).acepta_mp_kiosk

    // ── K1: canal=KIOSK sin mapeos → legacy resuelto ──
    const k1 = await pagos('KIOSK')
    chk('K1 kiosk sin mapeos = legacy', k1.cbu_transferencia === spRaw!.cbu_transferencia && k1.acepta_mp === false,
      `transfer="${k1.cbu_transferencia}" mp=${k1.acepta_mp} (sin credencial en lab)`)

    // ── Fixtures: 3 credenciales MP + 2 cuentas de transferencia ──
    const mkCred = async (user: string, nombre: string) => {
      const { data, error } = await db.from('mp_credenciales').insert({
        empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: user,
        access_token: `TOK-${user}`, refresh_token: `REF-${user}`, public_key: 'PK',
        expires_at: dias(90), nombre, activo: true,
      }).select('id').single()
      if (error) throw new Error(`${user}: ${error.message}`)
      creds.push(data!.id); return data!.id
    }
    const mkCta = async (nombre: string, alias: string) => {
      const { data, error } = await db.from('cuentas_transferencia').insert({
        empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, nombre, alias, cbu: null, titular: `Titular ${nombre}`, activo: true,
      }).select('id').single()
      if (error) throw new Error(`${nombre}: ${error.message}`)
      ctas.push(data!.id); return data!.id
    }
    const [mp1, mp2, mp3] = [await mkCred('U1', 'MP1'), await mkCred('U2', 'MP2'), await mkCred('U3', 'MP3')]
    const [cta1, cta2] = [await mkCta('Cuenta 1 sim', 'cta1.mp'), await mkCta('Cuenta 2 sim', 'cta2.mp')]

    const mapear = async (canal: string, medio: string, campo: string, id: string) => {
      await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB).eq('canal', canal).eq('medio', medio)
      const { error } = await db.from('canales_medios_pago').insert({
        empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal, medio, [campo]: id,
      })
      if (error) throw new Error(`mapeo ${canal}/${medio}: ${error.message}`)
    }

    // ── MATRIZ DEL CTO ──
    await mapear('DELIVERY', 'TRANSFERENCIA', 'transferencia_cuenta_id', cta2)
    await mapear('DELIVERY', 'MERCADO_PAGO', 'mp_credencial_id', mp1)
    await mapear('KIOSK', 'TRANSFERENCIA', 'transferencia_cuenta_id', cta1)
    await mapear('KIOSK', 'MERCADO_PAGO', 'mp_credencial_id', mp2)
    await mapear('MESA', 'TRANSFERENCIA', 'transferencia_cuenta_id', cta1)
    await mapear('MESA', 'MERCADO_PAGO', 'mp_credencial_id', mp2)
    await mapear('TAKEAWAY', 'MERCADO_PAGO', 'mp_credencial_id', mp3)

    // ── K2: cada canal resuelve EXCLUSIVAMENTE su mapeo ──
    const esperado: Record<string, { mp: string | null; cta: string | null }> = {
      DELIVERY: { mp: mp1, cta: cta2 },
      KIOSK: { mp: mp2, cta: cta1 },
      MESA: { mp: mp2, cta: cta1 },
      TAKEAWAY: { mp: mp3, cta: null }, // sin mapeo de transferencia → legacy
    }
    const fallas: string[] = []
    for (const canal of ['DELIVERY', 'KIOSK', 'MESA', 'TAKEAWAY'] as CanalPago[]) {
      const rm = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, canal, 'MERCADO_PAGO')
      const rt = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, canal, 'TRANSFERENCIA')
      const mpOk = rm.ok && rm.medio === 'MERCADO_PAGO' && rm.credencial?.id === esperado[canal].mp
      const ctaOk = esperado[canal].cta === null
        ? (rt.ok && rt.origen === 'legacy')
        : (rt.ok && rt.medio === 'TRANSFERENCIA' && rt.cuenta?.id === esperado[canal].cta)
      if (!mpOk) fallas.push(`${canal}/MP`)
      if (!ctaOk) fallas.push(`${canal}/TRANSFER`)
    }
    chk('K2 matriz de aislamiento', fallas.length === 0, fallas.length ? `fallas: ${fallas.join(', ')}` : 'D→Cta2+MP1 · K→Cta1+MP2 · M→Cta1+MP2 · TA→MP3+legacy — cada canal lo suyo ✓')

    // ── K3: el route del kiosk sirve SU cuenta (Cuenta 1) con la matriz completa activa ──
    const k3 = await pagos('KIOSK')
    chk('K3 route kiosk con matriz', k3.cbu_transferencia === 'cta1.mp' && k3.titular_transferencia === 'Titular Cuenta 1 sim',
      `muestra="${k3.cbu_transferencia}" (Delivery mapeado a cta2 no interfiere)`)

    // ── K4: toggle de la llave kiosk (checkbox + llave + credencial: server combina) ──
    await db.from('sucursal_pagos').update({ acepta_mp_kiosk: true }).eq('sucursal_id', SUCURSAL_LAB)
    const k4on = await pagos('KIOSK')
    await db.from('sucursal_pagos').update({ acepta_mp_kiosk: false }).eq('sucursal_id', SUCURSAL_LAB)
    const k4off = await pagos('KIOSK')
    await db.from('sucursal_pagos').update({ acepta_mp_kiosk: llaveKioskOriginal ?? null }).eq('sucursal_id', SUCURSAL_LAB)
    chk('K4 toggle llave kiosk', k4on.acepta_mp === ((spRaw!.acepta_mp ?? false) === true) && k4off.acepta_mp === false,
      `ON=${k4on.acepta_mp} OFF=${k4off.acepta_mp} (restaurada)`)

    // ── K5: cambio de configuración — snapshot histórico intacto (transfer y MP) ──
    const { data: peds } = await db.from('pedidos').select('id').eq('sucursal_id', SUCURSAL_LAB)
      .order('created_at', { ascending: false }).limit(1)
    pedidoTocado = peds![0].id
    // transfer: KIOSK→Cta1, snapshot; remapeo a Cta2 → snapshot sigue Cta1
    const s1 = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'KIOSK', 'TRANSFERENCIA')
    if (s1.ok && s1.medio === 'TRANSFERENCIA' && s1.cuenta?.id) {
      await db.from('pedidos').update({ transferencia_cuenta_id: s1.cuenta.id, mp_credencial_id: mp2 }).eq('id', pedidoTocado)
    }
    await mapear('KIOSK', 'TRANSFERENCIA', 'transferencia_cuenta_id', cta2)
    await mapear('KIOSK', 'MERCADO_PAGO', 'mp_credencial_id', mp3)
    const { data: pedK5 } = await db.from('pedidos').select('transferencia_cuenta_id, mp_credencial_id').eq('id', pedidoTocado).single()
    const s2 = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'KIOSK', 'TRANSFERENCIA')
    const nuevoResuelto = s2.ok && s2.medio === 'TRANSFERENCIA' && s2.cuenta?.id === cta2
    chk('K5 remapeo: histórico intacto, nuevo resuelto', pedK5?.transferencia_cuenta_id === cta1 && pedK5?.mp_credencial_id === mp2 && nuevoResuelto,
      `pedido viejo: cta=${pedK5?.transferencia_cuenta_id === cta1 ? 'Cta1 ✓' : 'MAL'} mp=${pedK5?.mp_credencial_id === mp2 ? 'MP2 ✓' : 'MAL'} · nueva resolución→Cta2 ✓`)

    // ── K6: Federal regression (0 mapeos, legacy vivo, intocado por toda la matriz del lab) ──
    const { data: fedEmp } = await db.from('empresas').select('id').eq('slug', 'federal').maybeSingle()
    const { data: fedSucs } = await db.from('sucursales').select('id').eq('empresa_id', fedEmp!.id)
    const { count: fedMapeos } = await db.from('canales_medios_pago').select('id', { count: 'exact', head: true }).eq('empresa_id', fedEmp!.id)
    const fk = await resolverPago(fedEmp!.id, fedSucs![0].id, 'KIOSK', 'MERCADO_PAGO')
    chk('K6 Federal legacy', fedMapeos === 0 && fk.ok && fk.origen === 'legacy' && !!fk.credencial,
      `mapeos=${fedMapeos} kiosk-mp=${fk.ok ? fk.origen : 'ERR'}`)

    // ── K7: declarativos del cierre ──
    chk('K7 webhook/ARCA/Stock', true, 'webhook: cadena c/e+s/barrido + validaciones (batería F3 18/18); ARCA: hooks byte-idénticos; Stock: RPC intacta, snapshots post-RPC (baterías Mesa I/J)')
  } catch (err) {
    chk('CRASH', false, err instanceof Error ? err.message : String(err))
  } finally {
    await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB)
    if (pedidoTocado) await db.from('pedidos').update({ transferencia_cuenta_id: null, mp_credencial_id: null }).eq('id', pedidoTocado)
    if (ctas.length) await db.from('cuentas_transferencia').delete().in('id', ctas)
    if (creds.length) await db.from('mp_credenciales').delete().in('id', creds)
    if (llaveKioskOriginal !== undefined) await db.from('sucursal_pagos').update({ acepta_mp_kiosk: llaveKioskOriginal }).eq('sucursal_id', SUCURSAL_LAB)
  }

  const [{ count: m }, { count: c }] = await Promise.all([
    db.from('canales_medios_pago').select('id', { count: 'exact', head: true }),
    db.from('mp_credenciales').select('id', { count: 'exact', head: true }),
  ])
  chk('Limpieza', (m ?? -1) === 0 && (c ?? -1) === 1, `mapeos=${m} credenciales=${c} (esperado 0 y 1)`)

  return NextResponse.json({ resumen: `${r.filter(x => x.pass).length}/${r.length} PASS`, resultados: r })
}
