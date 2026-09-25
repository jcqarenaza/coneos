import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ══ RETORNO MP SERVER-AUTHORITATIVE (JC 24/09) ══
// El celular pierde TODO al pagar dentro de la app de MP (otra pestaña, otro
// navegador interno, bfcache) — pero la BASE nunca olvida: gracias a
// pedidos.visitante_id (Tráfico B, hoy mismo), la vidriera pregunta
// "¿este visitante tiene un pedido MP reciente acá?" y el server responde
// la verdad. GET ?empresa=slug&sucursal=slug&visitante=vid&tipo=takeaway
// Público y anónimo: devuelve solo número/código/estado del propio pedido
// del visitante — jamás datos de otros ni credenciales.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresaSlug = searchParams.get('empresa')
  const sucursalSlug = searchParams.get('sucursal')
  const visitante = searchParams.get('visitante')
  const tipo = searchParams.get('tipo')
  if (!empresaSlug || !sucursalSlug || !visitante || !tipo) return NextResponse.json({ pedido: null })

  const supabase = createAdminClient()
  const { data: empresa } = await supabase.from('empresas').select('id').eq('slug', empresaSlug).maybeSingle()
  if (!empresa) return NextResponse.json({ pedido: null })
  const { data: sucursal } = await supabase.from('sucursales').select('id').eq('empresa_id', empresa.id).eq('slug', sucursalSlug).maybeSingle()
  if (!sucursal) return NextResponse.json({ pedido: null })

  const desde = new Date(Date.now() - 3600000).toISOString() // última hora
  const { data: pedido } = await supabase.from('pedidos')
    .select('id, numero_pedido, codigo_retiro, estado, metodo_pago, created_at')
    .eq('empresa_id', empresa.id).eq('sucursal_id', sucursal.id)
    .eq('visitante_id', String(visitante).slice(0, 80))
    .eq('tipo_pedido', tipo).eq('metodo_pago', 'mp')
    .gte('created_at', desde)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!pedido) return NextResponse.json({ pedido: null })
  return NextResponse.json({ pedido: { id: pedido.id, numero_pedido: pedido.numero_pedido, codigo_retiro: pedido.codigo_retiro, estado: pedido.estado } })
}
