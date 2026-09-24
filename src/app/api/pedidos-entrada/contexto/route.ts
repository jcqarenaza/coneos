import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { estaAbierto, diaOperativo, proximoDiaHabil, franjasDeDia, horaMinutosAR, diaSemanaAR, DIAS_NOMBRE, type Franja, type HorarioPorDia } from '@/lib/horarios'

// 2.1a: el cerrado dice CUÁNDO abre — dato COMPUESTO de las mismas franjas
// de config que ya gobiernan la apertura (cero regla nueva, cero duplicación:
// la casa de horarios sigue siendo el backend de cada servicio; acá solo se
// expone). Próxima 'desde' de hoy, o la primera del día siguiente.
function proximaApertura(horarios: Franja[]): string | null {
  if (!horarios || horarios.length === 0) return null
  const hora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  const ordenadas = [...horarios].sort((a, b) => a.desde.localeCompare(b.desde))
  return (ordenadas.find(h => h.desde > hora) ?? ordenadas[0]).desde
}

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
    supabase.from('sucursales').select('id, nombre, slug, direccion, activo, horario_general, mensaje_cerrado, tolerancia_cierre, dias_apertura, horario_por_dia').eq('empresa_id', empresa.id).eq('slug', sucursalSlug).maybeSingle(),
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
      .select('activo, pausado, horarios, tolerancia_cierre, mensaje_fuera_horario, mensaje_pausa, mostrar_en_app')
      .eq('sucursal_id', sucursal.id).maybeSingle(),
    supabase.from('takeaway_config')
      .select('activo, horarios, tolerancia_cierre, mensaje_fuera_horario, acepta_anticipado, mostrar_en_app')
      .eq('sucursal_id', sucursal.id).maybeSingle(),
  ])

  // DELIVERY — configurado = módulo ON y dispositivo activo y config activa
  const deliveryConfigurado = modulos.delivery === true && !!dispDelivery && dc?.activo === true
  let deliveryDisponible = false
  let deliveryMotivo: string | null = null
  let deliveryProximo: string | null = null
  if (!deliveryConfigurado) {
    deliveryMotivo = null // no configurado: ni se muestra (decisión CTO)
  } else if (dc?.pausado) {
    deliveryDisponible = false
    deliveryMotivo = dc.mensaje_pausa ?? 'Pausado momentáneamente'
  } else {
    const horarios = (dc?.horarios as Franja[] | null) ?? []
    deliveryDisponible = horarios.length === 0 ? true : estaAbierto(horarios, Number(dc?.tolerancia_cierre ?? 5))
    if (!deliveryDisponible) { deliveryMotivo = 'Cerrado por horario'; deliveryProximo = proximaApertura(horarios) }
  }

  // TAKE AWAY — configurado = módulo ON y config activa
  const taConfigurado = modulos.takeaway === true && tc?.activo === true
  let taDisponible = false
  let taMotivo: string | null = null
  let taProximo: string | null = null
  if (taConfigurado) {
    const horariosTa = (tc?.horarios as Franja[] | null) ?? []
    taDisponible = horariosTa.length === 0 ? true : estaAbierto(horariosTa, Number(tc?.tolerancia_cierre ?? 5))
    if (!taDisponible) { taMotivo = 'Cerrado por horario'; taProximo = proximaApertura(horariosTa) }
  }

  // CICLO A en la VIDRIERA: el horario del negocio es el TECHO de todos los
  // canales — la App no ofrece lo que el server va a rechazar. Con techo
  // cerrado, ambos servicios quedan no-disponibles y el próximo mostrado es
  // la reapertura del NEGOCIO (la más temprana real).
  const techoFranjas = (sucursal.horario_general as Franja[] | null) ?? []
  const diasApertura = (sucursal.dias_apertura as number[] | null) ?? null
  const porDiaTecho = (sucursal.horario_por_dia as HorarioPorDia | null) ?? null
  const tolNegocio = Number(sucursal.tolerancia_cierre ?? 0)
  // 📅 DÍAS (contrato CTO 23/09): el día vive en Negocio y manda sobre TODO.
  // Día no operativo (ni habilita jornada ni hay resaca vigente) = cierre
  // TOTAL, TA incluido — y el cartel dice QUÉ día reabre.
  const sucursalInactiva = (sucursal as { activo?: boolean }).activo === false
  const diaOk = diaOperativo(techoFranjas, diasApertura, tolNegocio, horaMinutosAR(), diaSemanaAR(), porDiaTecho)
  if (sucursalInactiva) {
    // activo con dientes: la puerta entera muda, con mensaje digno (QRs impresos)
    if (deliveryConfigurado) { deliveryDisponible = false; deliveryMotivo = 'No disponible'; deliveryProximo = null }
    if (taConfigurado) { taDisponible = false; taMotivo = 'No disponible'; taProximo = null }
  }
  if (!diaOk) {
    const diaVuelta = proximoDiaHabil(diasApertura)
    const franjasVuelta = franjasDeDia(techoFranjas, porDiaTecho, diaVuelta)
    const horaVuelta = franjasVuelta.length > 0 ? franjasVuelta[0].desde : null
    // El front antepone "a las" — el formato queda "a las 12:00 del jueves"
    const proximoDia = horaVuelta ? `${horaVuelta} del ${DIAS_NOMBRE[diaVuelta]}` : null
    if (deliveryConfigurado) { deliveryDisponible = false; deliveryMotivo = 'Hoy cerrado'; deliveryProximo = proximoDia }
    if (taConfigurado) { taDisponible = false; taMotivo = 'Hoy cerrado'; taProximo = proximoDia }
  }
  const techoAbierto = porDiaTecho
    ? estaAbierto(techoFranjas, 0, horaMinutosAR(), diasApertura, diaSemanaAR(), porDiaTecho)
    : (techoFranjas.length === 0 ? true : estaAbierto(techoFranjas, 0, horaMinutosAR(), diasApertura))
  if (!techoAbierto && diaOk) { // día no operativo: el bloque del DÍA ya habló — no pisar
    // El techo aplica a DELIVERY (se cocina y sale con el local abierto).
    // TA queda EXENTO: se rige por sus franjas/slots (anticipado — abajo).
    const proximoTecho = proximaApertura(techoFranjas)
    if (deliveryConfigurado && deliveryDisponible) { deliveryDisponible = false; deliveryMotivo = 'Cerrado por horario'; deliveryProximo = proximoTecho }
    else if (deliveryConfigurado && deliveryProximo) { deliveryProximo = proximoTecho }
  }
  // ANTICIPADO (decisión JC): TA cerrado pero con franja de HOY por delante →
  // la tarjeta queda ELEGIBLE con "🟠 Abre a las HH — pedí ahora" (la page de
  // TA recibe al cliente en modo anticipado). Sin franja restante = cerrado.
  const taAnticipado = !sucursalInactiva && diaOk && taConfigurado && !taDisponible && !!taProximo && (tc?.acepta_anticipado === true)

  return NextResponse.json({
    nombre: empresa.nombre,
    sucursal_nombre: sucursal.nombre,
    // 2.1a: la página del negocio como fallback — datos que YA viven en sucursales
    negocio: {
      direccion: sucursal.direccion ?? null,
      horarios: (sucursal.horario_general as Franja[] | null) ?? [],
      mensaje: sucursalInactiva ? '🟠 Esta sucursal no se encuentra disponible.' : sucursal.mensaje_cerrado ?? null,
    },
    config: {
      primary_color: cfg?.primary_color ?? '#1E3A5F',
      secondary_color: cfg?.secondary_color ?? '#F5C842',
      logo_url: cfg?.logo_url ?? null,
    },
    // URLs de destino = las rutas EXISTENTES (el fallback slug de delivery
    // ya opera en producción vía /api/device/verify). El token, si vino, lo
    // transporta la PAGE como passthrough — este endpoint no lo conoce.
    servicios: {
      delivery: { configurado: deliveryConfigurado, visible: dc?.mostrar_en_app !== false, disponible: deliveryDisponible, motivo: deliveryMotivo, proximo: deliveryProximo, url: `/${empresa.slug}/delivery/${sucursal.slug}` },
      takeaway: { configurado: taConfigurado, visible: tc?.mostrar_en_app !== false, disponible: taDisponible || taAnticipado, anticipado: taAnticipado, motivo: taMotivo, proximo: taProximo, url: `/${empresa.slug}/takeaway/${sucursal.slug}` },
    },
  })
}
