import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

// ============================================================
// /api/admin/cuits — MULTI-CUIT B5 (JC 25/09)
// Autoservicio de emisores fiscales (facturacion_config) desde
// Cuentas y cobros. Identidad: Bearer del admin bajo RLS (patrón
// pagos-cuentas); mutación: admin client server-side (regla de la
// casa) con la empresa SIEMPRE tomada de la sesión, jamás del body.
// REGLAS DURAS: key_pem/cert_pem WRITE-ONLY (el GET devuelve
// booleans) · vacío = no pisar · ambiente fijo 'produccion' (no se
// expone) · emite_factura_a NO se toca (FA-2) · la config fallback
// se escribe con sucursal_id explícito · editar datos fiscales
// vuelve la config a borrador y la desactiva (revalidar es
// obligatorio) · vincular exige validado + activo (409 si no).
// ============================================================

const err = (mensaje: string, status = 400) => NextResponse.json({ error: mensaje }, { status })

function rlsClient(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  )
}
async function empresaDelAdmin(db: NonNullable<ReturnType<typeof rlsClient>>) {
  const { data } = await db.from('empresas').select('id').limit(1).maybeSingle()
  return data?.id as string | undefined
}

function cuitValido(cuit: string): boolean {
  const d = (cuit ?? '').replace(/\D/g, '')
  if (d.length !== 11) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = mult.reduce((a, m, i) => a + m * Number(d[i]), 0)
  const resto = 11 - (suma % 11)
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto
  return dv === Number(d[10])
}
const METODOS_VALIDOS = ['transferencia', 'efectivo', 'mp', 'debito', 'credito']
const CONDS = ['monotributo', 'ri']

const CAMPOS_SEGUROS = 'id, sucursal_id, cuit, razon_social, condicion_fiscal, punto_venta, activo, estado, es_fallback, auto_facturar, metodos_auto, cert_pem, key_pem'
function sanitizar(row: Record<string, unknown>) {
  const { cert_pem, key_pem, ...resto } = row
  return { ...resto, cert_cargado: !!cert_pem, clave_cargada: !!key_pem }
}

export async function GET(request: Request) {
  const db = rlsClient(request)
  if (!db) return err('Sesión requerida', 401)
  const empresa_id = await empresaDelAdmin(db)
  if (!empresa_id) return err('Sesión inválida', 401)
  const admin = createAdminClient()
  const { data } = await admin.from('facturacion_config')
    .select(CAMPOS_SEGUROS).eq('empresa_id', empresa_id).order('created_at')
  return NextResponse.json({ cuits: (data ?? []).map(r => sanitizar(r as Record<string, unknown>)) })
}

