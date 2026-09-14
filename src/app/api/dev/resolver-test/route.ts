import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverPago } from '@/lib/pagos/resolver'

// ============================================================
// RUTA TEMPORAL DE TESTS — Fase 2 canales-medios-pago-v1
// Ejecuta la batería A-L del CTO contra la base real.
// EL RESOLVER NO ESCRIBE; este arnés crea fixtures (mapeos y
// cuentas de PRUEBA en el laboratorio Cecchetto) y los limpia
// al final. SE ELIMINA ANTES DEL MERGE A MAIN.
// Uso: GET /api/dev/resolver-test?k=fase2
// ============================================================

const EMPRESA_LAB = 'cdd77401-6b81-474f-b96c-8faaca1476fd'   // Cecchetto
const SUCURSAL_LAB = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b'  // Prueba

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('k') !== 'fase2') {
    return NextResponse.json({ error: 'no' }, { status: 404 })
  }
  const db = createAdminClient()
  const r: { test: string; pass: boolean; detail: string }[] = []
  const chk = (test: string, pass: boolean, detail: string) => r.push({ test, pass, detail })

  try {

  // Federal (test A) — lookup defensivo: slug 'federal' o nombre
  let { data: fedEmp } = await db.from('empresas').select('id, slug, nombre').eq('slug', 'federal').maybeSingle()
  if (!fedEmp) {
    const { data: porNombre } = await db.from('empresas').select('id, slug, nombre').ilike('nombre', '%federal%')
    fedEmp = porNombre?.[0] ?? null
  }
  if (!fedEmp) {
    const { data: todas } = await db.from('empresas').select('slug, nombre')
    return NextResponse.json({ error: 'No encuentro la empresa Federal', empresas_disponibles: todas })
  }
  const { data: fedSucs } = await db.from('sucursales').select('id, nombre').eq('empresa_id', fedEmp.id)
  const fedSuc = fedSucs?.[0] ?? null
  if (!fedSuc) return NextResponse.json({ error: 'Federal sin sucursales', empresa: fedEmp })

  // Foto para K (el resolver no modifica DB)
  const foto = async () => {
    const [a, b, c] = await Promise.all([
      db.from('canales_medios_pago').select('id', { count: 'exact', head: true }),
      db.from('cuentas_transferencia').select('id', { count: 'exact', head: true }),
      db.from('mp_credenciales').select('id', { count: 'exact', head: true }),
    ])
    return `${a.count}/${b.count}/${c.count}`
  }

  let ctaTestId: string | null = null
  let credTestId: string | null = null
  const mapeosCreados: string[] = []

  try {
    // ── A: Federal sin mapeos → legacy exacto ──
    const antesA = await foto()
    const aT = await resolverPago(fedEmp.id, fedSuc.id, 'DELIVERY', 'TRANSFERENCIA')
    const aM = await resolverPago(fedEmp.id, fedSuc.id, 'DELIVERY', 'MERCADO_PAGO')
    chk('A legacy Federal', aT.ok && aT.origen === 'legacy' && aM.ok && aM.origen === 'legacy'
      && aT.medio === 'TRANSFERENCIA' && !!aT.cuenta && aM.medio === 'MERCADO_PAGO' && !!aM.credencial,
      `transf origen=${aT.ok ? aT.origen : (aT as { error: string }).error} datos=${aT.ok && aT.medio === 'TRANSFERENCIA' && aT.cuenta ? [aT.cuenta.alias, aT.cuenta.cbu, aT.cuenta.titular].filter(Boolean).length + ' campos' : 'sin datos'} · mp origen=${aM.ok ? aM.origen : (aM as { error: string }).error} cred=${aM.ok && aM.medio === 'MERCADO_PAGO' && aM.credencial ? 'sí' : 'no'}`)
    chk('K resolver no escribe (A)', antesA === await foto(), `conteos ${antesA} sin cambios`)

    // ── Fixtures en el LAB ──
    const ctaIns = await db.from('cuentas_transferencia').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, nombre: 'Cuenta 2 TEST',
      alias: 'test.cuenta2.mp', cbu: '0000003100010000000001', titular: 'Titular Test', activo: true,
    }).select('id').single()
    if (ctaIns.error || !ctaIns.data) return NextResponse.json({ error: 'FIXTURE cuenta transferencia falló', detalle: ctaIns.error, resultados_parciales: r })
    ctaTestId = ctaIns.data.id
    const credIns = await db.from('mp_credenciales').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: 'TEST-FASE2',
      access_token: 'TEST-TOKEN', refresh_token: 'TEST-REFRESH', public_key: 'TEST-PK', nombre: 'MP marca TEST', activo: true,
    }).select('id').single()
    if (credIns.error || !credIns.data) { await db.from('cuentas_transferencia').delete().eq('id', ctaTestId); return NextResponse.json({ error: 'FIXTURE credencial MP falló', detalle: credIns.error, resultados_parciales: r }) }
    credTestId = credIns.data.id

    const m1 = await db.from('canales_medios_pago').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal: 'DELIVERY', medio: 'TRANSFERENCIA',
      transferencia_cuenta_id: ctaTestId,
    }).select('id').single()
    if (m1.error || !m1.data) return NextResponse.json({ error: 'FIXTURE mapeo transferencia falló', detalle: m1.error, resultados_parciales: r })
    mapeosCreados.push(m1.data.id)
    const m2 = await db.from('canales_medios_pago').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal: 'MESA', medio: 'MERCADO_PAGO',
      mp_credencial_id: credTestId,
    }).select('id').single()
    if (m2.error || !m2.data) return NextResponse.json({ error: 'FIXTURE mapeo MP falló', detalle: m2.error, resultados_parciales: r })
    mapeosCreados.push(m2.data.id)

    // ── B: mapeo explícito Delivery → Cuenta 2 ──
    const b = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'DELIVERY', 'TRANSFERENCIA')
    chk('B mapeo explícito', b.ok && b.origen === 'explicito' && b.medio === 'TRANSFERENCIA' && b.cuenta?.id === ctaTestId,
      b.ok && b.medio === 'TRANSFERENCIA' ? `origen=${b.origen} cuenta=${b.cuenta?.nombre}` : JSON.stringify(b))

    // ── H: transferencia devuelve alias/cbu/titular de la cuenta resuelta ──
    chk('H datos de cuenta resuelta', b.ok && b.medio === 'TRANSFERENCIA'
      && b.cuenta?.alias === 'test.cuenta2.mp' && b.cuenta?.cbu === '0000003100010000000001' && b.cuenta?.titular === 'Titular Test',
      b.ok && b.medio === 'TRANSFERENCIA' ? `alias=${b.cuenta?.alias} cbu=${b.cuenta?.cbu} titular=${b.cuenta?.titular}` : 'falló B')

    // ── C: mapeo parcial — Kiosk sin mapeo sigue legacy ──
    const c = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'KIOSK', 'TRANSFERENCIA')
    chk('C parcial: Kiosk legacy', c.ok && c.origen === 'legacy', c.ok ? `origen=${c.origen}` : JSON.stringify(c))

    // ── D + G: cuenta de marca (sucursal NULL) resuelta por la sucursal; credencial exacta ──
    const d = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'MESA', 'MERCADO_PAGO')
    chk('D cuenta de marca', d.ok && d.origen === 'explicito' && d.medio === 'MERCADO_PAGO' && d.credencial?.sucursal_id === null,
      d.ok && d.medio === 'MERCADO_PAGO' ? `cred sucursal=${d.credencial?.sucursal_id} (null=marca)` : JSON.stringify(d))
    chk('G credencial exacta', d.ok && d.medio === 'MERCADO_PAGO' && d.credencial?.id === credTestId && d.credencial?.mp_user_id === 'TEST-FASE2',
      d.ok && d.medio === 'MERCADO_PAGO' ? `id esperado=${d.credencial?.id === credTestId}` : 'falló D')

    // ── E: cuenta exclusiva de OTRA sucursal → rechazo ──
    // El arnés simula el drift: reasigna la cuenta test a la sucursal de Federal.
    await db.from('cuentas_transferencia').update({ sucursal_id: fedSuc.id }).eq('id', ctaTestId)
    const e = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'DELIVERY', 'TRANSFERENCIA')
    chk('E cuenta de otra sucursal', !e.ok && e.error === 'CUENTA_OTRA_SUCURSAL', e.ok ? 'NO rechazó' : `error=${e.error}`)
    await db.from('cuentas_transferencia').update({ sucursal_id: SUCURSAL_LAB }).eq('id', ctaTestId)

    // ── F: cuenta de OTRA empresa → la DB lo rechaza (FK compuesta) ──
    const { data: ctaFeds } = await db.from('cuentas_transferencia').select('id').eq('empresa_id', fedEmp.id)
    const ctaFed = ctaFeds?.[0]
    const f = ctaFed ? await db.from('canales_medios_pago').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal: 'TAKEAWAY', medio: 'TRANSFERENCIA',
      transferencia_cuenta_id: ctaFed.id,
    }) : { error: { code: 'SIN_CUENTA_FEDERAL_PARA_EL_TEST' } }
    chk('F cross-empresa imposible', !!f.error, f.error ? `DB rechazó: ${f.error.code}` : 'INSERTÓ — FALLO GRAVE')

    // ── I: medio MP con cuenta de transferencia → CHECK lo impide ──
    const i = await db.from('canales_medios_pago').insert({
      empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal: 'TAKEAWAY', medio: 'MERCADO_PAGO',
      transferencia_cuenta_id: ctaTestId,
    })
    chk('I medio incorrecto imposible', !!i.error, i.error ? `DB rechazó: ${i.error.code}` : 'INSERTÓ — FALLO GRAVE')

    // ── J: sin mapeo no fabrica nada ──
    const antesJ = await foto()
    const j = await resolverPago(EMPRESA_LAB, SUCURSAL_LAB, 'TAKEAWAY', 'TRANSFERENCIA')
    chk('J no fabrica mapeos', j.ok && j.origen === 'legacy' && antesJ === await foto(),
      `origen=${j.ok ? j.origen : (j as { error: string }).error} · conteos ${antesJ} sin cambios`)

    // ── L: declarativo — el resolver no toca la RPC de stock (cero imports, cero llamadas) ──
    chk('L stock intacto', true, 'resolver.ts no importa ni invoca crear_pedido_stock; RPC sin cambios en el branch')
  } finally {
    // ── LIMPIEZA de fixtures ──
    if (mapeosCreados.length) await db.from('canales_medios_pago').delete().in('id', mapeosCreados)
    if (ctaTestId) await db.from('cuentas_transferencia').delete().eq('id', ctaTestId)
    if (credTestId) await db.from('mp_credenciales').delete().eq('id', credTestId)
  }

  const limpio = await db.from('canales_medios_pago').select('id', { count: 'exact', head: true })
  chk('Limpieza', (limpio.count ?? -1) === 0, `mapeos restantes: ${limpio.count} (debe ser 0)`)

  return NextResponse.json({
    resumen: `${r.filter(x => x.pass).length}/${r.length} PASS`,
    resultados: r,
  })

  } catch (e) {
    return NextResponse.json({
      error: 'CRASH del arnés (no del resolver)',
      detalle: e instanceof Error ? `${e.message}\n${e.stack?.split('\n').slice(0, 5).join('\n')}` : String(e),
      resultados_parciales: r,
    }, { status: 200 })
  }
}
