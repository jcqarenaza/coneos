import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const METODOS_VALIDOS = ['transferencia', 'efectivo', 'mp']


// Resuelve la config de facturación: fila de la sucursal si existe, si no la de la
// empresa (sucursal_id NULL). Devuelve null si no hay ninguna.
async function resolverFactConfig(supabase: ReturnType<typeof createAdminClient>, empresaId: string, sucursalId: string | null, columnas: string) {
  if (sucursalId) {
    const { data } = await supabase.from('facturacion_config')
      .select(columnas).eq('empresa_id', empresaId).eq('sucursal_id', sucursalId).maybeSingle()
    if (data) return data
  }
  const { data } = await supabase.from('facturacion_config')
    .select(columnas).eq('empresa_id', empresaId).is('sucursal_id', null).maybeSingle()
  return data
}

// GET ?empresa_id= → { configurada, auto, metodos, disponibles }
// configurada: módulo listo (activo del panel + certificados)
// auto: interruptor maestro del cliente; metodos: cuáles se facturan solos
// disponibles: qué métodos ofrecerle al cliente (mp solo si alguna sucursal lo acepta)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })
  const supabase = createAdminClient()
  const [{ data }, { data: pagos }] = await Promise.all([
    supabase.from('facturacion_config')
      .select('activo, cert_pem, key_pem, auto_facturar, metodos_auto').eq('empresa_id', empresa_id).is('sucursal_id', null).maybeSingle(),
    supabase.from('sucursal_pagos').select('acepta_mp_kiosk, acepta_mp_delivery').eq('empresa_id', empresa_id),
  ])
  const configurada = !!(data?.activo && data?.cert_pem && data?.key_pem)
  const auto = data?.auto_facturar !== false
  const metodos = Array.isArray(data?.metodos_auto) ? (data!.metodos_auto as string[]).filter(m => METODOS_VALIDOS.includes(m)) : ['transferencia']
  const hayMP = (pagos ?? []).some(p => p.acepta_mp_kiosk || p.acepta_mp_delivery)
  const disponibles = hayMP ? METODOS_VALIDOS : METODOS_VALIDOS.filter(m => m !== 'mp')
  return NextResponse.json({ configurada, auto, metodos, disponibles, activa: configurada && auto && metodos.length > 0 })
}

// PUT { empresa_id, auto_facturar?, metodos_auto? } → toggles del cliente
export async function PUT(request: Request) {
  const { empresa_id, auto_facturar, metodos_auto } = await request.json()
  if (!empresa_id) return NextResponse.json({ error: 'empresa_id requerido' }, { status: 400 })
  const update: Record<string, unknown> = {}
  if (typeof auto_facturar === 'boolean') update.auto_facturar = auto_facturar
  if (Array.isArray(metodos_auto)) update.metodos_auto = metodos_auto.filter((m: string) => METODOS_VALIDOS.includes(m))
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nada para actualizar' }, { status: 400 })
  const supabase = createAdminClient()
  const { error } = await supabase.from('facturacion_config').update(update).eq('empresa_id', empresa_id).is('sucursal_id', null)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, ...update })
}

// POST { empresa_id, pedido_id } → emite si el método del pedido está habilitado.
// Lo llama el hook de /api/pedidos/estado al cobrar (único punto de disparo).
export async function POST(request: Request) {
  const { empresa_id, pedido_id } = await request.json()
  if (!empresa_id || !pedido_id) return NextResponse.json({ error: 'empresa_id y pedido_id requeridos' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: pedido } = await supabase.from('pedidos')
    .select('metodo_pago, sucursal_id').eq('id', pedido_id).eq('empresa_id', empresa_id).maybeSingle()
  const cfg = await resolverFactConfig(supabase, empresa_id, pedido?.sucursal_id ?? null,
    'activo, auto_facturar, metodos_auto') as
    { activo: boolean; auto_facturar: boolean | null; metodos_auto: unknown } | null
  if (!cfg?.activo) return NextResponse.json({ ok: false, error: 'Facturación desactivada' }, { status: 409 })
  if (cfg.auto_facturar === false) return NextResponse.json({ ok: false, error: 'Facturación automática pausada por el cliente' }, { status: 409 })
  const metodos = Array.isArray(cfg.metodos_auto) ? cfg.metodos_auto as string[] : ['transferencia']
  if (!pedido?.metodo_pago || !metodos.includes(pedido.metodo_pago)) {
    return NextResponse.json({ ok: false, error: `Método ${pedido?.metodo_pago ?? '—'} no configurado para facturar` }, { status: 409 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'Faltan variables de entorno' }, { status: 500 })

  const res = await fetch(`${url}/functions/v1/arca-facturar`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresa_id, pedido_id, accion: 'facturar' }),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
