import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Ticket de CUENTA de mesa (F2): consolidado de todos los pedidos de la cuenta,
// para entregar en la mesa o imprimir al cobrar. No fiscal (la factura, si
// corresponde, sale por pedido vía el circuito de siempre).
// POST { mesa_cuenta_id }
export async function POST(request: Request) {
  const { mesa_cuenta_id } = await request.json()
  if (!mesa_cuenta_id) return NextResponse.json({ error: 'mesa_cuenta_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: cuenta } = await supabase.from('mesa_cuentas')
    .select('id, empresa_id, numero_mesa, nombre_cliente, estado, created_at, sucursales(nombre)')
    .eq('id', mesa_cuenta_id).single()
  if (!cuenta) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })

  const [{ data: empresa }, { data: cfg }, { data: pedidos }] = await Promise.all([
    supabase.from('empresas').select('nombre').eq('id', cuenta.empresa_id).single(),
    supabase.from('empresa_config').select('razon_social, cuit').eq('empresa_id', cuenta.empresa_id).maybeSingle(),
    supabase.from('pedidos')
      .select('id, numero_pedido, total, pagado, metodo_pago, nombre_cliente, created_at, pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad, pedido_item_opciones(nombre_snap))')
      .eq('mesa_cuenta_id', mesa_cuenta_id).order('created_at'),
  ])

  const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`
  const metodoLabel: Record<string, string> = { efectivo: 'EFECTIVO', transferencia: 'TRANSFERENCIA', mp: 'MERCADO PAGO', debito: 'DÉBITO', credito: 'CRÉDITO' }
  type Item = { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones: { nombre_snap: string }[] }
  type Ped = { id: string; numero_pedido: number; total: number; pagado: boolean; metodo_pago: string | null; nombre_cliente: string | null; created_at: string; pedido_items: Item[] }
  const peds = (pedidos ?? []) as Ped[]

  const total = peds.reduce((a, p) => a + Number(p.total), 0)
  const pendiente = peds.filter(p => !p.pagado).reduce((a, p) => a + Number(p.total), 0)

  const bloques = peds.map(p => `
<div class="pedido-head">Pedido #${p.numero_pedido}${p.nombre_cliente ? ` — ${p.nombre_cliente}` : ''}${p.pagado ? ` <span class="pagado">✓ ${metodoLabel[p.metodo_pago ?? ''] ?? 'PAGADO'}</span>` : ''}</div>
${p.pedido_items.map(it => `<div class="item-precio"><span class="item-precio-cant">${it.cantidad}x ${it.nombre_presentacion_snap}${it.pedido_item_opciones?.length ? `<div class="item-ops">${it.pedido_item_opciones.map(o => o.nombre_snap).join(' - ')}</div>` : ''}</span><span class="item-precio-val">${fmt(Number(it.precio_snap) * it.cantidad)}</span></div>`).join('')}
<div class="item-precio sub"><span class="item-precio-cant">Subtotal</span><span class="item-precio-val">${fmt(Number(p.total))}</span></div>`).join('<div class="linea"></div>')

  const fecha = new Date(cuenta.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cuenta Mesa ${cuenta.numero_mesa}</title>
<style>
@media print { @page { margin: 2mm; } .btns { display: none !important; } }
* { margin:0; padding:0; box-sizing:border-box; font-weight: bold; }
body { font-family: 'Calibri', Arial, sans-serif; font-size: 13px; background: white; word-wrap: break-word; }
.linea { border-top: 1px dashed #000; margin: 4px 0; }
.empresa { font-size: 16px; text-align: center; }
.sub { font-size: 12px; font-weight: normal; text-align: center; }
.mesa-num { font-size: 24px; text-align: center; margin: 4px 0; }
.pedido-head { font-size: 13px; margin-top: 2px; }
.pagado { font-size: 11px; font-weight: normal; }
.item-precio { display: table; width: 100%; font-size: 13px; }
.item-precio-cant { display: table-cell; }
.item-precio-val { display: table-cell; text-align: right; vertical-align: top; }
.item-ops { font-size: 11px; font-weight: normal; }
.item-precio.sub { font-size: 12px; font-weight: normal; }
.fila { display: table; width: 100%; }
.total-label { display: table-cell; font-size: 16px; }
.total-valor { display: table-cell; font-size: 16px; text-align: right; }
.pend { color: #000; }
.footer { font-size: 11px; font-weight: normal; text-align: center; margin-top: 6px; }
.btns { display: flex; gap: 8px; margin-top: 12px; justify-content: center; }
.btn { padding: 10px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; }
</style>
</head>
<body>
<div class="empresa">${empresa?.nombre ?? ''}</div>
${cfg?.razon_social ? `<div class="sub">${cfg.razon_social}</div>` : ''}
<div class="sub">${(cuenta.sucursales as { nombre: string } | null)?.nombre ?? ''}</div>
<div class="linea"></div>
<div class="mesa-num">🪑 MESA ${cuenta.numero_mesa}</div>
<div class="sub">${cuenta.nombre_cliente ?? ''} · Abierta ${fecha}</div>
<div class="linea"></div>
${bloques}
<div class="linea"></div>
<div class="fila"><span class="total-label">TOTAL</span><span class="total-valor">${fmt(total)}</span></div>
${pendiente > 0 && pendiente < total ? `<div class="fila"><span class="total-label pend" style="font-size:13px">Pendiente</span><span class="total-valor pend" style="font-size:13px">${fmt(pendiente)}</span></div>` : ''}
<div class="sub" style="margin-top:4px">TICKET SIN VALIDEZ FISCAL</div>
<div class="footer">Gracias por tu visita!</div>
<div class="btns">
  <button class="btn" style="background:#000;color:white" onclick="window.print()">Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>
</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