export async function POST(request: Request) {
  const db = rlsClient(request)
  if (!db) return err('Sesión requerida', 401)
  const empresa_id = await empresaDelAdmin(db)
  if (!empresa_id) return err('Sesión inválida', 401)
  const admin = createAdminClient()
  const body = await request.json().catch(() => null)
  if (!body?.accion) return err('Acción requerida')

  switch (body.accion) {
    case 'crear_cuit': {
      const cuit = String(body.cuit ?? '').replace(/\D/g, '')
      const razon = String(body.razon_social ?? '').trim()
      const cond = String(body.condicion_fiscal ?? '')
      const pv = Number(body.punto_venta)
      if (!cuitValido(cuit)) return err('CUIT inválido (verificá los 11 dígitos)')
      if (!razon) return err('La razón social es obligatoria')
      if (!CONDS.includes(cond)) return err('Condición fiscal inválida')
      if (!Number.isInteger(pv) || pv < 1) return err('Punto de venta inválido')
      // Primera config de la empresa = PRINCIPAL (fallback); las demás nacen
      // adicionales: invisibles al fallback, alcanzables solo por vínculo.
      const { count } = await admin.from('facturacion_config')
        .select('id', { count: 'exact', head: true }).eq('empresa_id', empresa_id)
      const esPrimera = (count ?? 0) === 0
      const { data, error } = await admin.from('facturacion_config').insert({
        empresa_id, sucursal_id: null, cuit, razon_social: razon, condicion_fiscal: cond,
        punto_venta: pv, ambiente: 'produccion', activo: false, estado: 'borrador',
        es_fallback: esPrimera, auto_facturar: true, metodos_auto: ['transferencia'],
        cert_pem: String(body.cert_pem ?? '').trim() || null,
        key_pem: String(body.key_pem ?? '').trim() || null,
      }).select('id').single()
      if (error || !data) return err('No se pudo crear el CUIT')
      return NextResponse.json({ ok: true, id: data.id, principal: esPrimera })
    }

    case 'editar_cuit': {
      const { cuit_id } = body
      if (!cuit_id) return err('Datos incompletos')
      const { data: actual } = await admin.from('facturacion_config')
        .select('id, cuit, punto_venta, condicion_fiscal, estado').eq('id', cuit_id).eq('empresa_id', empresa_id).maybeSingle()
      if (!actual) return err('Ese CUIT no existe o no es de tu empresa', 403)
      const upd: Record<string, unknown> = {}
      let revalida = false
      if (body.razon_social !== undefined) {
        const razon = String(body.razon_social).trim()
        if (!razon) return err('La razón social es obligatoria')
        upd.razon_social = razon
      }
      if (body.cuit !== undefined) {
        const cuit = String(body.cuit).replace(/\D/g, '')
        if (!cuitValido(cuit)) return err('CUIT inválido')
        if (cuit !== actual.cuit) revalida = true
        upd.cuit = cuit
      }
      if (body.condicion_fiscal !== undefined) {
        if (!CONDS.includes(body.condicion_fiscal)) return err('Condición fiscal inválida')
        if (body.condicion_fiscal !== actual.condicion_fiscal) revalida = true
        upd.condicion_fiscal = body.condicion_fiscal
      }
      if (body.punto_venta !== undefined) {
        const pv = Number(body.punto_venta)
        if (!Number.isInteger(pv) || pv < 1) return err('Punto de venta inválido')
        if (pv !== actual.punto_venta) revalida = true
        upd.punto_venta = pv
      }
      // vacío = NO pisar (regla dura): solo contenido nuevo reemplaza
      if (String(body.cert_pem ?? '').trim()) { upd.cert_pem = String(body.cert_pem).trim(); revalida = true }
      if (String(body.key_pem ?? '').trim()) { upd.key_pem = String(body.key_pem).trim(); revalida = true }
      if (Object.keys(upd).length === 0) return err('Nada para actualizar')
      // Cambió algo fiscalmente relevante → vuelve a borrador y se apaga:
      // revalidar contra ARCA es obligatorio antes de volver a emitir.
      if (revalida) { upd.estado = 'borrador'; upd.activo = false }
      upd.updated_at = new Date().toISOString()
      const { error } = await admin.from('facturacion_config').update(upd).eq('id', cuit_id).eq('empresa_id', empresa_id)
      if (error) return err('No se pudo guardar')
      return NextResponse.json({ ok: true, revalidar: revalida })
    }

    case 'probar_cuit': {
      const { cuit_id } = body
      if (!cuit_id) return err('Datos incompletos')
      const { data: cfg } = await admin.from('facturacion_config')
        .select('id, cuit, punto_venta, cert_pem, key_pem').eq('id', cuit_id).eq('empresa_id', empresa_id).maybeSingle()
      if (!cfg) return err('Ese CUIT no existe o no es de tu empresa', 403)
      if (!cfg.cert_pem || !cfg.key_pem) return err('Cargá el certificado y la clave privada antes de probar', 409)
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!url || !serviceKey) return err('Faltan variables de entorno', 500)
      const res = await fetch(`${url}/functions/v1/arca-facturar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id, accion: 'test', facturacion_config_id: cuit_id }),
      })
      const d = await res.json().catch(() => null)
      if (!d?.ok) return NextResponse.json({ ok: false, error: d?.error ?? 'ARCA no respondió — revisá certificado, relación wsfe y punto de venta' }, { status: 409 })
      await admin.from('facturacion_config')
        .update({ estado: 'validado', updated_at: new Date().toISOString() })
        .eq('id', cuit_id).eq('empresa_id', empresa_id)
      return NextResponse.json({ ok: true, cuit: d.cuit, punto_venta: d.punto_venta, ultimo_cbte: d.ultimo_cbte_tipo11 })
    }

    case 'toggle_activo_cuit': {
      const { cuit_id, activo } = body
      if (!cuit_id || typeof activo !== 'boolean') return err('Datos incompletos')
      if (activo) {
        const { data: cfg } = await admin.from('facturacion_config')
          .select('estado, cuit, punto_venta, cert_pem, key_pem').eq('id', cuit_id).eq('empresa_id', empresa_id).maybeSingle()
        if (!cfg) return err('Ese CUIT no existe o no es de tu empresa', 403)
        if (cfg.estado !== 'validado') return err('Probá la conexión con ARCA antes de activar', 409)
        if (!cfg.cuit || !cfg.punto_venta || !cfg.cert_pem || !cfg.key_pem) return err('La configuración está incompleta', 409)
      }
      const { error } = await admin.from('facturacion_config')
        .update({ activo, updated_at: new Date().toISOString() }).eq('id', cuit_id).eq('empresa_id', empresa_id)
      if (error) return err('No se pudo actualizar')
      return NextResponse.json({ ok: true })
    }

    case 'metodos_cuit': {
      const { cuit_id, auto_facturar, metodos_auto } = body
      if (!cuit_id) return err('Datos incompletos')
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (typeof auto_facturar === 'boolean') upd.auto_facturar = auto_facturar
      if (Array.isArray(metodos_auto)) upd.metodos_auto = metodos_auto.filter((m: string) => METODOS_VALIDOS.includes(m))
      const { error, count } = await admin.from('facturacion_config')
        .update(upd, { count: 'exact' }).eq('id', cuit_id).eq('empresa_id', empresa_id)
      if (error || !count) return err('No se pudo actualizar')
      return NextResponse.json({ ok: true })
    }

    case 'vincular_cuit': {
      // "Factura como…": la cuenta apunta a su emisor. null = quitar (vuelve
      // al CUIT principal por fallback). Vincular exige validado + activo.
      const { tipo, cuenta_id, cuit_id } = body
      if (!cuenta_id || !['transferencia', 'mp'].includes(tipo)) return err('Datos incompletos')
      if (cuit_id) {
        const { data: cfg } = await admin.from('facturacion_config')
          .select('estado, activo').eq('id', cuit_id).eq('empresa_id', empresa_id).maybeSingle()
        if (!cfg) return err('Ese CUIT no existe o no es de tu empresa', 403)
        if (cfg.estado !== 'validado') return err('Ese CUIT todavía no está validado con ARCA', 409)
        if (!cfg.activo) return err('Ese CUIT está desactivado — activalo antes de vincularlo', 409)
      }
      const tabla = tipo === 'transferencia' ? 'cuentas_transferencia' : 'mp_credenciales'
      const { error, count } = await admin.from(tabla)
        .update({ facturacion_config_id: cuit_id ?? null, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', cuenta_id).eq('empresa_id', empresa_id)
      if (error || !count) return err('No se pudo vincular')
      return NextResponse.json({ ok: true })
    }

    default:
      return err('Acción desconocida')
  }
}
