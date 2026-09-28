import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ═══════════════════════════════════════════════════════════════
// COMPROBANTE IMPRIMIBLE (Factura C / NC C) — pedido JC 28/09.
// Vista formal para imprimir o guardar como PDF desde Admin →
// Facturas. REGLA MULTI-CUIT (certificada 28/09): el emisor sale
// del facturacion_config_id CONGELADO de la factura — jamás de la
// config "actual" de la empresa. Facturas históricas (config null)
// → config fallback (principal). Mismo patrón que el ticket.
// ═══════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic'

const pad = (n: number, l: number) => String(n).padStart(l, '0')
const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtCuit = (c: string) => c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TIPO_LABEL: Record<number, { titulo: string; letra: string }> = {
  11: { titulo: 'FACTURA', letra: 'C' },
  13: { titulo: 'NOTA DE CRÉDITO', letra: 'C' },
}
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
    ? await supabase.from('facturacion_config').select('cuit, razon_social, condicion_fiscal').eq('id', f.facturacion_config_id).maybeSingle()
    : await supabase.from('facturacion_config').select('cuit, razon_social, condicion_fiscal').eq('empresa_id', f.empresa_id).eq('es_fallback', true).maybeSingle()

  const [{ data: empresa }, { data: pedido }] = await Promise.all([
    supabase.from('empresas').select('nombre').eq('id', f.empresa_id).single(),
    f.pedido_id
      ? supabase.from('pedidos').select('numero_pedido, receptor_doc_nro, receptor_cond_iva, receptor_razon_social, sucursales(nombre, direccion), pedido_items(nombre_producto_snap, nombre_presentacion_snap, precio_snap, cantidad)')
          .eq('id', f.pedido_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const t = TIPO_LABEL[f.tipo_cbte] ?? { titulo: `COMPROBANTE ${f.tipo_cbte}`, letra: '' }
  const esNC = f.tipo_cbte === 13
  const cuitEmisor = String(emisor?.cuit ?? '').replace(/\D/g, '')
  const suc = Array.isArray(pedido?.sucursales) ? pedido?.sucursales[0] : pedido?.sucursales
  const fechaCbte = new Date(f.created_at)
  const fechaLarga = fechaCbte.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' })
  const fechaISO = fechaCbte.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const vto = f.cae_vencimiento ? f.cae_vencimiento.split('-').reverse().join('/') : ''

  // Receptor: el fiscal del pedido si existe (FA-1), si no Consumidor Final
  const receptor = pedido?.receptor_doc_nro
    ? { razon: pedido.receptor_razon_social ?? '', cuit: fmtCuit(String(pedido.receptor_doc_nro)), cond: COND_LABEL[pedido.receptor_cond_iva ?? 5] ?? '' }
    : { razon: 'Consumidor Final', cuit: '', cond: 'Consumidor Final' }

  type Item = { nombre_producto_snap: string; nombre_presentacion_snap: string; precio_snap: number; cantidad: number }
  const items = ((pedido?.pedido_items ?? []) as Item[])

  // QR ARCA — misma especificación que el ticket, con el CUIT del emisor congelado
  const qrData = {
    ver: 1, fecha: fechaISO, cuit: Number(cuitEmisor), ptoVta: f.punto_venta, tipoCmp: f.tipo_cbte,
    nroCmp: f.nro_cbte, importe: Number(f.total), moneda: 'PES', ctz: 1,
    tipoDocRec: f.doc_tipo ?? 99, nroDocRec: Number(f.doc_nro ?? 0), tipoCodAut: 'E', codAut: Number(f.cae),
  }
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(qrData)).toString('base64')}`

  const filasItems = items.length
    ? items.map(i => `<tr><td>${esc(i.nombre_producto_snap)}${i.nombre_presentacion_snap ? ` — ${esc(i.nombre_presentacion_snap)}` : ''}</td><td class="num">${i.cantidad}</td><td class="num">${fmt(Number(i.precio_snap))}</td><td class="num">${fmt(Number(i.precio_snap) * i.cantidad)}</td></tr>`).join('')
    : `<tr><td>${esNC ? 'Anulación de comprobante asociado' : 'Venta'}</td><td class="num">1</td><td class="num">${fmt(Number(f.total))}</td><td class="num">${fmt(Number(f.total))}</td></tr>`

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${t.titulo} ${t.letra} ${pad(f.punto_venta, 5)}-${pad(f.nro_cbte, 8)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #111; padding: 28px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  .marco { border: 1.5px solid #111; }
  .cabecera { display: flex; position: relative; border-bottom: 1.5px solid #111; }
  .col { flex: 1; padding: 14px 16px; }
  .col + .col { border-left: 1.5px solid #111; padding-left: 40px; }
  .letra { position: absolute; left: 50%; top: 0; transform: translateX(-50%); border: 1.5px solid #111; border-top: none; background: #fff; width: 52px; text-align: center; padding: 6px 0 4px; }
  .letra b { font-size: 26px; display: block; line-height: 1; }
  .letra span { font-size: 9px; color: #555; }
  h1 { font-size: 17px; margin-bottom: 2px; }
  .sub { color: #444; font-size: 12px; line-height: 1.45; }
  .tit { font-size: 15px; font-weight: bold; margin-bottom: 4px; }
  .receptor { padding: 10px 16px; border-bottom: 1.5px solid #111; display: flex; gap: 30px; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 11px; text-transform: uppercase; color: #555; border-bottom: 1px solid #999; padding: 8px 16px; }
  tbody td { padding: 7px 16px; border-bottom: 1px solid #eee; }
  .num { text-align: right; white-space: nowrap; }
  .total { display: flex; justify-content: flex-end; padding: 12px 16px; border-top: 1.5px solid #111; font-size: 17px; font-weight: bold; gap: 40px; }
  .pie { display: flex; align-items: center; gap: 18px; padding: 14px 16px; border-top: 1.5px solid #111; }
  .pie .cae { font-size: 12px; line-height: 1.6; }
  #qr { width: 96px; height: 96px; }
  .anulada { color: #b91c1c; font-weight: bold; font-size: 12px; margin-top: 4px; }
  .acciones { text-align: center; margin: 18px 0; }
  .acciones button { padding: 10px 26px; font-size: 14px; font-weight: bold; border: 1px solid #ccc; border-radius: 8px; background: #f7f7f7; cursor: pointer; }
  @media print { .acciones { display: none; } body { padding: 0; } }
</style></head>
<body>
  <div class="acciones"><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
  <div class="marco">
    <div class="cabecera">
      <div class="letra"><b>${t.letra}</b><span>Cod. ${pad(f.tipo_cbte, 2)}</span></div>
      <div class="col">
        <h1>${esc(emisor?.razon_social ?? empresa?.nombre ?? '')}</h1>
        <div class="sub">${esc(empresa?.nombre ?? '')}${suc?.nombre ? ` — ${esc(suc.nombre)}` : ''}</div>
        ${suc?.direccion ? `<div class="sub">${esc(suc.direccion)}</div>` : ''}
        <div class="sub"><b>CUIT:</b> ${fmtCuit(cuitEmisor)}</div>
        <div class="sub"><b>Condición IVA:</b> ${esc(emisor?.condicion_fiscal === 'ri' ? 'Responsable Inscripto' : 'Monotributo')}</div>
      </div>
      <div class="col">
        <div class="tit">${t.titulo} ${t.letra}</div>
        <div class="sub"><b>N°:</b> ${pad(f.punto_venta, 5)}-${pad(f.nro_cbte, 8)}</div>
        <div class="sub"><b>Fecha:</b> ${fechaLarga}</div>
        ${pedido?.numero_pedido ? `<div class="sub"><b>Pedido:</b> #${pedido.numero_pedido}</div>` : ''}
        ${f.estado === 'anulada' ? `<div class="anulada">ANULADA POR NOTA DE CRÉDITO</div>` : ''}
      </div>
    </div>
    <div class="receptor">
      <span><b>Sr/es:</b> ${esc(receptor.razon)}</span>
      ${receptor.cuit ? `<span><b>CUIT:</b> ${receptor.cuit}</span>` : ''}
      <span><b>Cond. IVA:</b> ${receptor.cond}</span>
    </div>
    <table>
      <thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">P. Unit.</th><th class="num">Importe</th></tr></thead>
      <tbody>${filasItems}</tbody>
    </table>
    <div class="total"><span>TOTAL</span><span>${fmt(Number(f.total))}</span></div>
    <div class="pie">
      <img id="qr" alt="QR ARCA" />
      <div class="cae">
        <div><b>CAE:</b> ${f.cae}${vto ? ` &nbsp;·&nbsp; <b>Vto:</b> ${vto}` : ''}</div>
        <div style="color:#666">Comprobante autorizado por ARCA</div>
      </div>
    </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    (function(){
      var box = document.createElement('div');
      new QRCode(box, { text: ${JSON.stringify(qrUrl)}, width: 96, height: 96, correctLevel: QRCode.CorrectLevel.M });
      var pintar = function(){
        var img = box.querySelector('img'); var cv = box.querySelector('canvas');
        var src = img && img.src ? img.src : (cv ? cv.toDataURL() : '');
        if (src) document.getElementById('qr').src = src; else setTimeout(pintar, 60);
      };
      setTimeout(pintar, 60);
    })();
  </script>
</body></html>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
