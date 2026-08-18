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
@media print {
  @page { margin: 2mm; }
  .btns { display: none !important; }
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Calibri', Arial, sans-serif; font-size: 13px; font-weight: bold; background: white; padding: 0; margin: 0; word-wrap: break-word; overflow-wrap: break-word; }
* { font-weight: bold !important; }
.linea { border-top: 1px dashed #000; margin: 4px 0; }
.grande { font-size: 28px; font-weight: bold; text-align: center; }
.chico { font-size: 12px; font-weight: normal; text-align: center; }
.dato { font-size: 14px; font-weight: bold; }
.dato-sub { font-size: 12px; font-weight: normal; }
.item-prod { font-size: 12px; font-weight: normal; }
.item-pres { font-size: 14px; font-weight: bold; }
.item-ops { font-size: 13px; font-weight: bold; margin-top: 2px; }
.fila { display: table; width: 100%; }
.total-label { display: table-cell; font-size: 16px; font-weight: bold; }
.total-valor { display: table-cell; font-size: 16px; font-weight: bold; text-align: right; }
.metodo { font-size: 15px; font-weight: bold; text-align: center; margin-top: 4px; }
.cadete { border: 2px solid #000; text-align: center; padding: 5px; font-size: 14px; font-weight: bold; margin-top: 6px; }
.footer { font-size: 11px; font-weight: normal; text-align: center; margin-top: 6px; }
.btns { display: flex; gap: 8px; margin-top: 12px; justify-content: center; }
.btn { padding: 10px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; }
</style>
</head>
<body>

<div class="grande">#${pedido.numero_pedido}</div>
<div class="chico">${fecha}</div>

<div class="linea"></div>

${datos?.direccion ? `
<div class="dato">${datos.direccion}</div>
${datos.entre_calles ? `<div class="dato-sub">${datos.entre_calles}</div>` : ''}
<div class="linea"></div>` : ''}

${items.map(item => `
<div>
  <div class="item-prod">${item.nombre_producto_snap}</div>
  <div class="item-pres">${item.cantidad > 1 ? `${item.cantidad}x ` : ''}${item.nombre_presentacion_snap}</div>
  ${item.pedido_item_opciones?.length > 0 ? `<div class="item-ops">${item.pedido_item_opciones.map(op => op.nombre_snap).join(' - ')}</div>` : ''}
</div>`).join('<div class="linea"></div>')}

<div class="linea"></div>

${datos?.telefono ? `<div class="dato">${datos.telefono}</div>` : ''}
${datos?.nombre ? `<div class="dato-sub">${datos.nombre}</div>` : ''}

<div class="linea"></div>

<div class="fila">
  <span class="total-label">TOTAL</span>
  <span class="total-valor">${fmt(pedido.total)}</span>
</div>
<div class="metodo">${metodoLabel[pedido.metodo_pago ?? ''] ?? pedido.metodo_pago ?? '—'}</div>

${pedido.colaborador_nombre ? `
<div class="linea"></div>
<div class="cadete">CADETE: ${pedido.colaborador_nombre}</div>` : ''}



<div class="btns">
  <button class="btn" style="background:#000;color:white" onclick="window.print()">Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>

</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
