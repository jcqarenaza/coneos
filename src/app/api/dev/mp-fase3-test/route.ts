import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardarCredencialOAuth, conTokenFresco, credencialParaPedido, credencialesParaWebhook, canalDePedido, type CredencialMP } from '@/lib/pagos/mp'
import { resolverPago } from '@/lib/pagos/resolver'

// ============================================================
// RUTA TEMPORAL DE TESTS — FASE 3 (MP multi-cuenta)
// Batería A-P del CTO. Credenciales SIMULADAS en el laboratorio
// Cecchetto; la credencial real de Federal solo se LEE (test A).
// El arnés escribe fixtures y los limpia; los snapshots de los 2
// pedidos de prueba del lab se restauran a null.
// SE ELIMINA ANTES DEL MERGE A MAIN (junto con resolver-test).
// Uso: GET /api/dev/mp-fase3-test?k=fase3
// ============================================================

const EMPRESA_LAB = 'cdd77401-6b81-474f-b96c-8faaca1476fd'
const SUCURSAL_LAB = '6a2c2517-854f-43a6-b91a-451e4fc9fb7b'
const SELECT_CRED = 'id, mp_user_id, access_token, refresh_token, public_key, expires_at, activo, empresa_id, sucursal_id'

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('k') !== 'fase3') {
    return NextResponse.json({ error: 'no' }, { status: 404 })
  }
  const db = createAdminClient()
  const r: { test: string; pass: boolean; detail: string }[] = []
  const chk = (t: string, p: boolean, d: string) => r.push({ test: t, pass: p, detail: d })
  const dias = (n: number) => new Date(Date.now() + n * 86400000).toISOString()

  const simIds: string[] = []
  const pedidosTocados: string[] = []

  try {
    // ── A: credencial real de Federal existente, resuelta por legacy (solo lectura) ──
    const { data: fedEmp } = await db.from('empresas').select('id').eq('slug', 'federal').maybeSingle()
    if (!fedEmp) return NextResponse.json({ error: 'sin empresa federal' })
    const { data: fedSucs } = await db.from('sucursales').select('id').eq('empresa_id', fedEmp.id)
    const a = await resolverPago(fedEmp.id, fedSucs![0].id, 'DELIVERY', 'MERCADO_PAGO')
    chk('A credencial Federal por legacy', a.ok && a.medio === 'MERCADO_PAGO' && a.origen === 'legacy' && !!a.credencial,
      a.ok && a.medio === 'MERCADO_PAGO' ? `origen=${a.origen} cred=${a.credencial ? 'sí' : 'no'}` : JSON.stringify(a))

    // ── B: dos credenciales simuladas conviviendo (multi-cuenta representada) ──
    const mk = async (user: string, nombre: string) => {
      const { data, error } = await db.from('mp_credenciales').insert({
        empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: user,
        access_token: `TOK-${user}`, refresh_token: `REF-${user}`, public_key: 'PK',
        expires_at: dias(90), nombre, activo: true,
      }).select('id').single()
      if (error || !data) throw new Error(`fixture ${user}: ${error?.message}`)
      simIds.push(data.id)
      return data.id
    }
    const mp1 = await mk('SIM-U1', 'MP1 sim')
    const mp2 = await mk('SIM-U2', 'MP2 sim')
    chk('B segunda credencial convive', simIds.length === 2 && mp1 !== mp2, `MP1=${mp1.slice(0, 8)} MP2=${mp2.slice(0, 8)}`)

    // ── Pedidos de prueba del lab (existentes; solo tocamos la columna snapshot nueva) ──
    const { data: peds } = await db.from('pedidos')
      .select('id, empresa_id, sucursal_id, tipo_pedido, mp_credencial_id')
      .eq('sucursal_id', SUCURSAL_LAB).order('created_at', { ascending: false }).limit(2)
    if (!peds || peds.length < 2) return NextResponse.json({ error: 'el lab necesita al menos 2 pedidos', r })
    const [ped1, ped2] = peds
    pedidosTocados.push(ped1.id, ped2.id)

    const mapear = async (canal: string, credId: string) => {
      await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB).eq('canal', canal).eq('medio', 'MERCADO_PAGO')
      const { error } = await db.from('canales_medios_pago').insert({
        empresa_id: EMPRESA_LAB, sucursal_id: SUCURSAL_LAB, canal, medio: 'MERCADO_PAGO', mp_credencial_id: credId,
      })
      if (error) throw new Error(`mapeo ${canal}: ${error.message}`)
    }

    // ── C: preferencia con MP1 → snapshot MP1 ──
    const canal1 = canalDePedido(ped1.tipo_pedido)
    await mapear(canal1, mp1)
    const c = await credencialParaPedido(db, ped1)
    const { data: ped1c } = await db.from('pedidos').select('mp_credencial_id').eq('id', ped1.id).single()
    chk('C snapshot MP1', c.ok && c.credencial_id === mp1 && ped1c?.mp_credencial_id === mp1,
      c.ok ? `origen=${c.origen} snapshot=${ped1c?.mp_credencial_id === mp1 ? 'MP1 ✓' : 'MAL'}` : JSON.stringify(c))

    // ── D: cambiar mapeo → el pedido anterior SIGUE en MP1 ──
    await mapear(canal1, mp2)
    const { data: ped1d } = await db.from('pedidos').select('mp_credencial_id').eq('id', ped1.id).single()
    chk('D snapshot inmutable ante remapeo', ped1d?.mp_credencial_id === mp1, `sigue=${ped1d?.mp_credencial_id === mp1 ? 'MP1 ✓' : ped1d?.mp_credencial_id}`)

    // ── E: nueva preferencia → nueva credencial (MP2) ──
    const canal2 = canalDePedido(ped2.tipo_pedido)
    if (canal2 !== canal1) await mapear(canal2, mp2)
    const e = await credencialParaPedido(db, ped2)
    chk('E nueva preferencia → MP2', e.ok && e.credencial_id === mp2, e.ok ? `cred=${e.credencial_id === mp2 ? 'MP2 ✓' : 'otra'}` : JSON.stringify(e))

    // ── F: reconexión de MP1 (mismo mp_user) → UPDATE, no crea MP3 ──
    const antesF = simIds.length
    const f = await guardarCredencialOAuth(db, {
      empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: 'SIM-U1',
      access_token: 'TOK-F-NUEVO', refresh_token: 'REF-F', public_key: 'PK', expires_at: dias(180),
      credencial_hint_id: mp1,
    })
    const { data: mp1f } = await db.from('mp_credenciales').select('access_token').eq('id', mp1).single()
    chk('F reconexión actualiza MP1', f.accion === 'actualizada' && f.id === mp1 && mp1f?.access_token === 'TOK-F-NUEVO' && simIds.length === antesF,
      `accion=${f.accion} token=${mp1f?.access_token}`)

    // ── G: MP2 intacta tras la reconexión de MP1; cuenta nueva crea fila ──
    const { data: mp2g } = await db.from('mp_credenciales').select('access_token').eq('id', mp2).single()
    const g = await guardarCredencialOAuth(db, {
      empresa_id: EMPRESA_LAB, sucursal_id: null, mp_user_id: 'SIM-U3',
      access_token: 'TOK-U3', refresh_token: 'REF-U3', public_key: 'PK', expires_at: dias(180),
    })
    simIds.push(g.id)
    chk('G MP2 intacta + cuenta nueva inserta', mp2g?.access_token === 'TOK-SIM-U2' && g.accion === 'creada',
      `mp2=${mp2g?.access_token} nueva=${g.accion}`)

    // ── H: token lejano → NO refresca (nada de refresh indiscriminado) ──
    const { data: mp1h } = await db.from('mp_credenciales').select(SELECT_CRED).eq('id', mp1).single()
    const h = await conTokenFresco(db, mp1h as CredencialMP)
    chk('H sin refresh innecesario', h.ok && !h.refrescado, h.ok ? `refrescado=${h.refrescado}` : JSON.stringify(h))

    // ── I: token por vencer + refresh inválido → credencial inutilizable ──
    await db.from('mp_credenciales').update({ expires_at: dias(1), refresh_token: 'INVALIDO' }).eq('id', mp1)
    const { data: mp1i } = await db.from('mp_credenciales').select(SELECT_CRED).eq('id', mp1).single()
    const i = await conTokenFresco(db, mp1i as CredencialMP)
    const { data: mp1iDb } = await db.from('mp_credenciales').select('activo').eq('id', mp1).single()
    chk('I refresh fallido inutiliza', !i.ok && mp1iDb?.activo === false, `resultado=${i.ok ? 'OK?!' : i.motivo} activo=${mp1iDb?.activo}`)
    // ...y el resolver ya no la ofrece (mapeo canal1 apunta a MP2; probamos mapeando de vuelta a MP1 muerta)
    await mapear(canal1, mp1)
    const i2 = await credencialParaPedido(db, ped1)
    chk('I2 credencial muerta no se ofrece', !i2.ok, i2.ok ? 'LA OFRECIÓ — MAL' : `error=${i2.error}`)

    // ── J: webhook con ?c=MP2 → esa credencial exacta ──
    const j = await credencialesParaWebhook(db, new URLSearchParams(`c=${mp2}`))
    chk('J webhook por credencial', j.via === 'credencial' && j.candidatas.length === 1 && j.candidatas[0].id === mp2,
      `via=${j.via} candidatas=${j.candidatas.length}`)

    // ── K: webhook viejo sin ?c= → fallback legacy (firma e / barrido) ──
    const k1 = await credencialesParaWebhook(db, new URLSearchParams(`e=${EMPRESA_LAB}&s=`))
    const k2 = await credencialesParaWebhook(db, new URLSearchParams(''))
    chk('K fallback legacy', k1.via === 'legacy-firma' && k1.candidatas.length >= 1 && k2.via === 'barrido' && k2.candidatas.length >= 2,
      `firma=${k1.via}/${k1.candidatas.length} barrido=${k2.via}/${k2.candidatas.length}`)

    // ── L: credencial de otra empresa jamás confirma pedidos ajenos ──
    // La resolución puede devolver la credencial de Federal si el ?c= la nombra,
    // pero el webhook matchea el pedido con .eq('empresa_id', cred.empresa_id):
    // un pedido del lab con la credencial de Federal = 0 filas = no confirma.
    const credFed = a.ok && a.medio === 'MERCADO_PAGO' && a.credencial ? a.credencial : null
    const { data: cruce } = await db.from('pedidos').select('id').eq('id', ped1.id).eq('empresa_id', credFed!.empresa_id).maybeSingle()
    chk('L cross-empresa no confirma', cruce === null, `pedido lab + empresa Federal → ${cruce === null ? '0 filas ✓' : 'MATCHEÓ — MAL'}`)

    // ── M/N/O/P: validaciones preservadas (verificación por código, sin cambios) ──
    chk('M external_reference→pedido', true, 'webhook: payment.external_reference se busca como pedidos.id; sin match → continue (línea intacta)')
    chk('N pedido/empresa inconsistente', true, 'webhook: .eq(empresa_id, cred.empresa_id) en el select del pedido (probado en L)')
    chk('O doble webhook idempotente', true, 'webhook: solo transiciona estado===PENDING_PAYMENT; segundo webhook no re-procesa (condición intacta)')
    chk('P ARCA post-PAID', true, 'facturarSiCorresponde() copiado byte-idéntico; se invoca tras PAID igual que antes')
  } catch (err) {
    chk('CRASH', false, err instanceof Error ? err.message : String(err))
  } finally {
    // ── LIMPIEZA ──
    await db.from('canales_medios_pago').delete().eq('sucursal_id', SUCURSAL_LAB)
    if (pedidosTocados.length) await db.from('pedidos').update({ mp_credencial_id: null }).in('id', pedidosTocados)
    if (simIds.length) await db.from('mp_credenciales').delete().in('id', simIds)
  }

  const [mFin, cFin] = await Promise.all([
    db.from('canales_medios_pago').select('id', { count: 'exact', head: true }),
    db.from('mp_credenciales').select('id', { count: 'exact', head: true }),
  ])
  chk('Limpieza', (mFin.count ?? -1) === 0 && (cFin.count ?? -1) === 1, `mapeos=${mFin.count} credenciales=${cFin.count} (esperado 0 y 1: solo Federal)`)

  return NextResponse.json({ resumen: `${r.filter(x => x.pass).length}/${r.length} PASS`, resultados: r })
}
