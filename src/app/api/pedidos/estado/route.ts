import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { acreditarPuntosPedido } from '@/lib/beneficios'
import { buscarPaymentPorPedido } from '@/lib/pagos/mp'
import { facturarSiCorresponde } from '@/lib/facturacion/facturar'

// GET ?pedido_id= → estado mínimo del pedido, para que kiosk/delivery (anónimos)
// detecten el pago MP y muestren número y código de retiro.
// Retorno MP (JC 25/09): suma nombre/total/método/hora/datos de entrega del
// PROPIO pedido — el comprobante del retorno se arma con la base, no con la
// memoria del navegador (que el celu pierde al pagar en la app de MP).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pedido_id = searchParams.get('pedido_id')
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('pedidos')
    .select('estado, numero_pedido, codigo_retiro, total, metodo_pago, costo_envio, hora_retiro, nombre_cliente, datos_delivery')
    .eq('id', pedido_id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  return NextResponse.json(data)
}

// FA-1: validación de CUIT (estructural + dígito verificador). Server-side
// también: la route rechaza receptor con CUIT inválido, no solo la UI.
function cuitValido(cuit: string): boolean {
  const d = (cuit ?? '').replace(/\D/g, '')
  if (d.length !== 11) return false
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = mult.reduce((a, m, i) => a + m * Number(d[i]), 0)
  const resto = 11 - (suma % 11)
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto
  return dv === Number(d[10])
}
const CONDS_VALIDAS = [1, 4, 5, 6] // RI, Exento, Cons. Final, Monotributo (códigos ARCA)

// Facturación automática: al cobrar, emitir si el método del pedido está habilitado
// por el cliente (auto_facturar + metodos_auto). Único punto de disparo — la caja ya
// no dispara por su cuenta, así no hay carrera de doble emisión. Silencioso: nunca
// bloquea el cambio de estado; la Edge es idempotente (rechaza pedido ya facturado).

// Resuelve la config de facturación: fila de la sucursal si existe, si no la de la
// empresa (sucursal_id NULL). Devuelve null si no hay ninguna.

