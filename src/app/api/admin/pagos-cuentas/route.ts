import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolverPago, type CanalPago } from '@/lib/pagos/resolver'

// ============================================================
// /api/admin/pagos-cuentas — Fase 6.2 canales-medios-pago
// ÚNICO endpoint de escritura de la configuración de cuentas y
// de la matriz canal → medio → cuenta.
//
// Seguridad: corre BAJO LA RLS DEL USUARIO (el cliente manda su
// token de sesión; acá se crea un cliente Supabase con ese token)
// → la base misma limita todo a la empresa del admin, y encima
// el server valida lo que la RLS no puede expresar (patrón
// server-authoritative de la RPC v1.1):
//   · sucursal ∈ empresa
//   · cuenta ∈ empresa y con el SCOPE correcto (exclusiva de la
//     sucursal para transferencia; sucursal propia o marca para MP)
//   · cuenta ACTIVA para asignar mapeos nuevos (invariante CTO:
//     inactiva no se asigna; si se desactiva DESPUÉS, el mapeo
//     NO se borra — el resolver es la autoridad en runtime)
//   · medio coherente con el tipo de cuenta
//   · unicidad (sucursal, canal, medio) — el UNIQUE de DB de respaldo
// Este endpoint JAMÁS toca: resolver, OAuth, webhook, ARCA, Stock,
// RPC, numeración, pedido_pagos. Nunca lee tokens MP.
// CICLO 1 (opción A, GO CTO 21/09): set_llave es el ÚNICO camino de
// escritura sobre sucursal_pagos, y SOLO sobre las llaves ON/OFF por
// canal — jamás alias/titular/cbu legacy, jamás las bases globales.
// ============================================================

const CANALES = ['KIOSK', 'DELIVERY', 'MESA', 'TAKEAWAY', 'CAJA'] as const
const MEDIOS = ['TRANSFERENCIA', 'MERCADO_PAGO'] as const

function rlsClient(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  )
}

const err = (mensaje: string, status = 400) => NextResponse.json({ error: mensaje }, { status })

// La empresa del admin sale de la RLS misma: la única fila visible.
async function empresaDelAdmin(db: NonNullable<ReturnType<typeof rlsClient>>) {
  const { data } = await db.from('empresas').select('id').limit(1).maybeSingle()
  return data?.id as string | undefined
}

async function sucursalValida(db: NonNullable<ReturnType<typeof rlsClient>>, empresa_id: string, sucursal_id: string) {
  const { data } = await db.from('sucursales').select('id').eq('id', sucursal_id).eq('empresa_id', empresa_id).maybeSingle()
  return !!data
}

export async function GET(request: Request) {
  const db = rlsClient(request)
  if (!db) return err('Sesión requerida', 401)
  const empresa_id = await empresaDelAdmin(db)
  if (!empresa_id) return err('Sesión inválida', 401)

  const { searchParams } = new URL(request.url)
  const sucursal_id = searchParams.get('sucursal_id')

  const [creds, cuentas, sucursales] = await Promise.all([
    db.from('mp_credenciales')
      .select('id, nombre, activo, sucursal_id, mp_user_id, expires_at, created_at, facturacion_config_id') // B5: vínculo al emisor
      .eq('empresa_id', empresa_id).order('created_at'),
    db.from('cuentas_transferencia')
      .select('id, nombre, alias, cbu, titular, activo, sucursal_id, created_at, facturacion_config_id') // B5: vínculo al emisor
      .eq('empresa_id', empresa_id).order('created_at'),
    db.from('sucursales').select('id, nombre').eq('empresa_id', empresa_id).order('nombre'),
  ])

  // Ciclo 1: módulos contratados de la empresa — la grilla oculta canales
  // cuyo módulo está apagado (empresa-level; el activo por sucursal NO oculta:
  // se configura pagos aunque el canal esté momentáneamente cerrado)
  const { data: cfgMod } = await db.from('empresa_config').select('modulos').eq('empresa_id', empresa_id).maybeSingle()

  let mapeos: unknown[] = []
  let llaves: unknown = null
  if (sucursal_id) {
    if (!(await sucursalValida(db, empresa_id, sucursal_id))) return err('Sucursal inválida', 403)
    const [m, l] = await Promise.all([
      db.from('canales_medios_pago')
        .select('canal, medio, mp_credencial_id, transferencia_cuenta_id')
        .eq('sucursal_id', sucursal_id),
      db.from('sucursal_pagos')
        .select('acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_kiosk, acepta_mp_delivery, acepta_mp_mesa, acepta_mp_takeaway, acepta_efectivo_kiosk, acepta_efectivo_delivery, acepta_efectivo_mesa, acepta_efectivo_takeaway, acepta_transferencia_kiosk, acepta_transferencia_delivery, acepta_transferencia_mesa, acepta_transferencia_takeaway')
        .eq('sucursal_id', sucursal_id).maybeSingle(),
    ])
    mapeos = m.data ?? []
    llaves = l.data ?? null
  }

  return NextResponse.json({
    empresa_id,
    sucursales: sucursales.data ?? [],
    credenciales: creds.data ?? [],
    cuentas_transferencia: cuentas.data ?? [],
    mapeos,
    llaves,
    modulos: cfgMod?.modulos ?? null,
  })
}

