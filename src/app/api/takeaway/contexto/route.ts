import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolverPago } from '@/lib/pagos/resolver'
import { generarSlots } from '@/lib/takeaway/slots'

// Contexto público del canal TAKE AWAY (el link/QR lo abre cualquier celular).
// GET ?empresa=<slug>&sucursal=<slug> → ids + branding + config del canal,
// gated por empresa_config.modulos.takeaway Y takeaway_config.activo.
// FASE 4: MP y TRANSFERENCIA se resuelven por resolverPago() — mapeo explícito
// del canal TAKEAWAY o legacy exacto. Flags del comercio respetados; la
// credencial además debe ser utilizable. Server-side siempre.
// CICLO COSTO TA: expone costo_servicio (espejo del costo de envío de
// delivery) — 0 = el canal se comporta idéntico a siempre.

function estaEnHorario(horarios: { desde: string; hasta: string }[], horaArg: string, toleranciaMin = 0): boolean {
  if (!horarios || horarios.length === 0) return true
  const [hh, mm] = horaArg.split(':').map(Number)
  const minActual = hh * 60 + mm
  return horarios.some(({ desde, hasta }) => {
    const [dh, dm] = desde.split(':').map(Number)
    const [hah, ham] = hasta.split(':').map(Number)
    const minDesde = dh * 60 + dm
    const finCrudo = hah * 60 + ham
    const cruzaMedianoche = finCrudo < minDesde
    const minHasta = cruzaMedianoche ? (finCrudo + toleranciaMin) % 1440 : Math.min(finCrudo + toleranciaMin, 1439)
    if (cruzaMedianoche) return minActual >= minDesde || minActual <= minHasta
    return minActual >= minDesde && minActual <= minHasta
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresaSlug = searchParams.get('empresa')
  const sucursalSlug = searchParams.get('sucursal')
  if (!empresaSlug || !sucursalSlug) return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: empresa } = await supabase.from('empresas')
    .select('id, nombre, slug').eq('slug', empresaSlug).maybeSingle()
  if (!empresa) return NextResponse.json({ error: 'Local no encontrado' }, { status: 404 })

  const [{ data: cfg }, { data: sucursal }] = await Promise.all([
    supabase.from('empresa_config').select('primary_color, secondary_color, logo_url, modulos').eq('empresa_id', empresa.id).maybeSingle(),
    supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', empresa.id).eq('slug', sucursalSlug).maybeSingle(),
  ])
  if (!sucursal) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 })

  const modulos = (cfg?.modulos ?? {}) as Record<string, boolean>
  if (modulos.takeaway !== true) {
    return NextResponse.json({ error: 'El take away no está disponible en este local' }, { status: 403 })
  }

  const [{ data: ta }, { data: pagos }, resMp, resTransfer] = await Promise.all([
    supabase.from('takeaway_config').select('activo, horarios, mensaje_fuera_horario, tolerancia_cierre, costo_servicio').eq('sucursal_id', sucursal.id).maybeSingle(),
    supabase.from('sucursal_pagos').select('acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_takeaway').eq('sucursal_id', sucursal.id).maybeSingle(),
    resolverPago(empresa.id, sucursal.id, 'TAKEAWAY', 'MERCADO_PAGO'),
    resolverPago(empresa.id, sucursal.id, 'TAKEAWAY', 'TRANSFERENCIA'),
  ])
  if (!ta?.activo) {
    return NextResponse.json({ error: 'El take away no está disponible en esta sucursal' }, { status: 403 })
  }

  const mpUsable = resMp.ok && resMp.medio === 'MERCADO_PAGO' && !!resMp.credencial && resMp.credencial.activo !== false
  // Datos de transferencia de la cuenta resuelta (explícita) o legacy crudo.
  // Compatibilidad de respuesta: mismos campos que consumen las Confirmaciones
  // hoy (cbu_transferencia se exhibe como "Alias"); con cuenta explícita se
  // sirve alias (o CBU si la cuenta solo tiene CBU). UI diferenciada: Fase 6.
  const cuenta = resTransfer.ok && resTransfer.medio === 'TRANSFERENCIA' ? resTransfer.cuenta : null
  const transferMostrar = cuenta
    ? (resTransfer.ok && resTransfer.origen === 'explicito' ? (cuenta.alias ?? cuenta.cbu) : cuenta.cbu)
    : null

  // Hora argentina server-side (misma zona que usa la validación de /api/pedidos)
  const hora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  const horarios = (ta.horarios as { desde: string; hasta: string }[] | null) ?? []
  const abierto = horarios.length === 0 ? true : estaEnHorario(horarios, hora)

  return NextResponse.json({
    empresa_id: empresa.id,
    sucursal_id: sucursal.id,
    nombre: empresa.nombre,
    sucursal_nombre: sucursal.nombre,
    config: {
      primary_color: cfg?.primary_color ?? '#1E3A5F',
      secondary_color: cfg?.secondary_color ?? '#F5C842',
      logo_url: cfg?.logo_url ?? null,
    },
    takeaway: {
      abierto,
      horarios,
      mensaje_fuera_horario: ta.mensaje_fuera_horario ?? 'El take away no está disponible en este momento. ¡Volvemos pronto!',
      tolerancia_cierre: Number(ta.tolerancia_cierre ?? 5),
      // Espejo del costo de envío: 0 si no está configurado (inercia total)
      costo_servicio: Number(ta.costo_servicio ?? 0),
      // V1.5: slots de retiro del día (15' fijos, margen 15'), server-side de
      // la MISMA fuente que valida /api/pedidos. Vacío si sin franjas o cerrado.
      slots_retiro: abierto ? generarSlots(horarios) : [],
    },
    pagos: {
      acepta_efectivo: pagos?.acepta_efectivo ?? true,
      acepta_transferencia: pagos?.acepta_transferencia ?? true,
      // MP solo si: credencial resuelta y utilizable Y checkbox global Y llave del canal
      acepta_mp: mpUsable && (pagos?.acepta_mp ?? false) && (pagos?.acepta_mp_takeaway ?? true),
      cbu_transferencia: transferMostrar,
      titular_transferencia: cuenta?.titular ?? null,
    },
  })
}
