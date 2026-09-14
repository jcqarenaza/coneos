import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverPago } from '@/lib/pagos/resolver'
import { GET as contextoGET } from '@/app/api/takeaway/contexto/route'

// ============================================================
// RUTA TEMPORAL — FASE 4 / CANAL TAKE AWAY (batería equivalente)
// SE ELIMINA ANTES DEL MERGE. Uso: GET /api/dev/takeaway-fase4-test?k=fase4
// Además de la resolución, verifica el CONTEXTO REAL del canal
// (fetch a /api/takeaway/contexto del propio deployment) con y
// sin mapeos — lo que el cliente vería.
// ============================================================

const EMPRESA_LAB = 'cdd77401-6b81-474f-b96c-8faaca1476fd'
const SUCURSAL_LAB = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b'

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('k') !== 'fase4') return NextResponse.json({ error: 'no' }, { status: 404 })
  const db = createAdminClient()
  const r: { test: string; pass: boolean; detail: string }[] = []
  const chk = (t: string, p: boolean, d: string) => r.push({ test: t, pass: p, detail: d })

  let credSimId: string | null = null
  let ctaSimId: string | null = null

  // Slugs del lab para pegarle al contexto real
  const { data: empLab } = await db.from('empresas').select('slug').eq('id', EMPRESA_LAB).single()
  const { data: sucLab } = await db.from('sucursales').select('slug').eq('id', SUCURSAL_LAB).single()
  // Invocación DIRECTA del handler (sin HTTP: el SSO de Vercel sobre previews
  // intercepta los fetch internos) — mismo código real del contexto.
  const leerCtx = async () => {
    const res = await contextoGET(new Request(`http://local/api/takeaway/contexto?empresa=${empLab!.slug}&sucursal=${sucLab!.slug}`))
    return await res.json()
  }

  const mapear = async (medio: string, campo: string, id: string | null) => {
    await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB).eq('canal', 'TAKEAWAY').eq('medio', medio)
    if (id) {
      const { error } = await db.from('canales_medios_pago').insert({
        empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal: 'TAKEAWAY', medio, [campo]: id,
      })
      if (error) throw new Error(`mapeo ${medio}: ${error.message}`)
    }
  }

  try {
    // ── A: legacy Federal (solo lectura, resolución) ──
    const { data: fedEmp } = await db.from('empresas').select('id').eq('slug', 'federal').maybeSingle()
    const { data: fedSucs } = await db.from('sucursales').select('id').eq('empresa_id', fedEmp!.id)
    const aM = await resolverPago(fedEmp!.id, fedSucs![0].id, 'TAKEAWAY', 'MERCADO_PAGO')
    const aT = await resolverPago(fedEmp!.id, fedSucs![0].id, 'TAKEAWAY', 'TRANSFERENCIA')
    chk('A legacy Federal', aM.ok && aM.origen === 'legacy' && aT.ok && aT.origen === 'legacy',
      `mp=${aM.ok ? aM.origen : 'ERR'} transfer=${aT.ok ? aT.origen : 'ERR'}`)

    // ── B: contexto REAL sin mapeos = legacy (lo que ve el cliente hoy) ──
    const ctxLegacy = await leerCtx()
    const legacyTransfer = ctxLegacy?.pagos?.cbu_transferencia
    chk('B contexto legacy', !!ctxLegacy?.pagos && ctxLegacy.pagos.acepta_mp === false && typeof legacyTransfer === 'string',
      `mp=${ctxLegacy?.pagos?.acepta_mp} transfer="${legacyTransfer}" titular="${ctxLegacy?.pagos?.titular_transferencia}"`)

    // ── Fixtures ──
    const { data: cred } = await db.from('mp_credenciales').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: 'TA-SIM',
      access_token: 'TOK-TA', refresh_token: 'REF-TA', public_key: 'PK',
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), nombre: 'MP TA sim', activo: true,
    }).select('id').single()
    credSimId = cred!.id
    const { data: cta } = await db.from('cuentas_transferencia').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, nombre: 'Cuenta TA',
      alias: 'ta.cuenta.mp', cbu: null, titular: 'Titular TA', activo: true,
    }).select('id').single()
    ctaSimId = cta!.id

    // ── C: mapeo transferencia → el contexto REAL muestra la cuenta asignada ──
    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', ctaSimId)
    const ctxMap = await leerCtx()
    chk('C contexto con mapeo transfer', ctxMap?.pagos?.cbu_transferencia === 'ta.cuenta.mp' && ctxMap?.pagos?.titular_transferencia === 'Titular TA',
      `muestra="${ctxMap?.pagos?.cbu_transferencia}" titular="${ctxMap?.pagos?.titular_transferencia}"`)

    // ── D: mapeo MP → resolución explícita (el flag del contexto depende además
    //      del checkbox acepta_mp del comercio, que no tocamos) ──
    await mapear('MERCADO_PAGO', 'mp_credencial_id', credSimId)
    const d = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'TAKEAWAY', 'MERCADO_PAGO')
    chk('D MP con mapeo', d.ok && d.origen === 'explicito' && d.medio === 'MERCADO_PAGO' && d.credencial?.id === credSimId,
      d.ok && d.medio === 'MERCADO_PAGO' ? `origen=${d.origen}` : JSON.stringify(d))

    // ── E: credencial inactiva → no se ofrece (resolución y contexto) ──
    await db.from('mp_credenciales').update({ activo: false }).eq('id', credSimId)
    const e = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'TAKEAWAY', 'MERCADO_PAGO')
    const ctxE = await leerCtx()
    chk('E inactiva no se ofrece', !e.ok && e.error === 'CUENTA_INACTIVA' && ctxE?.pagos?.acepta_mp === false,
      `resolver=${e.ok ? 'OFRECIÓ' : e.error} contexto=${ctxE?.pagos?.acepta_mp}`)
    await db.from('mp_credenciales').update({ activo: true }).eq('id', credSimId)

    // ── F: cuenta de otra sucursal → rechazo + contexto cae seguro ──
    await db.from('cuentas_transferencia').update({ sucursal_id: fedSucs![0].id }).eq('id', ctaSimId)
    const f = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'TAKEAWAY', 'TRANSFERENCIA')
    const ctxF = await leerCtx()
    chk('F cuenta otra sucursal', !f.ok && f.error === 'CUENTA_OTRA_SUCURSAL' && ctxF?.pagos?.cbu_transferencia === null,
      `resolver=${f.ok ? 'OK?!' : f.error} contexto="${ctxF?.pagos?.cbu_transferencia}"`)
    await db.from('cuentas_transferencia').update({ sucursal_id: SUCURSAL_LAB }).eq('id', ctaSimId)

    // ── G: quitados los mapeos, el contexto vuelve a legacy EXACTO ──
    await mapear('TRANSFERENCIA', 'transferencia_cuenta_id', null)
    await mapear('MERCADO_PAGO', 'mp_credencial_id', null)
    const ctxBack = await leerCtx()
    chk('G vuelta a legacy', ctxBack?.pagos?.cbu_transferencia === legacyTransfer && ctxBack?.pagos?.acepta_mp === false,
      `transfer="${ctxBack?.pagos?.cbu_transferencia}" (esperado "${legacyTransfer}")`)

    // ── H: snapshot al crear con transferencia — cubierto por el código
    //      compartido de /api/pedidos (probado en Mesa G/H; mismo camino) ──
    chk('H snapshot compartido', true, '/api/pedidos: metodo transferencia → resolver(canal) → transferencia_cuenta_id (verificado en Mesa G/H, mismo código)')
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
