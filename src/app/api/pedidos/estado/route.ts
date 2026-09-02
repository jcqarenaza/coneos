import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { pedido_id, nombre_cliente } = await request.json()
  if (!pedido_id) return NextResponse.json({ error: 'pedido_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: pedido } = await supabase
    .from('pedidos')
    .select(`id, numero_pedido, codigo_retiro, total, metodo_pago, created_at,
      empresa_id, sucursal_id, sucursales(nombre),
      pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad,
        pedido_item_opciones(nombre_snap, emoji_snap))`)
    .eq('id', pedido_id)
    .single()

  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

  const [{ data: cfg }, { data: empresa }, { data: factura }, { data: factCfg }] = await Promise.all([
    supabase.from('empresa_config').select('primary_color, cuit, razon_social, logo_url').eq('empresa_id', pedido.empresa_id).single(),
    supabase.from('empresas').select('nombre').eq('id', pedido.empresa_id).single(),
    supabase.from('facturas').select('tipo_cbte, punto_venta, nro_cbte, cae, cae_vencimiento, doc_tipo, doc_nro, total, created_at').eq('pedido_id', pedido_id).eq('estado', 'emitida').maybeSingle(),
    supabase.from('facturacion_config').select('cuit, razon_social, sucursal_id').eq('empresa_id', pedido.empresa_id).is('sucursal_id', null).maybeSingle(),
  ])
  // Si la sucursal del pedido tiene config fiscal propia (franquicia), usar esa para el encabezado
  const pedidoSucursalId = (pedido as { sucursal_id?: string | null }).sucursal_id ?? null
  let factCfgFinal = factCfg
  if (pedidoSucursalId) {
    const { data: cfgSuc } = await supabase.from('facturacion_config')
      .select('cuit, razon_social, sucursal_id').eq('empresa_id', pedido.empresa_id).eq('sucursal_id', pedidoSucursalId).maybeSingle()
    if (cfgSuc) factCfgFinal = cfgSuc
  }

  await supabase.from('comprobantes').insert({ empresa_id: pedido.empresa_id, pedido_id, tipo: 'ticket', total: pedido.total })

  const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`
  const fecha = new Date(pedido.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const metodoLabel: Record<string, string> = { efectivo: 'EFECTIVO', transferencia: 'TRANSFERENCIA', mp: 'MERCADO PAGO' }
  type Item = { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number; pedido_item_opciones: { nombre_snap: string; emoji_snap: string | null }[] }
  const items = (pedido.pedido_items ?? []) as Item[]

  // ── Datos fiscales (solo si hay factura emitida) ──
  const esFiscal = !!(factura && factura.cae)
  const pad = (n: number, len: number) => String(n).padStart(len, '0')
  let bloqueFiscalHeader = '<div class="no-fiscal">TICKET SIN VALIDEZ FISCAL</div>'
  let bloqueFiscalFooter = ''
  let scriptQR = ''
  if (esFiscal && factura) {
    const cuitNum = (factCfgFinal?.cuit ?? cfg?.cuit ?? '').replace(/\D/g, '')
    const tipoLabel = factura.tipo_cbte === 13 ? 'NOTA DE CRÉDITO C' : 'FACTURA C'
    const fechaCbte = new Date(factura.created_at).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) // YYYY-MM-DD
    const qrData = {
      ver: 1,
      fecha: fechaCbte,
      cuit: Number(cuitNum),
      ptoVta: factura.punto_venta,
      tipoCmp: factura.tipo_cbte,
      nroCmp: factura.nro_cbte,
      importe: Number(factura.total),
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: factura.doc_tipo ?? 99,
      nroDocRec: Number(factura.doc_nro ?? 0),
      tipoCodAut: 'E',
      codAut: Number(factura.cae),
    }
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(qrData)).toString('base64')}`
    const vto = factura.cae_vencimiento ? new Date(factura.cae_vencimiento + 'T12:00:00').toLocaleDateString('es-AR') : ''
    const fechaCbteAR = fechaCbte.split('-').reverse().join('/')

    bloqueFiscalHeader = `<div class="fiscal-tipo">${tipoLabel}</div>
<div class="sub">Cod. ${pad(factura.tipo_cbte, 3)} &nbsp;·&nbsp; Nro: ${pad(factura.punto_venta, 5)}-${pad(factura.nro_cbte, 8)}</div>
<div class="sub">Fecha: ${fechaCbteAR} &nbsp;·&nbsp; Consumidor Final</div>`

    bloqueFiscalFooter = `<div class="linea"></div>
<div class="sub">CAE: ${factura.cae}${vto ? ` &nbsp;·&nbsp; Vto: ${vto}` : ''}</div>
<div id="qr-arca" class="qr-box"></div>`

    scriptQR = `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
<script>
  try {
    new QRCode(document.getElementById('qr-arca'), { text: ${JSON.stringify(qrUrl)}, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.L });
  } catch (e) { console.error('QR:', e); }
<\/script>`
  }

  // Accesorios agrupados: título + subtotal, detalle en chico
  const esAccesorio = (it: Item) => it.nombre_producto_snap === 'Accesorios' || it.nombre_producto_snap === it.nombre_presentacion_snap
  const normales = items.filter(it => !esAccesorio(it))
  const accesorios = items.filter(esAccesorio)
  const totalAccesorios = accesorios.reduce((s, it) => s + Number(it.precio_snap) * it.cantidad, 0)

  const bloquesItems = normales.map(item => {
  const prod = (item.nombre_producto_snap ?? '').toLowerCase()
  const pres = (item.nombre_presentacion_snap ?? '').toLowerCase()
  const mostrarProd = prod && !pres.includes(prod) && !prod.includes(pres)
  return `<div>
  ${mostrarProd ? `<div class="item-prod">${item.nombre_producto_snap}</div>` : ''}
  <div class="item-pres">${item.cantidad > 1 ? `${item.cantidad}x ` : ''}${item.nombre_presentacion_snap}</div>
  ${item.pedido_item_opciones?.length > 0 ? `<div class="item-ops">${item.pedido_item_opciones.map(op => op.nombre_snap).join(' - ')}</div>` : ''}
  <div class="item-precio"><span class="item-precio-cant">x${item.cantidad}</span><span class="item-precio-val">${fmt(item.precio_snap)}</span></div>
</div>`})

  if (accesorios.length > 0) {
    bloquesItems.push(`<div>
  <div class="item-precio"><span class="item-precio-cant"><span class="item-pres">Accesorios</span></span><span class="item-precio-val"><span class="item-pres">${fmt(totalAccesorios)}</span></span></div>
  ${accesorios.map(item => `<div class="item-precio acc-det"><span class="item-precio-cant">${item.cantidad}x ${item.nombre_presentacion_snap.replace(/^Toppings?\s+/i, '')}</span><span class="item-precio-val">${fmt(Number(item.precio_snap) * item.cantidad)}</span></div>`).join('')}
</div>`)
  }

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
.fiscal-tipo { font-size: 15px; font-weight: bold; text-align: center; border: 1px solid #000; padding: 2px; margin: 4px 0; }
.qr-box { display: flex; justify-content: center; margin: 6px 0 2px 0; }
.qr-box img, .qr-box canvas { image-rendering: pixelated; }
.pedido-num { font-size: 26px; font-weight: bold; text-align: center; margin: 4px 0; }
.info { display: flex; justify-content: space-between; font-size: 12px; font-weight: normal; }
.item-prod { font-size: 12px; font-weight: normal; }
.item-pres { font-size: 14px; font-weight: bold; }
.item-ops { font-size: 13px; font-weight: bold; }
.item-precio { display: table; width: 100%; font-size: 13px; }
.item-precio-cant { display: table-cell; }
.item-precio-val { display: table-cell; text-align: right; }
.acc-det { font-size: 12px; font-weight: normal; }
.acc-det * { font-weight: normal; }
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
${esFiscal ? `<div class="sub">${factCfgFinal?.razon_social ?? cfg?.razon_social ?? ''}</div><div class="sub">CUIT: ${factCfgFinal?.cuit ?? cfg?.cuit ?? ''}</div>` : `${cfg?.razon_social ? `<div class="sub">${cfg.razon_social}</div>` : ''}${cfg?.cuit ? `<div class="sub">CUIT: ${cfg.cuit}</div>` : ''}`}
<div class="sub">${(pedido.sucursales as { nombre: string } | null)?.nombre ?? ''}</div>

<div class="linea"></div>
${bloqueFiscalHeader}
<div class="linea"></div>

<div class="pedido-num">#${pedido.numero_pedido}</div>
<div class="info"><span>${fecha}</span><span>Retiro: ${pedido.codigo_retiro}</span></div>

<div class="linea"></div>

${bloquesItems.join('<div class="linea"></div>')}

<div class="linea"></div>

<div class="fila">
  <span class="total-label">TOTAL</span>
  <span class="total-valor">${fmt(pedido.total)}</span>
</div>
<div class="metodo">${metodoLabel[pedido.metodo_pago ?? ''] ?? pedido.metodo_pago ?? '—'}</div>

${nombre_cliente ? `<div class="linea"></div><div class="sub">Cliente: ${nombre_cliente}</div>` : ''}

${bloqueFiscalFooter}

<div class="linea"></div>
<div class="footer">Gracias por tu compra!</div>

<div class="btns">
  <button class="btn" style="background:#000;color:white" onclick="window.print()">Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>
${scriptQR}
</body>
</html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