// POST — cambio de estado desde caja (original Sprint 3B, restaurado)
// FA-1: acepta `receptor` opcional { doc_nro, cond_iva, razon_social,
// detalle_facturable } — se persiste en el pedido ANTES del cambio de estado
// (facturarSiCorresponde lo lee después). Sin receptor: flujo byte a byte igual.
export async function POST(request: Request) {
  const { pedido_id, estado_nuevo, operador_id, receptor } = await request.json()
  const supabase = createAdminClient()
  const { data: pedido } = await supabase
    .from('pedidos')
    .select('estado, metodo_pago, pagado, total, notas, empresa_id, sucursal_id, mp_credencial_id')
    .eq('id', pedido_id)
    .single()
  if (!pedido) {
    return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
  }

  // ══ AUDITORÍA B — VALIDACIÓN MANUAL DE MP (decisiones CTO a-d) ══
  // Transición manual a cobrado de un pedido MP que el webhook NO confirmó:
  // consultar a Mercado Pago antes de aceptar. Efectivo/transferencia y pedidos
  // ya pagados (webhook) ni pasan por acá. Sin override (b), monto exacto (c),
  // múltiples approved = ambiguo = rechazo (regla adicional), MP caído =
  // fail-open CON marca inequívoca (a). Histórico intocable (d).
  let mpExtras: { pagado: boolean; notas: string } | null = null
  // 9c/fix-B: pagado nace TRUE en no-mesa — la condición real de 'MP sin
  // confirmar' es el ESTADO (transición manual desde no-cobrado).
  if ((estado_nuevo === 'PAID' || estado_nuevo === 'DELIVERED') && pedido.metodo_pago === 'mp' && pedido.estado === 'PENDING_PAYMENT') {
    const busq = await buscarPaymentPorPedido(supabase, {
      id: pedido_id, empresa_id: pedido.empresa_id, sucursal_id: pedido.sucursal_id,
      mp_credencial_id: pedido.mp_credencial_id, total: Number(pedido.total),
    })
    const conNota = (nota: string) => pedido.notas ? `${pedido.notas} · ${nota}` : nota
    if (busq.resultado === 'aprobado') {
      // El pago existe: dejar pasar y completar lo que el webhook habría hecho
      mpExtras = { pagado: true, notas: conNota(`MP payment ${busq.payment_id}`) }
    } else if (busq.resultado === 'sin_pago') {
      return NextResponse.json({ error: 'Mercado Pago no registra este pago. Si el cliente te muestra el comprobante, verificá el importe — o cobralo por otro medio.' }, { status: 409 })
    } else if (busq.resultado === 'monto_distinto') {
      return NextResponse.json({ error: `El pago en Mercado Pago es de $${busq.monto_mp.toLocaleString('es-AR')} y el pedido vale $${Number(pedido.total).toLocaleString('es-AR')}. No coinciden — verificá antes de confirmar.` }, { status: 409 })
    } else if (busq.resultado === 'ambiguo') {
      return NextResponse.json({ error: `Hay ${busq.candidatos} pagos aprobados para este pedido en Mercado Pago. Verificá en tu panel de MP antes de confirmar.` }, { status: 409 })
    } else {
      // inaccesible → fail-open controlado (a): MP caído no frena la caja,
      // pero la marca queda para siempre (operador ya queda en el log)
      mpExtras = { pagado: true, notas: conNota('MP payment manual — no verificado por Mercado Pago') }
    }
  }

  // FA-1: persistir receptor fiscal (completo o nada)
  if (receptor) {
    const docNro = String(receptor.doc_nro ?? '').replace(/\D/g, '')
    const condIva = Number(receptor.cond_iva)
    const razon = String(receptor.razon_social ?? '').trim()
    if (!cuitValido(docNro)) return NextResponse.json({ error: 'CUIT inválido' }, { status: 400 })
    if (!CONDS_VALIDAS.includes(condIva)) return NextResponse.json({ error: 'Condición IVA inválida' }, { status: 400 })
    if (!razon) return NextResponse.json({ error: 'Falta la razón social del receptor' }, { status: 400 })
    await supabase.from('pedidos').update({
      receptor_doc_tipo: 80,
      receptor_doc_nro: docNro,
      receptor_cond_iva: condIva,
      receptor_razon_social: razon,
      detalle_facturable: String(receptor.detalle_facturable ?? '').trim() || null,
    }).eq('id', pedido_id)
  }

  // ══ 9c — TRANSICIÓN OPERATIVA CENTRAL ══
  // "Pago confirmado = habilitado para preparación. PREPARING es el único
  // estado operativo posterior al cobro." PAID es transitorio; DELIVERED
  // (entrega) no se toca.
  const estadoFinal = estado_nuevo === 'PAID' ? 'PREPARING' : estado_nuevo
  await supabase.from('pedidos').update({
    estado: estadoFinal,
    updated_at: new Date().toISOString(),
    ...(mpExtras ?? {}),
  }).eq('id', pedido_id)
  await supabase.from('pedido_estados_log').insert({
    pedido_id,
    operador_id: operador_id || null,
    estado_anterior: pedido.estado,
    estado_nuevo,
  })

  // Beneficios: al cobrar/entregar, acreditar puntos si hay teléfono vinculado.
  // Idempotente y silencioso — nunca bloquea el cambio de estado.
  if (estado_nuevo === 'PAID' || estado_nuevo === 'DELIVERED') {
    await acreditarPuntosPedido(pedido_id).catch(() => {})
    // Facturación: solo la primera vez que pasa a cobrado (si venía de un estado
    // cobrado, ya se intentó antes; la Edge rechaza duplicados igual)
    if (!['PAID', 'PREPARING', 'READY', 'DELIVERED'].includes(pedido.estado)) {
      await facturarSiCorresponde(pedido_id)
    }
  }

  return NextResponse.json({ ok: true })
}
