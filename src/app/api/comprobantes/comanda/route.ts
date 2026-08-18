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
  const metodoLabel: Record<string, string> = { efectivo: 'EFECTIVO', transferencia: 'TRANSFERENCIA', mp: 'MERCADO PAGO' }
  const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`
  const fecha = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'numeric' })

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Comanda #${pedido.numero_pedido}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, sans-serif; background: white; display: flex; flex-direction: column; align-items: center; padding: 10px; }
.ticket { width: 72mm; padding: 4mm; }
.linea { border-top: 1px dashed #000; margin: 6px 0; }
.centro { text-align: center; }
.grande { font-size: 28px; font-weight: bold; }
.medio { font-size: 18px; font-weight: bold; }
.normal { font-size: 14px; }
.chico { font-size: 12px; color: #444; }
.item-pres { font-size: 16px; font-weight: bold; margin-top: 6px; }
.item-sab { font-size: 14px; margin-left: 8px; }
.fila { display: flex; justify-content: space-between; }
.total-label { font-size: 18px; font-weight: bold; }
.total-valor { font-size: 22px; font-weight: bold; }
.metodo { font-size: 16px; font-weight: bold; text-align: center; margin-top: 6px; }
.cadete { font-size: 16px; font-weight: bold; text-align: center; margin-top: 6px; border: 2px solid #000; padding: 4px; }
.footer { font-size: 11px; text-align: center; color: #666; margin-top: 8px; }
.btns { display: flex; gap: 8px; margin-top: 12px; }
.btn { padding: 10px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; }
@media print { body { padding: 0; } .btns { display: none; } }
</style>
</head>
<body>
<div class="ticket">

  <div class="centro">
    <div class="grande">#${pedido.numero_pedido}</div>
    <div class="chico">${fecha}</div>
  </div>

  <div class="linea"></div>

  ${datos?.direccion ? `
  <div class="medio">${datos.direccion}</div>
  ${datos.entre_calles ? `<div class="normal">entre ${datos.entre_calles}</div>` : ''}
  ` : ''}

  <div class="linea"></div>

  ${items.map(item => `
  <div>
    <div class="item-pres">${item.cantidad > 1 ? `${item.cantidad}x ` : ''}${item.nombre_presentacion_snap}</div>
    ${item.pedido_item_opciones?.length > 0
      ? item.pedido_item_opciones.map(op => `<div class="item-sab">${op.nombre_snap}</div>`).join('')
      : ''}
  </div>`).join('<div class="linea"></div>')}

  <div class="linea"></div>

  ${datos?.telefono ? `<div class="normal">${datos.telefono}</div>` : ''}
  ${datos?.nombre ? `<div class="chico">${datos.nombre}</div>` : ''}

  <div class="linea"></div>

  <div class="fila">
    <span class="total-label">TOTAL</span>
    <span class="total-valor">${fmt(pedido.total)}</span>
  </div>
  <div class="metodo">${metodoLabel[pedido.metodo_pago ?? ''] ?? pedido.metodo_pago ?? '—'}</div>

  ${pedido.colaborador_nombre ? `
  <div class="linea"></div>
  <div class="cadete">CADETE: ${pedido.colaborador_nombre}</div>` : ''}

  <div class="footer">este ticket es la confirmación de tu pedido</div>

</div>

<div class="btns">
  <button class="btn" style="background:#000;color:white" onclick="window.print()">Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>
</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
