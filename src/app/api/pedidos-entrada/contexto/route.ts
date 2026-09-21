import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { estaAbierto, type Franja } from '@/lib/horarios'

// ============================================================
// CICLO 2 — /api/pedidos-entrada/contexto
// AGREGADOR de la APP PÚBLICA DE PEDIDOS (GO CTO 21/09, modelo
// "App Pública con alcance configurable"; alcance SUCURSAL implícito
// en los params — el alcance MARCA queda reservado, no construido).
// CONTRATO: esta capa es entrada/orquestación, NO otro sistema de
// pedidos. No interpreta tokens, no conoce checkout, no duplica
// reglas de canal.
// NO es una fuente de verdad nueva: COMPONE lo que ya existe —
//   · gate: empresa_config.entrada_unificada (default false)
//   · módulos: empresa_config.modulos (la misma llave que gatea
//     cada canal hoy)
//   · Delivery: dispositivos DELIVERY activo (la MISMA condición
//     que /api/device/verify modo slug) + delivery_config
//     (activo/pausado/horarios) — apertura evaluada con la
//     fuente única @/lib/horarios (Ciclo A)
//   · Take Away: takeaway_config (activo/horarios), misma fuente
// La page /pedidos/ decide el destino con estos estados; este
// endpoint no sabe vender nada y no duplica ningún resolver.
// GET ?empresa=<slug>&sucursal=<slug>
// Toggle OFF → 404 ANTES de revelar nada (ruta inalcanzable).
// ============================================================

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
    supabase.from('empresa_config')
      .select('primary_color, secondary_color, logo_url, modulos, entrada_unificada')
      .eq('empresa_id', empresa.id).maybeSingle(),
    supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', empresa.id).eq('slug', sucursalSlug).maybeSingle(),
  ])
  if (!sucursal) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 })

  // ══ GATE (contrato JC/CTO): toggle OFF → 404, antes de cualquier render ══
  if (cfg?.entrada_unificada !== true) {
    return NextResponse.json({ error: 'No disponible' }, { status: 404 })
  }

  const modulos = (cfg?.modulos ?? {}) as Record<string, boolean>

  // ── Estados de los dos canales, de sus fuentes existentes ──
  const [{ data: dispDelivery }, { data: dc }, { data: tc }] = await Promise.all([
    // La MISMA condición que /api/device/verify modo slug: existe dispositivo
    // DELIVERY activo (si no, aquel endpoint responde 404 y el canal no opera)
    supabase.from('dispositivos').select('id')
      .eq('sucursal_id', sucursal.id).eq('tipo', 'DELIVERY').eq('activo', true)
      .limit(1).maybeSingle(),
    supabase.from('delivery_config')
      .select('activo, pausado, horarios, tolerancia_cierre, mensaje_fuera_horario, mensaje_pausa')
      .eq('sucursal_id', sucursal.id).maybeSingle(),
    supabase.from('takeaway_config')
      .select('activo, horarios, tolerancia_cierre, mensaje_fuera_horario')
      .eq('sucursal_id', sucursal.id).maybeSingle(),
  ])

  // DELIVERY — configurado = módulo ON y dispositivo activo y config activa
  const deliveryConfigurado = modulos.delivery === true && !!dispDelivery && dc?.activo === true
  let deliveryDisponible = false
  let deliveryMotivo: string | null = null
  if (!deliveryConfigurado) {
    deliveryMotivo = null // no configurado: ni se muestra (decisión CTO)
  } else if (dc?.pausado) {
    deliveryDisponible = false
    deliveryMotivo = dc.mensaje_pausa ?? 'Pausado momentáneamente'
  } else {
    const horarios = (dc?.horarios as Franja[] | null) ?? []
    deliveryDisponible = horarios.length === 0 ? true : estaAbierto(horarios, Number(dc?.tolerancia_cierre ?? 5))
    if (!deliveryDisponible) deliveryMotivo = 'Cerrado por horario'
  }

  // TAKE AWAY — configurado = módulo ON y config activa
  const taConfigurado = modulos.takeaway === true && tc?.activo === true
  let taDisponible = false
  let taMotivo: string | null = null
  if (taConfigurado) {
    const horariosTa = (tc?.horarios as Franja[] | null) ?? []
    taDisponible = horariosTa.length === 0 ? true : estaAbierto(horariosTa, Number(tc?.tolerancia_cierre ?? 5))
    if (!taDisponible) taMotivo = 'Cerrado por horario'
  }

  return NextResponse.json({
    nombre: empresa.nombre,
    sucursal_nombre: sucursal.nombre,
    config: {
      primary_color: cfg?.primary_color ?? '#1E3A5F',
      secondary_color: cfg?.secondary_color ?? '#F5C842',
      logo_url: cfg?.logo_url ?? null,
    },
    // URLs de destino = las rutas EXISTENTES (el fallback slug de delivery
    // ya opera en producción vía /api/device/verify). El token, si vino, lo
    // transporta la PAGE como passthrough — este endpoint no lo conoce.
    servicios: {
      delivery: { configurado: deliveryConfigurado, disponible: deliveryDisponible, motivo: deliveryMotivo, url: `/${empresa.slug}/delivery/${sucursal.slug}` },
      takeaway: { configurado: taConfigurado, disponible: taDisponible, motivo: taMotivo, url: `/${empresa.slug}/takeaway/${sucursal.slug}` },
    },
  })
}
