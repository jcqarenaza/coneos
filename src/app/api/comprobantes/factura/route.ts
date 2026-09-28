import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ═══════════════════════════════════════════════════════════════
// COMPROBANTE IMPRIMIBLE (Factura C / NC C) — pedido JC 28/09.
// FORMATO TICKET DE COMANDERA (mismo molde y CSS que el ticket del
// pedido): Lucy imprime en térmica, no en A4. REGLA MULTI-CUIT
// (certificada 28/09): el emisor sale del facturacion_config_id
// CONGELADO de la factura — jamás de la config actual. Facturas
// históricas (config null) → config fallback (principal).
// ═══════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic'

const pad = (n: number, l: number) => String(n).padStart(l, '0')
const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`
const fmtCuit = (c: string) => c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TIPO_LABEL: Record<number, string> = { 11: 'FACTURA C', 13: 'NOTA DE CRÉDITO C' }
const COND_LABEL: Record<number, string> = { 1: 'Responsable Inscripto', 4: 'IVA Exento', 5: 'Consumidor Final', 6: 'Monotributo' }

export async function GET(req: NextRequest) {
  const facturaId = req.nextUrl.searchParams.get('factura_id')
  if (!facturaId) return NextResponse.json({ error: 'factura_id requerido' }, { status: 400 })

  const supabase = createAdminClient()

  const { data: f } = await supabase.from('facturas')
    .select('id, empresa_id, pedido_id, tipo_cbte, punto_venta, nro_cbte, cae, cae_vencimiento, doc_tipo, doc_nro, total, created_at, estado, facturacion_config_id')
    .eq('id', facturaId).maybeSingle()
  if (!f || !f.cae || f.nro_cbte == null) {
    return NextResponse.json({ error: 'Comprobante no encontrado o sin emitir' }, { status: 404 })
  }

  // Emisor CONGELADO de la factura (fallback = principal para históricas)
  const { data: emisor } = f.facturacion_config_id
    ? await supabase.from('facturacion_config').select('cuit, razon_social').eq('id', f.facturacion_config_id).maybeSingle()
    : await supabase.from('facturacion_config').select('cuit, razon_social').eq('empresa_id', f.empresa_id).eq('es_fallback', true).maybeSingle()

  const [{ data: empresa }, { data: pedido }] = await Promise.all([
    supabase.from('empresas').select('nombre').eq('id', f.empresa_id).single(),
    f.pedido_id
      ? supabase.from('pedidos').select('numero_pedido, metodo_pago, receptor_doc_nro, receptor_cond_iva, receptor_razon_social, sucursales(nombre), pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad)')
          .eq('id', f.pedido_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const tipoLabel = TIPO_LABEL[f.tipo_cbte] ?? `COMPROBANTE ${f.tipo_cbte}`
  const esNC = f.tipo_cbte === 13
  const cuitEmisor = String(emisor?.cuit ?? '').replace(/\D/g, '')
  const suc = Array.isArray(pedido?.sucursales) ? pedido?.sucursales[0] : pedido?.sucursales
  const fechaCbte = new Date(f.created_at)
  const fecha = fechaCbte.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const fechaISO = fechaCbte.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const vto = f.cae_vencimiento ? f.cae_vencimiento.split('-').reverse().join('/') : ''

  const receptor = pedido?.receptor_doc_nro
    ? `Sr/es: ${esc(pedido.receptor_razon_social ?? '')} · CUIT: ${fmtCuit(String(pedido.receptor_doc_nro))} · ${COND_LABEL[pedido.receptor_cond_iva ?? 5] ?? ''}`
    : 'Consumidor Final'

  type Item = { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number }
  const items = ((pedido?.pedido_items ?? []) as Item[])
  const itemsHtml = items.length
    ? items.map(i => `<div class="item-prod">${esc(i.nombre_producto_snap)}</div>
<div class="item-pres">${esc(i.nombre_presentacion_snap ?? '')}</div>
<div class="item-precio"><span class="item-precio-cant">x${i.cantidad}</span><span class="item-precio-val">${fmt(Number(i.precio_snap) * i.cantidad)}</span></div>`).join('<div class="linea"></div>')
    : `<div class="item-pres">${esNC ? 'Anulación de comprobante asociado' : 'Venta'}</div>
