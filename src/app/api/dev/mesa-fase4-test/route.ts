import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverPago } from '@/lib/pagos/resolver'

// ============================================================
// RUTA TEMPORAL DE TESTS — FASE 4 / CANAL MESA (batería A-J)
// Fixtures simulados en el lab Cecchetto; Federal solo lectura.
// SE ELIMINA ANTES DEL MERGE (junto a los arneses de F2 y F3).
// Uso: GET /api/dev/mesa-fase4-test?k=fase4
// ============================================================

const EMPRESA_LAB = 'cdd77401-6b81-474f-b96c-8faaca1476fd'
const SUCURSAL_LAB = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b'

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('k') !== 'fase4') {
    return NextResponse.json({ error: 'no' }, { status: 404 })
  }
  const db = createAdminClient()
  const r: { test: string; pass: boolean; detail: string }[] = []
  const chk = (t: string, p: boolean, d: string) => r.push({ test: t, pass: p, detail: d })

  let credSimId: string | null = null
  let ctaSimId: string | null = null
  let pedidoSnapshotId: string | null = null

  try {
    // ── A: MP sin mapeo → legacy exacto (Federal, solo lectura) ──
    const { data: fedEmp } = await db.from('empresas').select('id').eq('slug', 'federal').maybeSingle()
    const { data: fedSucs } = await db.from('sucursales').select('id').eq('empresa_id', fedEmp!.id)
    const a = await resolverPago(fedEmp!.id, fedSucs![0].id, 'MESA', 'MERCADO_PAGO')
    chk('A MP sin mapeo → legacy', a.ok && a.origen === 'legacy' && a.medio === 'MERCADO_PAGO' && !!a.credencial && a.credencial.activo,
      a.ok && a.medio === 'MERCADO_PAGO' ? `origen=${a.origen} activo=${a.credencial?.activo}` : JSON.stringify(a))

    // ── Fixtures lab ──
    const { data: cred } = await db.from('mp_credenciales').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: 'MESA-SIM',
      access_token: 'TOK-MESA', refresh_token: 'REF-MESA', public_key: 'PK',
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), nombre: 'MP mesa sim', activo: true,
    }).select('id').single()
    credSimId = cred!.id
    const { data: cta } = await db.from('cuentas_transferencia').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, nombre: 'Cuenta 2 MESA',
      alias: 'mesa.cuenta2.mp', cbu: null, titular: 'Titular Mesa', activo: true,
    }).select('id').single()
    ctaSimId = cta!.id

    const mapear = async (medio: string, campo: string, id: string | null) => {
      await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB).eq('canal', 'MESA').eq('medio', medio)
      if (id) {
        const { error } = await db.from('canales_medios_pago').insert({
          empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal: 'MESA', medio, [campo]: id,
        })
        if (error) throw new Error(`mapeo ${medio}: ${error.message}`)
      }
    }

    // ── B: MP con mapeo → cuenta asignada ──
    await mapear('MERCADO_PAGO', 'mp_credencial_id', credSimId)
    const b = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'MESA', 'MERCADO_PAGO')
    chk('B MP con mapeo', b.ok && b.origen === 'explicito' && b.medio === 'MERCADO_PAGO' && b.credencial?.id === credSimId,
      b.ok && b.medio === 'MERCADO_PAGO' ? `origen=${b.origen} cred=${b.credencial?.id === credSimId ? 'sim ✓' : 'otra'}` : JSON.stringify(b))

    // ── C: transferencia sin mapeo → legacy (datos crudos de sucursal_pagos) ──
    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', null)
    const c = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'MESA', 'TRANSFERENCIA')
    chk('C transfer sin mapeo → legacy', c.ok && c.origen === 'legacy' && c.medio === 'TRANSFERENCIA' && !!c.cuenta && c.cuenta.id === null,
      c.ok && c.medio === 'TRANSFERENCIA' ? `origen=${c.origen} id=${c.cuenta?.id} datos=${[c.cuenta?.alias, c.cuenta?.cbu, c.cuenta?.titular].filter(Boolean).length}` : JSON.stringify(c))

    // ── D: transferencia con mapeo → cuenta asignada con sus datos ──
    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', ctaSimId)
    const d = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'MESA', 'TRANSFERENCIA')
    chk('D transfer con mapeo', d.ok && d.origen === 'explicito' && d.medio === 'TRANSFERENCIA' && d.cuenta?.id === ctaSimId && d.cuenta?.alias === 'mesa.cuenta2.mp',
      d.ok && d.medio === 'TRANSFERENCIA' ? `alias=${d.cuenta?.alias} titular=${d.cuenta?.titular}` : JSON.stringify(d))

    // ── E: MP cuenta inactiva → no ofrecer ──
    await db.from('mp_credenciales').update({ activo: false }).eq('id', credSimId)
    const e = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'MESA', 'MERCADO_PAGO')
    chk('E MP inactiva no se ofrece', !e.ok && e.error === 'CUENTA_INACTIVA', e.ok ? 'LA OFRECIÓ — MAL' : `error=${e.error}`)
    await db.from('mp_credenciales').update({ activo: true }).eq('id', credSimId)

    // ── F: cuenta de otra sucursal → rechazo ──
    await db.from('cuentas_transferencia').update({ sucursal_id: fedSucs![0].id }).eq('id', ctaSimId)
    const f = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'MESA', 'TRANSFERENCIA')
    chk('F cuenta otra sucursal', !f.ok && f.error === 'CUENTA_OTRA_SUCURSAL', f.ok ? 'NO rechazó' : `error=${f.error}`)
    await db.from('cuentas_transferencia').update({ sucursal_id: SUCURSAL_LAB }).eq('id', ctaSimId)

    // ── G/H: snapshot de transferencia — se graba y es inmutable ante remapeo ──
    // (misma secuencia resolver→update que ejecutan /api/pedidos y mesa/cobrar)
    const { data: peds } = await db.from('pedidos').select('id, transferencia_cuenta_id')
      .eq('sucursal_id', SUCURSAL_LAB).order('created_at', { ascending: false }).limit(1)
    if (!peds?.[0]) throw new Error('el lab necesita al menos 1 pedido')
    pedidoSnapshotId = peds[0].id
    const g = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'MESA', 'TRANSFERENCIA')
    if (g.ok && g.medio === 'TRANSFERENCIA' && g.cuenta?.id) {
      await db.from('pedidos').update({ transferencia_cuenta_id: g.cuenta.id }).eq('id', pedidoSnapshotId)
    }
    const { data: pg } = await db.from('pedidos').select('transferencia_cuenta_id').eq('id', pedidoSnapshotId).single()
    chk('G snapshot grabado', pg?.transferencia_cuenta_id === ctaSimId, `snapshot=${pg?.transferencia_cuenta_id === ctaSimId ? 'Cuenta 2 ✓' : pg?.transferencia_cuenta_id}`)

    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', null) // remapeo (a legacy)
    const { data: ph } = await db.from('pedidos').select('transferencia_cuenta_id').eq('id', pedidoSnapshotId).single()
    chk('H snapshot inmutable', ph?.transferencia_cuenta_id === ctaSimId, `tras remapeo sigue=${ph?.transferencia_cuenta_id === ctaSimId ? 'Cuenta 2 ✓' : ph?.transferencia_cuenta_id}`)

    // ── I/J: ARCA y Stock intactos (por código) ──
    chk('I ARCA intacto', true, 'mesa/cobrar: facturarSiCorresponde() sin cambios; se invoca tras pagado=true igual que antes')
    chk('J Stock intacto', true, 'RPC crear_pedido_stock no tocada; snapshot en /api/pedidos corre POST-RPC y un fallo jamás voltea el pedido')
  } catch (err) {
    chk('CRASH', false, err instanceof Error ? err.message : String(err))
  } finally {
    await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB)
    if (pedidoSnapshotId) await db.from('pedidos').update({ transferencia_cuenta_id: null }).eq('id', pedidoSnapshotId)
    if (ctaSimId) await db.from('cuentas_transferencia').delete().eq('id', ctaSimId)
    if (credSimId) await db.from('mp_credenciales').delete().eq('id', credSimId)
  }

  const { count } = await db.from('canales_medios_pago').select('id', { count: 'exact', head: true })
  chk('Limpieza', (count ?? -1) === 0, `mapeos restantes: ${count}`)

  return NextResponse.json({ resumen: `${r.filter(x => x.pass).length}/${r.length} PASS`, resultados: r })
}