export async function POST(request: Request) {
  const db = rlsClient(request)
  if (!db) return err('Sesión requerida', 401)
  const empresa_id = await empresaDelAdmin(db)
  if (!empresa_id) return err('Sesión inválida', 401)

  const body = await request.json().catch(() => null)
  if (!body?.accion) return err('Acción requerida')

  switch (body.accion) {
    // ── CUENTAS DE TRANSFERENCIA ──────────────────────────────
    case 'crear_cuenta': {
      const { sucursal_id, nombre, alias, cbu, titular } = body
      if (!sucursal_id || !nombre?.trim()) return err('Nombre y sucursal son obligatorios')
      if (!alias?.trim() && !cbu?.trim()) return err('Cargá al menos el alias o el CBU')
      if (cbu?.trim() && !/^\d{22}$/.test(cbu.trim())) return err('El CBU debe tener 22 dígitos (si es un alias, va en el campo Alias)')
      if (!(await sucursalValida(db, empresa_id, sucursal_id))) return err('Sucursal inválida', 403)
      const { data, error } = await db.from('cuentas_transferencia').insert({
        empresa_id, sucursal_id, nombre: nombre.trim(),
        alias: alias?.trim() || null, cbu: cbu?.trim() || null, titular: titular?.trim() || null,
      }).select('id').single()
      if (error) return err('No se pudo crear la cuenta')
      return NextResponse.json({ ok: true, id: data.id })
    }

    case 'editar_cuenta': {
      const { cuenta_id, nombre, alias, cbu, titular } = body
      if (!cuenta_id || !nombre?.trim()) return err('Datos incompletos')
      if (!alias?.trim() && !cbu?.trim()) return err('Cargá al menos el alias o el CBU')
      if (cbu?.trim() && !/^\d{22}$/.test(cbu.trim())) return err('El CBU debe tener 22 dígitos')
      const { error, count } = await db.from('cuentas_transferencia')
        .update({ nombre: nombre.trim(), alias: alias?.trim() || null, cbu: cbu?.trim() || null, titular: titular?.trim() || null, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', cuenta_id).eq('empresa_id', empresa_id)
      if (error || !count) return err('No se pudo editar la cuenta')
      return NextResponse.json({ ok: true })
    }

    case 'toggle_cuenta': {
      const { cuenta_id, activo } = body
      if (!cuenta_id || typeof activo !== 'boolean') return err('Datos incompletos')
      // Desactivar NO elimina mapeos (invariante CTO): el resolver decide en runtime.
      const { error, count } = await db.from('cuentas_transferencia')
        .update({ activo, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', cuenta_id).eq('empresa_id', empresa_id)
      if (error || !count) return err('No se pudo actualizar la cuenta')
      return NextResponse.json({ ok: true })
    }

    // ── CREDENCIALES MP (solo nombre/activo — tokens jamás) ───
    case 'renombrar_credencial': {
      const { credencial_id, nombre } = body
      if (!credencial_id || !nombre?.trim()) return err('Datos incompletos')
      const { error, count } = await db.from('mp_credenciales')
        .update({ nombre: nombre.trim(), updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', credencial_id).eq('empresa_id', empresa_id)
      if (error || !count) return err('No se pudo renombrar')
      return NextResponse.json({ ok: true })
    }

    case 'toggle_credencial': {
      const { credencial_id, activo } = body
      if (!credencial_id || typeof activo !== 'boolean') return err('Datos incompletos')
      const { error, count } = await db.from('mp_credenciales')
        .update({ activo, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', credencial_id).eq('empresa_id', empresa_id)
      if (error || !count) return err('No se pudo actualizar')
      return NextResponse.json({ ok: true })
    }

    // ── MATRIZ canal → medio → cuenta ─────────────────────────
    case 'asignar_mapeo': {
      const { sucursal_id, canal, medio, cuenta_id } = body
      if (!sucursal_id || !cuenta_id) return err('Datos incompletos')
      if (!CANALES.includes(canal)) return err('Canal inválido')
      if (!MEDIOS.includes(medio)) return err('Medio inválido')
      if (!(await sucursalValida(db, empresa_id, sucursal_id))) return err('Sucursal inválida', 403)

      let fila: { empresa_id: string; sucursal_id: string; canal: string; medio: string; mp_credencial_id?: string; transferencia_cuenta_id?: string }
      if (medio === 'TRANSFERENCIA') {
        const { data: cta } = await db.from('cuentas_transferencia')
          .select('id, sucursal_id, activo').eq('id', cuenta_id).eq('empresa_id', empresa_id).maybeSingle()
        if (!cta) return err('Esa cuenta no existe o no es de tu empresa', 403)
        if (cta.sucursal_id !== sucursal_id) return err('Esa cuenta pertenece a otra sucursal — cada sucursal asigna sus propias cuentas de transferencia', 403)
        if (!cta.activo) return err('La cuenta está inactiva: reactivala antes de asignarla')
        fila = { empresa_id, sucursal_id, canal, medio, transferencia_cuenta_id: cuenta_id }
      } else {
        const { data: cred } = await db.from('mp_credenciales')
          .select('id, sucursal_id, activo').eq('id', cuenta_id).eq('empresa_id', empresa_id).maybeSingle()
        if (!cred) return err('Esa cuenta de MP no existe o no es de tu empresa', 403)
        if (cred.sucursal_id !== null && cred.sucursal_id !== sucursal_id) return err('Esa cuenta de MP es exclusiva de otra sucursal', 403)
        if (!cred.activo) return err('La cuenta de MP requiere reconexión o está desactivada: resolvelo antes de asignarla')
        fila = { empresa_id, sucursal_id, canal, medio, mp_credencial_id: cuenta_id }
      }

      // Reemplazo atómico simple del mapeo del slot (V1: una cuenta por medio por canal)
      const del = await db.from('canales_medios_pago').delete()
        .eq('sucursal_id', sucursal_id).eq('canal', canal).eq('medio', medio)
      if (del.error) return err('No se pudo actualizar el mapeo')
      const ins = await db.from('canales_medios_pago').insert(fila)
      if (ins.error) return err('No se pudo guardar el mapeo (verificá la cuenta elegida)')
      return NextResponse.json({ ok: true })
    }

    case 'quitar_mapeo': {
      const { sucursal_id, canal, medio } = body
      if (!sucursal_id || !CANALES.includes(canal) || !MEDIOS.includes(medio)) return err('Datos incompletos')
      if (!(await sucursalValida(db, empresa_id, sucursal_id))) return err('Sucursal inválida', 403)
      const { error } = await db.from('canales_medios_pago').delete()
        .eq('sucursal_id', sucursal_id).eq('canal', canal).eq('medio', medio)
      if (error) return err('No se pudo quitar el mapeo')
      return NextResponse.json({ ok: true }) // el canal vuelve a Config. general (legacy)
    }

    // ── LLAVES ON/OFF POR CANAL (Ciclo 1 — único escritor de sucursal_pagos) ──
    case 'set_llave': {
      const { sucursal_id, canal, medio, valor } = body
      const CANALES_LLAVE = ['KIOSK', 'DELIVERY', 'MESA', 'TAKEAWAY'] as const
      const MEDIOS_LLAVE = ['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO'] as const
      if (!sucursal_id || typeof valor !== 'boolean') return err('Datos incompletos')
      if (!CANALES_LLAVE.includes(canal)) return err('Canal inválido')
      if (!MEDIOS_LLAVE.includes(medio)) return err('Medio inválido')
      if (!(await sucursalValida(db, empresa_id, sucursal_id))) return err('Sucursal inválida', 403)

      // VALIDACIÓN BLOQUEANTE server-side y atómica (decisión CTO): encender
      // TRANSFERENCIA para un canal exige una cuenta RESOLUBLE con datos para
      // ese canal — si no, 409 y sucursal_pagos NO se modifica. Persistir un
      // ON sin cuenta = experiencia rota al cliente (transferencia sin alias).
      // MP adrede NO se bloquea: el runtime ya se auto-protege — /api/kiosk/
      // pagos resuelve mpUsable con credencial real y sin ella el botón ni
      // aparece (regla detectada contra el resolver real, mandato CTO: no
      // inventar reglas que el sistema no tenga). Apagar nunca exige nada.
      if (valor === true && medio === 'TRANSFERENCIA') {
        const res = await resolverPago(empresa_id, sucursal_id, canal as CanalPago, 'TRANSFERENCIA')
        const cuentaOk = res.ok && res.medio === 'TRANSFERENCIA' && !!res.cuenta && !!(res.cuenta.alias || res.cuenta.cbu)
        if (!cuentaOk) {
          return err('No hay una cuenta de transferencia con datos para ese canal. Asignala en la pestaña Transferencias antes de habilitar el medio.', 409)
        }
      }

      const sufijo = canal.toLowerCase() as 'kiosk' | 'delivery' | 'mesa' | 'takeaway'
      const columna = medio === 'EFECTIVO' ? `acepta_efectivo_${sufijo}`
        : medio === 'TRANSFERENCIA' ? `acepta_transferencia_${sufijo}`
        : `acepta_mp_${sufijo}`

      const { error } = await db.from('sucursal_pagos')
        .upsert({ sucursal_id, empresa_id, [columna]: valor }, { onConflict: 'sucursal_id' })
      if (error) return err('No se pudo guardar la llave')
      return NextResponse.json({ ok: true, columna, valor })
    }

    default:
      return err('Acción desconocida')
  }
}
