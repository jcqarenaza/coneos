import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { pedido_id, nombre_cliente } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase
    .from('pedidos')
    .select(`id, numero_pedido, codigo_retiro, total, metodo_pago, created_at,
      empresa_id, sucursales(nombre),
      pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
        pedido_item_opciones(nombre_snap, emoji_snap))`)
    .eq('id', pedido_id)
    .single()

  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  const [{ data: cfg }, { data: empresa }] = await Promise.all([
    supabase.from('empresa_config').select('primary_color, cuit, razon_social, logo_url').eq('empresa_id', pedido.empresa_id).single(),
    supabase.from('empresas').select('nombre').eq('id', pedido.empresa_id).single(),
  ])

  await supabase.from('comprobantes').insert({ empresa_id: pedido.empresa_id, pedido_id, tipo: 'ticket', total: pedido.total })

  const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`
  const fecha = new Date(pedido.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const metodoLabel: Record<string, string> = { efectivo: 'EFECTIVO', transferencia: 'TRANSFERENCIA', mp: 'MERCADO PAGO' }
  const items = (pedido.pedido_items ?? []) as { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones: { nombre_snap: string; emoji_snap: string | null }[] }[]

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket #${pedido.numero_pedido}</title>
<style>
@media print {
  @page { margin: 2mm; }
  .btns { display: none !important; }
}
* { margin:0; padding:0; box-sizing:border-box; font-weight: bold; }
body { font-family: 'Calibri', Arial, sans-serif; font-size: 13px; background: white; padding: 0; margin: 0; word-wrap: break-word; overflow-wrap: break-word; }
.linea { border-top: 1px dashed #000; margin: 4px 0; }
.centro { text-align: center; }
.empresa { font-size: 16px; font-weight: bold; text-align: center; }
.sub { font-size: 12px; font-weight: normal; text-align: center; }
.no-fiscal { font-size: 11px; text-align: center; border: 1px solid #000; padding: 2px; margin: 4px 0; }
.pedido-num { font-size: 26px; font-weight: bold; text-align: center; margin: 4px 0; }
.info { display: flex; justify-content: space-between; font-size: 12px; font-weight: normal; }
.item-prod { font-size: 12px; font-weight: normal; }
.item-pres { font-size: 14px; font-weight: bold; }
.item-ops { font-size: 13px; font-weight: bold; }
.item-precio { display: table; width: 100%; font-size: 13px; }
.item-precio-cant { display: table-cell; }
.item-precio-val { display: table-cell; text-align: right; }
.fila { display: table; width: 100%; }
.total-label { display: table-cell; font-size: 16px; font-weight: bold; }
.total-valor { display: table-cell; font-size: 16px; font-weight: bold; text-align: right; }
.metodo { font-size: 14px; font-weight: bold; text-align: center; margin-top: 4px; }
.footer { font-size: 11px; font-weight: normal; text-align: center; margin-top: 6px; }
.btns { display: flex; gap: 8px; margin-top: 12px; justify-content: center; }
.btn { padding: 10px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; }
</style>
</head>
<body>

<div class="empresa">${empresa?.nombre ?? 'Heladeria'}</div>
${cfg?.razon_social ? `<div class="sub">${cfg.razon_social}</div>` : ''}
${cfg?.cuit ? `<div class="sub">CUIT: ${cfg.cuit}</div>` : ''}
<div class="sub">${(pedido.sucursales as { nombre: string } | null)?.nombre ?? ''}</div>

<div class="linea"></div>
<div class="no-fiscal">TICKET SIN VALIDEZ FISCAL</div>
<div class="linea"></div>

<div class="pedido-num">#${pedido.numero_pedido}</div>
<div class="info"><span>${fecha}</span><span>Retiro: ${pedido.codigo_retiro}</span></div>

<div class="linea"></div>

${items.map(item => {
  const prod = (item.nombre_producto_snap ?? '').toLowerCase()
  const pres = (item.nombre_presentacion_snap ?? '').toLowerCase()
  const mostrarProd = prod && !pres.includes(prod) && !prod.includes(pres)
  return `<div>
  ${mostrarProd ? `<div class="item-prod">${item.nombre_producto_snap}</div>` : ''}
  <div class="item-pres">${item.cantidad > 1 ? `${item.cantidad}x ` : ''}${item.nombre_presentacion_snap}</div>
  ${item.pedido_item_opciones?.length > 0 ? `<div class="item-ops">${item.pedido_item_opciones.map(op => op.nombre_snap).join(' - ')}</div>` : ''}
  <div class="item-precio"><span class="item-precio-cant">x${item.cantidad}</span><span class="item-precio-val">${fmt(item.precio_snap)}</span></div>
</div>`}).join('<div class="linea"></div>')}

<div class="linea"></div>

<div class="fila">
  <span class="total-label">TOTAL</span>
  <span class="total-valor">${fmt(pedido.total)}</span>
</div>
<div class="metodo">${metodoLabel[pedido.metodo_pago ?? ''] ?? pedido.metodo_pago ?? '—'}</div>

${nombre_cliente ? `<div class="linea"></div><div class="sub">Cliente: ${nombre_cliente}</div>` : ''}

<div class="linea"></div>
<div class="footer">Gracias por tu compra!</div>

<div class="btns">
  <button class="btn" style="background:#000;color:white" onclick="window.print()">Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>
</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
