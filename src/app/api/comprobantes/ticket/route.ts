import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { pedido_id } = await request.json()
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
    supabase.from('empresa_config').select('primary_color, moneda, cuit, razon_social, logo_url').eq('empresa_id', pedido.empresa_id).single(),
    supabase.from('empresas').select('nombre').eq('id', pedido.empresa_id).single(),
  ])

  await supabase.from('comprobantes').insert({ empresa_id: pedido.empresa_id, pedido_id, tipo: 'ticket', total: pedido.total })

  const primaryColor = cfg?.primary_color ?? '#1a2744'
  const moneda = cfg?.moneda ?? 'ARS'
  const fmt = (n: number) => `${moneda} ${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
  const fecha = new Date(pedido.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const metodoLabel: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', mp: 'Mercado Pago' }
  const items = (pedido.pedido_items ?? []) as { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones: { nombre_snap: string; emoji_snap: string | null }[] }[]

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket #${pedido.numero_pedido}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Courier New',monospace; background:#f5f5f5; display:flex; flex-direction:column; align-items:center; padding:20px; gap:12px; }
.ticket { background:white; width:320px; padding:20px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.1); }
.header { text-align:center; border-bottom:1px dashed #ddd; padding-bottom:12px; margin-bottom:12px; }
.empresa { font-size:16px; font-weight:bold; color:${primaryColor}; }
.sub { font-size:11px; color:#666; margin-top:2px; }
.no-fiscal { background:#fff3cd; border:1px solid #ffc107; color:#856404; font-size:10px; padding:4px 8px; border-radius:4px; margin:8px 0; text-align:center; font-weight:bold; }
.pedido-num { font-size:20px; font-weight:bold; color:${primaryColor}; text-align:center; margin-bottom:4px; }
.info { display:flex; justify-content:space-between; font-size:11px; color:#666; margin-bottom:12px; }
.items { border-top:1px dashed #ddd; padding-top:12px; }
.item { margin-bottom:10px; }
.item-nombre { font-size:12px; font-weight:bold; }
.item-pres { font-size:11px; color:#666; }
.item-ops { font-size:10px; color:#888; margin-top:1px; }
.item-precio { display:flex; justify-content:space-between; font-size:12px; margin-top:2px; }
.total-section { border-top:1px dashed #ddd; margin-top:12px; padding-top:12px; }
.total-final { display:flex; justify-content:space-between; font-size:16px; font-weight:bold; color:${primaryColor}; margin-top:6px; }
.metodo { text-align:center; font-size:11px; color:#666; margin-top:8px; padding:6px; background:#f8f9fa; border-radius:4px; }
.footer { text-align:center; font-size:10px; color:#aaa; margin-top:14px; padding-top:12px; border-top:1px dashed #ddd; }
.btns { display:flex; gap:8px; }
.btn { padding:10px 24px; border:none; border-radius:8px; cursor:pointer; font-size:14px; font-weight:bold; }
@media print { body { background:white; padding:0; } .ticket { box-shadow:none; } .btns { display:none; } }
</style>
</head>
<body>
<div class="ticket">
  <div class="header">
    <div class="empresa">${empresa?.nombre ?? 'Heladería'}</div>
    ${cfg?.razon_social ? `<div class="sub">${cfg.razon_social}</div>` : ''}
    ${cfg?.cuit ? `<div class="sub">CUIT: ${cfg.cuit}</div>` : ''}
    <div class="sub">${(pedido.sucursales as { nombre: string } | null)?.nombre ?? ''}</div>
  </div>
  <div class="no-fiscal">⚠ TICKET SIN VALIDEZ FISCAL</div>
  <div class="pedido-num">Pedido #${pedido.numero_pedido}</div>
  <div class="info"><span>${fecha}</span><span>Retiro: ${pedido.codigo_retiro}</span></div>
  <div class="items">
    ${items.map(item => `
    <div class="item">
      <div class="item-nombre">${item.nombre_producto_snap}</div>
      <div class="item-pres">${item.nombre_presentacion_snap}</div>
      ${item.pedido_item_opciones?.length > 0 ? `<div class="item-ops">${item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(' · ')}</div>` : ''}
      <div class="item-precio"><span>x${item.cantidad}</span><span>${fmt(item.precio_snap)}</span></div>
    </div>`).join('')}
  </div>
  <div class="total-section">
    <div class="total-final"><span>TOTAL</span><span>${fmt(pedido.total)}</span></div>
  </div>
  <div class="metodo">Pago: ${metodoLabel[pedido.metodo_pago ?? ''] ?? pedido.metodo_pago ?? '—'}</div>
  <div class="footer"><div>¡Gracias por tu compra!</div><div style="margin-top:4px">ConeOS · Sistema de pedidos</div></div>
</div>
<div class="btns">
  <button class="btn" style="background:${primaryColor};color:white" onclick="window.print()">🖨️ Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>
</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
