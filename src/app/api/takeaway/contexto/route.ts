import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Contexto público del canal TAKE AWAY (el link/QR lo abre cualquier celular).
// GET ?empresa=<slug>&sucursal=<slug> → ids + branding + config del canal,
// gated por empresa_config.modulos.takeaway Y takeaway_config.activo.
// Calca el patrón de /api/mesa/contexto (server-side, admin client, sin RLS de cliente).

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

  const [{ data: ta }, { data: pagos }, { data: credSuc }, { data: credEmp }] = await Promise.all([
    supabase.from('takeaway_config').select('activo, horarios, mensaje_fuera_horario, tolerancia_cierre').eq('sucursal_id', sucursal.id).maybeSingle(),
    supabase.from('sucursal_pagos').select('acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_takeaway, cbu_transferencia, titular_transferencia').eq('sucursal_id', sucursal.id).maybeSingle(),
    // Conexión REAL de MP (mismo patrón que /api/mp/preferencia: sucursal → empresa)
    supabase.from('mp_credenciales').select('id').eq('empresa_id', empresa.id).eq('sucursal_id', sucursal.id).maybeSingle(),
    supabase.from('mp_credenciales').select('id').eq('empresa_id', empresa.id).is('sucursal_id', null).maybeSingle(),
  ])
  const mpConectado = Boolean(credSuc || credEmp)
  if (!ta?.activo) {
    return NextResponse.json({ error: 'El take away no está disponible en esta sucursal' }, { status: 403 })
  }

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
    },
    pagos: {
      acepta_efectivo: pagos?.acepta_efectivo ?? true,
      acepta_transferencia: pagos?.acepta_transferencia ?? true,
      // MP se ofrece SOLO si hay cuenta conectada Y checkbox global Y llave del canal
      acepta_mp: mpConectado && (pagos?.acepta_mp ?? false) && (pagos?.acepta_mp_takeaway ?? true),
      cbu_transferencia: pagos?.cbu_transferencia ?? null,
      titular_transferencia: pagos?.titular_transferencia ?? null,
    },
  })
}
