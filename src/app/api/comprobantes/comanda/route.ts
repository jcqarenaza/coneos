import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { pedido_id } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase
    .from('pedidos')
    .select(`id, numero_pedido, total, metodo_pago, datos_delivery, costo_envio, colaborador_nombre,
      pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
        pedido_item_opciones(nombre_snap, emoji_snap))`)
    .eq('id', pedido_id)
    .single()

  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  const items = (pedido.pedido_items ?? []) as {
    nombre_producto_snap: string; nombre_presentacion_snap: string
    precio_snap: number; cantidad: number
    pedido_item_opciones: { nombre_snap: string; emoji_snap: string | null }[]
  }[]

  const datos = pedido.datos_delivery as { nombre?: string; telefono?: string; direccion?: string; entre_calles?: string } | null
  const metodoLabel: Record<string, string> = { efectivo: '💵 Efectivo', transferencia: '📲 Transferencia', mp: '📱 Mercado Pago' }
  const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Comanda #${pedido.numero_pedido}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Courier New',monospace; background:#f5f5f5; display:flex; flex-direction:column; align-items:center; padding:20px; gap:12px; }
.ticket { background:white; width:320px; padding:20px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.1); }
.header { text-align:center; border-bottom:2px solid #000; padding-bottom:12px; margin-bottom:12px; }
.titulo { font-size:18px; font-weight:bold; letter-spacing:2px; }
.pedido-num { font-size:32px; font-weight:bold; text-align:center; margin:8px 0; }
.seccion { border-bottom:1px dashed #ccc; padding:10px 0; margin-bottom:8px; }
.seccion-titulo { font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:1px; color:#666; margin-bottom:6px; }
.dato { font-size:13px; font-weight:bold; margin-bottom:3px; }
.dato-sub { font-size:11px; color:#444; }
.item { margin-bottom:10px; }
.item-pres { font-size:13px; font-weight:bold; }
.item-ops { font-size:11px; color:#333; font-weight:bold; margin-top:2px; }
.total { display:flex; justify-content:space-between; font-size:16px; font-weight:bold; margin-top:10px; padding-top:10px; border-top:2px solid #000; }
.cadete { background:#000; color:#fff; text-align:center; padding:8px; border-radius:4px; font-size:13px; font-weight:bold; margin-top:10px; }
.btns { display:flex; gap:8px; }
.btn { padding:10px 24px; border:none; border-radius:8px; cursor:pointer; font-size:14px; font-weight:bold; }
@media print { body { background:white; padding:0; } .ticket { box-shadow:none; } .btns { display:none; } }
</style>
</head>
<body>
<div class="ticket">
  <div class="header">
    <div class="titulo">🛵 COMANDA DELIVERY</div>
    <div class="pedido-num">#${pedido.numero_pedido}</div>
  </div>
  ${datos ? `<div class="seccion">
    <div class="seccion-titulo">📍 Dirección de entrega</div>
    <div class="dato">${datos.direccion ?? ''}</div>
    ${datos.entre_calles ? `<div class="dato-sub">Entre: ${datos.entre_calles}</div>` : ''}
  </div>` : ''}
  <div class="seccion">
    <div class="seccion-titulo">🍦 Pedido</div>
    ${items.map(item => `<div class="item">
      <div class="item-pres">${item.cantidad}× ${item.nombre_presentacion_snap}</div>
      ${item.pedido_item_opciones?.length > 0 ? `<div class="item-ops">${item.pedido_item_opciones.map(op => `${op.emoji_snap ?? ''} ${op.nombre_snap}`).join(' · ')}</div>` : ''}
    </div>`).join('')}
  </div>
  ${datos?.telefono ? `<div class="seccion">
    <div class="seccion-titulo">📞 Teléfono</div>
    <div class="dato">${datos.telefono}</div>
    ${datos.nombre ? `<div class="dato-sub">${datos.nombre}</div>` : ''}
  </div>` : ''}
  <div class="seccion">
    <div class="seccion-titulo">💳 Método de pago</div>
    <div class="dato">${metodoLabel[pedido.metodo_pago ?? ''] ?? pedido.metodo_pago ?? '—'}</div>
  </div>
  <div class="total"><span>TOTAL</span><span>${fmt(pedido.total)}</span></div>
  ${pedido.colaborador_nombre ? `<div class="cadete">🛵 ${pedido.colaborador_nombre}</div>` : ''}
</div>
<div class="btns">
  <button class="btn" style="background:#000;color:white" onclick="window.print()">🖨️ Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>
</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