<div class="item-precio"><span class="item-precio-cant">x1</span><span class="item-precio-val">${fmt(Number(f.total))}</span></div>`

  const METODO: Record<string, string> = { efectivo: 'EFECTIVO', transferencia: 'TRANSFERENCIA', mp: 'MERCADO PAGO', debito: 'DÉBITO', credito: 'CRÉDITO' }

  const qrData = {
    ver: 1, fecha: fechaISO, cuit: Number(cuitEmisor), ptoVta: f.punto_venta, tipoCmp: f.tipo_cbte,
    nroCmp: f.nro_cbte, importe: Number(f.total), moneda: 'PES', ctz: 1,
    tipoDocRec: f.doc_tipo ?? 99, nroDocRec: Number(f.doc_nro ?? 0), tipoCodAut: 'E', codAut: Number(f.cae),
  }
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(qrData)).toString('base64')}`

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${tipoLabel} ${pad(f.punto_venta, 5)}-${pad(f.nro_cbte, 8)}</title>
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
.fiscal-tipo { font-size: 15px; font-weight: bold; text-align: center; border: 1px solid #000; padding: 2px; margin: 4px 0; }
.anulada { font-size: 12px; font-weight: bold; text-align: center; border: 2px solid #000; padding: 3px; margin: 4px 0; }
.qr-box { display: flex; justify-content: center; margin: 6px 0 2px 0; }
.qr-box img, .qr-box canvas { image-rendering: pixelated; }
.pedido-num { font-size: 26px; font-weight: bold; text-align: center; margin: 4px 0; }
.info { display: flex; justify-content: space-between; font-size: 12px; font-weight: normal; }
.item-prod { font-size: 12px; font-weight: normal; }
.item-pres { font-size: 14px; font-weight: bold; }
.item-precio { display: table; width: 100%; font-size: 13px; }
.item-precio-cant { display: table-cell; }
.item-precio-val { display: table-cell; text-align: right; }
.fila { display: table; width: 100%; }
.total-label { display: table-cell; font-size: 16px; font-weight: bold; }
.total-valor { display: table-cell; font-size: 16px; font-weight: bold; text-align: right; }
.metodo { font-size: 14px; font-weight: bold; text-align: center; margin-top: 4px; }
.footer { font-size: 11px; font-weight: normal; text-align: center; margin-top: 6px; }
.btns { display: flex; gap: 8px; margin-top: 12px; justify-content: center; }
.btns button { padding: 8px 18px; font-size: 13px; font-weight: bold; border: 1px solid #ccc; border-radius: 8px; background: #f7f7f7; cursor: pointer; }
</style></head>
<body>
<div class="empresa">${esc(empresa?.nombre ?? '')}</div>
<div class="sub">${esc(emisor?.razon_social ?? '')}</div>
<div class="sub">CUIT: ${fmtCuit(cuitEmisor)}</div>
${suc?.nombre ? `<div class="sub">${esc(String(suc.nombre))}</div>` : ''}
<div class="fiscal-tipo">${tipoLabel}</div>
<div class="sub">Cod. ${pad(f.tipo_cbte, 3)} &nbsp;·&nbsp; Nro: ${pad(f.punto_venta, 5)}-${pad(f.nro_cbte, 8)}</div>
<div class="sub">Fecha: ${fecha} &nbsp;·&nbsp; ${receptor}</div>
${f.estado === 'anulada' ? '<div class="anulada">✕ ANULADA POR NOTA DE CRÉDITO</div>' : ''}
${pedido?.numero_pedido ? `<div class="pedido-num">#${pedido.numero_pedido}</div>` : ''}
<div class="linea"></div>
${itemsHtml}
<div class="linea"></div>
<div class="fila"><span class="total-label">TOTAL</span><span class="total-valor">${fmt(Number(f.total))}</span></div>
${pedido?.metodo_pago && !esNC ? `<div class="metodo">${METODO[pedido.metodo_pago] ?? pedido.metodo_pago.toUpperCase()}</div>` : ''}
<div class="linea"></div>
<div class="sub">CAE: ${f.cae}${vto ? ` &nbsp;·&nbsp; Vto: ${vto}` : ''}</div>
<div id="qr-arca" class="qr-box"></div>
<div class="footer">Comprobante autorizado por ARCA</div>
<div class="btns"><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
<script>
  new QRCode(document.getElementById('qr-arca'), { text: ${JSON.stringify(qrUrl)}, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.L });
<\/script>
</body></html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
