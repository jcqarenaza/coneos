// ═══════════════════════════════════════════════════════════════════
// arca-facturar — Edge Function ConeOS (multi-tenant)
// Adaptada de la versión Piamonte. Diferencias clave:
//  - Config por empresa desde facturacion_config (cert/key en PEM, no .p12)
//  - Token WSAA cacheado por (empresa_id, ambiente)
//  - Factura C monotributo: ImpNeto = total, ImpOpEx = 0, sin IVA
//  - Emite sobre un pedido de ConeOS y registra en tabla facturas
//  - accion 'nota_credito': NC C (tipo 13) con CbtesAsoc sobre la factura del pedido
// ═══════════════════════════════════════════════════════════════════
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/';
const URLS = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gob.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
  'Content-Type': 'application/json',
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}

// ── Helpers XML ──
function decodeHtmlEntities(str: string): string {
  return str.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
}
function extractXmlTag(xml: string, tag: string): string | null {
  const decoded = decodeHtmlEntities(xml);
  const match = decoded.match(new RegExp(`<(?:[^:>]*:)?${tag}[^>]*>([\\s\\S]*?)<\/(?:[^:>]*:)?${tag}>`, 's'));
  return match ? match[1].trim() : null;
}
function extractExactTag(xml: string, tag: string): string | null {
  const decoded = decodeHtmlEntities(xml);
  const match = decoded.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim() : null;
}

// ── Config multi-tenant (por sucursal con fallback a empresa) ──
// sucursal_id NULL en facturacion_config = config de la empresa. Si el pedido es de
// una sucursal con fila propia (franquicia con su CUIT/cert), se usa esa; si no, la
// de la empresa. `scope_sucursal` marca con qué fila se resolvió (para el cache WSAA).
interface FactConfig {
  empresa_id: string; cuit: string; razon_social: string;
  condicion_fiscal: 'monotributo' | 'ri'; punto_venta: number;
  cert_pem: string | null; key_pem: string | null;
  ambiente: 'homologacion' | 'produccion'; activo: boolean;
  scope_sucursal: string | null;
}
const SELECT_CFG = 'empresa_id, sucursal_id, cuit, razon_social, condicion_fiscal, punto_venta, cert_pem, key_pem, ambiente, activo';
async function getConfig(empresaId: string, sucursalId?: string | null): Promise<FactConfig> {
  let data: Record<string, unknown> | null = null;
  if (sucursalId) {
    const r = await supabase.from('facturacion_config')
      .select(SELECT_CFG).eq('empresa_id', empresaId).eq('sucursal_id', sucursalId).maybeSingle();
    data = r.data;
  }
  if (!data) {
    const r = await supabase.from('facturacion_config')
      .select(SELECT_CFG).eq('empresa_id', empresaId).is('sucursal_id', null).maybeSingle();
    data = r.data;
  }
  if (!data) throw new Error('Sin facturacion_config para la empresa/sucursal');
  if (!data.cert_pem || !data.key_pem) throw new Error('Certificado no cargado');
  return { ...(data as object), scope_sucursal: (data.sucursal_id as string | null) ?? null } as FactConfig;
}

// ── WSAA: firma CMS del TRA con cert/key PEM (node-forge) ──
async function signTRA(tra: string, certPem: string, keyPem: string): Promise<string> {
  const forgeModule = await import('npm:node-forge@1.3.1');
  const forge = forgeModule.default ?? forgeModule;
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key, certificate: cert,
    digestAlgorithm: forge.pki.oids.sha1,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

function formatARCADate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}
function buildTRA(): string {
  const now = new Date();
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(now.getTime()/1000)}</uniqueId>
    <generationTime>${formatARCADate(new Date(now.getTime()-10*60*1000))}</generationTime>
    <expirationTime>${formatARCADate(new Date(now.getTime()+10*60*1000))}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
}

async function getARCAToken(cfg: FactConfig): Promise<{ token: string; sign: string }> {
  let q = supabase.from('arca_tokens')
    .select('token, sign, expira_at')
    .eq('empresa_id', cfg.empresa_id).eq('ambiente', cfg.ambiente);
  q = cfg.scope_sucursal ? q.eq('sucursal_id', cfg.scope_sucursal) : q.is('sucursal_id', null);
  const { data: cached } = await q.maybeSingle();
  if (cached && new Date(cached.expira_at) > new Date(Date.now()+5*60*1000)) {
    console.log('Token desde cache'); return { token: cached.token, sign: cached.sign };
  }
  const cms = await signTRA(buildTRA(), cfg.cert_pem!, cfg.key_pem!);
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov.ar">
  <soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body>
</soapenv:Envelope>`;
  const resp = await fetch(URLS[cfg.ambiente].wsaa, { method:'POST', headers:{'Content-Type':'text/xml; charset=utf-8','SOAPAction':'""'}, body:soap });
  const rawXml = await resp.text();
  console.log('WSAA status:', resp.status, rawXml.slice(0,600));
  if (!resp.ok) throw new Error(`WSAA HTTP ${resp.status}: ${rawXml.slice(0,400)}`);
  const returnMatch = rawXml.match(/<loginCmsReturn[^>]*>([\s\S]*?)<\/loginCmsReturn>/);
  if (!returnMatch) throw new Error(`Sin loginCmsReturn. XML: ${rawXml.slice(0,400)}`);
  const innerXml = decodeHtmlEntities(returnMatch[1]);
  const token = extractXmlTag(innerXml, 'token');
  const sign  = extractXmlTag(innerXml, 'sign');
  const expTime = extractXmlTag(innerXml, 'expirationTime');
  if (!token || !sign) throw new Error(`Sin token/sign: ${innerXml.slice(0,300)}`);
  const expiraAt = expTime ? new Date(expTime).toISOString() : new Date(Date.now()+11*3600*1000).toISOString();
  await supabase.from('arca_tokens').upsert(
    { empresa_id: cfg.empresa_id, ambiente: cfg.ambiente, sucursal_id: cfg.scope_sucursal, token, sign, expira_at: expiraAt, updated_at: new Date().toISOString() },
    { onConflict: 'empresa_id,ambiente,sucursal_id' });
  console.log('Token OK, expira:', expiraAt);
  return { token, sign };
}

// ── WSFE ──
async function wsfeCall(cfg: FactConfig, action: string, body: string): Promise<string> {
  const resp = await fetch(URLS[cfg.ambiente].wsfe, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': `"${WSFE_NS}${action}"` },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${WSFE_NS}">
  <soapenv:Header/><soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`,
  });
  const xml = await resp.text();
  console.log(`${action} response:`, xml.slice(0,500));
  return xml;
}

function authXml(cfg: FactConfig, token: string, sign: string) {
  return `<ar:Auth><ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cfg.cuit}</ar:Cuit></ar:Auth>`;
}

async function ultimoNroCbte(cfg: FactConfig, token: string, sign: string, tipoCbte: number): Promise<number> {
  const xml = await wsfeCall(cfg, 'FECompUltimoAutorizado',
    `<ar:FECompUltimoAutorizado>
      ${authXml(cfg, token, sign)}
      <ar:PtoVta>${cfg.punto_venta}</ar:PtoVta><ar:CbteTipo>${tipoCbte}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>`);
  const errs = decodeHtmlEntities(xml).match(/<Msg>([\s\S]*?)<\/Msg>/g)?.map(m=>m.replace(/<\/?Msg>/g,'')).join(' | ');
  const nro = extractXmlTag(xml, 'CbteNro');
  if (nro === null) throw new Error(`FECompUltimoAutorizado sin CbteNro${errs ? `: ${errs}` : ''}`);
  return parseInt(nro);
}

async function consultarComprobante(cfg: FactConfig, token: string, sign: string, tipoCbte: number, nro: number) {
  const xml = await wsfeCall(cfg, 'FECompConsultar',
    `<ar:FECompConsultar>
      ${authXml(cfg, token, sign)}
      <ar:FeCompConsReq>
        <ar:CbteTipo>${tipoCbte}</ar:CbteTipo>
        <ar:CbteNro>${nro}</ar:CbteNro>
        <ar:PtoVta>${cfg.punto_venta}</ar:PtoVta>
      </ar:FeCompConsReq>
    </ar:FECompConsultar>`);
  const err = extractExactTag(xml, 'Msg');
  const fch = extractExactTag(xml, 'CbteFch');
  if (!fch) return { existe: false as const, error: err ?? 'Sin datos' };
  const fmt = (d: string|null) => d && d.length===8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : d;
  return {
    existe: true as const,
    tipo_cbte: tipoCbte, punto_venta: cfg.punto_venta, nro,
    fecha: fmt(fch),
    imp_total: extractExactTag(xml, 'ImpTotal'),
    cae: extractExactTag(xml, 'CodAutorizacion'),
    cae_vto: fmt(extractExactTag(xml, 'FchVto')),
    resultado: extractExactTag(xml, 'Resultado'),
  };
}

interface CbteAsoc { tipo: number; ptoVta: number; nro: number }

async function solicitarCAE(cfg: FactConfig, token: string, sign: string, p: {
  tipoCbte: number; impTotal: number; docTipo: number; docNro: string; condIvaReceptor: number; cbteAsoc?: CbteAsoc;
}, nro: number) {
  const fecha = new Date().toISOString().slice(0,10).replace(/-/g,'');
  // Factura C (monotributo): TODO el importe va en ImpNeto, sin IVA ni OpEx.
  // (En RI exento iría en ImpOpEx — lógica de Piamonte que acá NO aplica.)
  // NC tipo 13: mismo esquema de importes + bloque CbtesAsoc con la factura original.
  const cbtesAsocXml = p.cbteAsoc
    ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${p.cbteAsoc.tipo}</ar:Tipo><ar:PtoVta>${p.cbteAsoc.ptoVta}</ar:PtoVta><ar:Nro>${p.cbteAsoc.nro}</ar:Nro></ar:CbteAsoc></ar:CbtesAsoc>`
    : '';
  const xml = await wsfeCall(cfg, 'FECAESolicitar',
    `<ar:FECAESolicitar>
      ${authXml(cfg, token, sign)}
      <ar:FeCAEReq>
        <ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${cfg.punto_venta}</ar:PtoVta><ar:CbteTipo>${p.tipoCbte}</ar:CbteTipo></ar:FeCabReq>
        <ar:FeDetReq><ar:FECAEDetRequest>
          <ar:Concepto>1</ar:Concepto>
          <ar:DocTipo>${p.docTipo}</ar:DocTipo><ar:DocNro>${p.docNro}</ar:DocNro>
          <ar:CbteDesde>${nro}</ar:CbteDesde><ar:CbteHasta>${nro}</ar:CbteHasta>
          <ar:CbteFch>${fecha}</ar:CbteFch>
          <ar:ImpTotal>${p.impTotal.toFixed(2)}</ar:ImpTotal>
          <ar:ImpTotConc>0.00</ar:ImpTotConc>
          <ar:ImpNeto>${p.impTotal.toFixed(2)}</ar:ImpNeto>
          <ar:ImpOpEx>0.00</ar:ImpOpEx>
          <ar:ImpIVA>0.00</ar:ImpIVA>
          <ar:ImpTrib>0.00</ar:ImpTrib>
          <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>
          ${cbtesAsocXml}
          <ar:CondicionIVAReceptorId>${p.condIvaReceptor}</ar:CondicionIVAReceptorId>
        </ar:FECAEDetRequest></ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>`);
  if (extractXmlTag(xml,'Resultado')==='R') {
    const errs = decodeHtmlEntities(xml).match(/<Msg>([\s\S]*?)<\/Msg>/g)?.map(m=>m.replace(/<\/?Msg>/g,'')).join(' | ');
    throw new Error(`WSFE rechazó: ${errs ?? xml.slice(0,300)}`);
  }
  const cae = extractXmlTag(xml,'CAE');
  if (!cae) throw new Error(`Sin CAE. XML: ${xml.slice(0,400)}`);
  const vto = extractXmlTag(xml,'CAEFchVto')??'';
  return { cae, caeVencimiento: vto?`${vto.slice(0,4)}-${vto.slice(4,6)}-${vto.slice(6,8)}`:'', nroCbte:nro };
}

// ═══════════════ Handler ═══════════════
interface BodyParams {
  empresa_id: string;
  sucursal_id?: string;       // test/consultar: probar la config de una sucursal puntual
  accion?: 'facturar' | 'consultar' | 'test' | 'nota_credito';
  pedido_id?: string;         // facturar / nota_credito
  tipoCbte?: number;          // consultar (default 11)
  nro?: number;               // consultar
  docTipo?: number;           // opcional: 96=DNI, 80=CUIT (default 99)
  docNro?: string;
  condIvaReceptor?: number;   // default 5 (consumidor final)
  motivo?: string;            // nota_credito: se guarda en facturas.error_msg? no — en detalle del log
}

Deno.serve(async (req: Request) => {
  if (req.method==='OPTIONS') return new Response(null,{headers:CORS});
  if (req.method!=='POST') return json({error:'Metodo no permitido'},405);
  let p: BodyParams;
  try { p = await req.json(); } catch { return json({error:'JSON invalido'},400); }
  if (!p.empresa_id) return json({error:'empresa_id requerido'},400);

  // Para facturar/nota_credito la sucursal sale del PEDIDO; para test/consultar,
  // del body (opcional). Config: fila de la sucursal si existe, si no la de la empresa.
  let sucursalPedido: string | null = null;
  if ((p.accion === undefined || p.accion === 'facturar' || p.accion === 'nota_credito') && p.pedido_id) {
    const { data: ped } = await supabase.from('pedidos')
      .select('sucursal_id').eq('id', p.pedido_id).eq('empresa_id', p.empresa_id).maybeSingle();
    sucursalPedido = (ped?.sucursal_id as string | null) ?? null;
  }
  let cfg: FactConfig;
  try { cfg = await getConfig(p.empresa_id, sucursalPedido ?? p.sucursal_id ?? null); }
  catch(err) { return json({ok:false,error:err instanceof Error?err.message:String(err)},400); }

  // ── TEST: valida config + WSAA + consulta numeración (no emite nada) ──
  if (p.accion === 'test') {
    try {
      const {token,sign} = await getARCAToken(cfg);
      const ultimo = await ultimoNroCbte(cfg, token, sign, 11);
      return json({ok:true, ambiente:cfg.ambiente, cuit:cfg.cuit, punto_venta:cfg.punto_venta,
        ultimo_cbte_tipo11: ultimo, mensaje:'WSAA y WSFE responden OK'});
    } catch(err) {
      return json({ok:false,error:err instanceof Error?err.message:String(err)},500);
    }
  }

  // ── CONSULTAR: recuperar un comprobante ya autorizado ──
  if (p.accion === 'consultar') {
    if (!p.nro) return json({error:'consultar requiere nro'},400);
    try {
      const {token,sign} = await getARCAToken(cfg);
      const info = await consultarComprobante(cfg, token, sign, p.tipoCbte ?? 11, p.nro);
      return json({ok:true, ...info});
    } catch(err) {
      return json({ok:false,error:err instanceof Error?err.message:String(err)},500);
    }
  }

  // ── NOTA DE CRÉDITO: NC C (tipo 13) sobre la factura emitida del pedido ──
  if (p.accion === 'nota_credito') {
    if (!p.pedido_id) return json({error:'pedido_id requerido'},400);

    const { data: fOriginal } = await supabase.from('facturas')
      .select('id, tipo_cbte, punto_venta, nro_cbte, total, doc_tipo, doc_nro, cond_iva_receptor')
      .eq('pedido_id', p.pedido_id).eq('empresa_id', p.empresa_id)
      .eq('estado','emitida').eq('tipo_cbte', 11).maybeSingle();
    if (!fOriginal || !fOriginal.nro_cbte) return json({ok:false,error:'El pedido no tiene factura emitida para anular'},404);

    const { data: ncPrevia } = await supabase.from('facturas')
      .select('id, nro_cbte, cae').eq('pedido_id', p.pedido_id).eq('estado','emitida').eq('tipo_cbte', 13).maybeSingle();
    if (ncPrevia) return json({ok:false,error:'El pedido ya tiene nota de crédito emitida',nota_credito:ncPrevia},409);

    const tipoCbte = 13;
    const docTipo = fOriginal.doc_tipo ?? 99;
    const docNro = fOriginal.doc_nro ?? '0';
    const condIva = fOriginal.cond_iva_receptor ?? 5;
    const impTotal = Number(fOriginal.total);
    const cbteAsoc: CbteAsoc = { tipo: fOriginal.tipo_cbte, ptoVta: fOriginal.punto_venta, nro: fOriginal.nro_cbte };

    const { data: fRow, error: insertErr } = await supabase.from('facturas')
      .insert({ empresa_id: p.empresa_id, pedido_id: p.pedido_id, tipo_cbte: tipoCbte,
        sucursal_id: sucursalPedido,
        punto_venta: cfg.punto_venta, total: impTotal, doc_tipo: docTipo, doc_nro: docNro,
        cond_iva_receptor: condIva, ambiente: cfg.ambiente, estado: 'pendiente' })
      .select('id').single();
    if (insertErr || !fRow) return json({error:'Error DB',detail:insertErr?.message},500);

    try {
      const {token,sign} = await getARCAToken(cfg);
      const ultimo = await ultimoNroCbte(cfg, token, sign, tipoCbte);
      let resultado;
      try {
        resultado = await solicitarCAE(cfg, token, sign, {tipoCbte, impTotal, docTipo, docNro, condIvaReceptor: condIva, cbteAsoc}, ultimo+1);
      } catch(errCAE) {
        const msgCAE = errCAE instanceof Error ? errCAE.message : String(errCAE);
        if (msgCAE.startsWith('WSFE rechazó')) throw errCAE;
        // BLINDAJE ANTI-TIMEOUT (mismo esquema que facturar)
        console.log('Error de CAE (NC), verificando si ARCA autorizó igual:', msgCAE);
        try {
          const nuevoUltimo = await ultimoNroCbte(cfg, token, sign, tipoCbte);
          if (nuevoUltimo === ultimo + 1) {
            const info = await consultarComprobante(cfg, token, sign, tipoCbte, nuevoUltimo);
            if (info.existe && Math.abs(parseFloat(info.imp_total||'0') - impTotal) < 0.01) {
              console.log('RECUPERADA: ARCA la había autorizado. CAE:', info.cae);
              resultado = { cae: info.cae!, caeVencimiento: info.cae_vto||'', nroCbte: nuevoUltimo };
            }
          }
        } catch(errRec) { console.error('Recuperación falló:', errRec); }
        if (!resultado) throw errCAE;
      }
      const {cae, caeVencimiento, nroCbte} = resultado;
      // ORDEN IMPORTANTE (aprendido 01/09, NC nro 1): primero anular la original y recién
      // después marcar la NC como emitida — el índice único idx_facturas_pedido_emitida
      // (una emitida por pedido) rechaza el orden inverso y la NC quedaría Pendiente
      // con el CAE ya otorgado por ARCA. El estado 'anulada' requiere el check ampliado.
      await supabase.from('facturas').update({ estado: 'anulada' }).eq('id', fOriginal.id);
      await supabase.from('facturas')
        .update({ cae, cae_vencimiento: caeVencimiento || null, nro_cbte: nroCbte, estado: 'emitida' })
        .eq('id', fRow.id);
      return json({ok:true, cae, cae_vencimiento: caeVencimiento, nro_cbte: nroCbte,
        punto_venta: cfg.punto_venta, tipo_cbte: tipoCbte, ambiente: cfg.ambiente,
        factura_anulada: { tipo_cbte: fOriginal.tipo_cbte, punto_venta: fOriginal.punto_venta, nro_cbte: fOriginal.nro_cbte }});
    } catch(err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Error NC:', msg);
      await supabase.from('facturas').update({ estado:'error', error_msg: msg }).eq('id', fRow.id);
      return json({ok:false, error: msg}, 500);
    }
  }

  // ── FACTURAR (default) ──
  if (!p.pedido_id) return json({error:'pedido_id requerido'},400);
  if (!cfg.activo) return json({ok:false,error:'Facturación inactiva para la empresa'},400);

  // Pedido: debe existir, ser de la empresa, transferencia, y no estar facturado
  const { data: pedido } = await supabase.from('pedidos')
    .select('id, empresa_id, total, metodo_pago, numero_pedido')
    .eq('id', p.pedido_id).eq('empresa_id', p.empresa_id).single();
  if (!pedido) return json({ok:false,error:'Pedido no encontrado'},404);
  // El filtro por método de pago vive en /api/facturacion/emitir (metodos_auto del cliente);
  // la Edge emite cualquier pedido válido — permite facturación manual a futuro.
  const { data: yaFacturada } = await supabase.from('facturas')
    .select('id, nro_cbte, cae').eq('pedido_id', p.pedido_id).eq('estado','emitida').maybeSingle();
  if (yaFacturada) return json({ok:false,error:'Pedido ya facturado',factura:yaFacturada},409);

  const tipoCbte = 11; // Factura C
  const docTipo = p.docTipo ?? 99;
  const docNro = p.docNro ?? '0';
  const condIva = p.condIvaReceptor ?? 5;
  const impTotal = Number(pedido.total);

  const { data: fRow, error: insertErr } = await supabase.from('facturas')
    .insert({ empresa_id: p.empresa_id, pedido_id: p.pedido_id, tipo_cbte: tipoCbte,
      sucursal_id: sucursalPedido,
      punto_venta: cfg.punto_venta, total: impTotal, doc_tipo: docTipo, doc_nro: docNro,
      cond_iva_receptor: condIva, ambiente: cfg.ambiente, estado: 'pendiente' })
    .select('id').single();
  if (insertErr || !fRow) return json({error:'Error DB',detail:insertErr?.message},500);

  try {
    const {token,sign} = await getARCAToken(cfg);
    const ultimo = await ultimoNroCbte(cfg, token, sign, tipoCbte);
    let resultado;
    try {
      resultado = await solicitarCAE(cfg, token, sign, {tipoCbte, impTotal, docTipo, docNro, condIvaReceptor: condIva}, ultimo+1);
    } catch(errCAE) {
      const msgCAE = errCAE instanceof Error ? errCAE.message : String(errCAE);
      if (msgCAE.startsWith('WSFE rechazó')) throw errCAE;
      // BLINDAJE ANTI-TIMEOUT (heredado de Piamonte, caso FA-73):
      // error de red ≠ no autorizada. Verificar si ARCA avanzó la numeración.
      console.log('Error de CAE, verificando si ARCA autorizó igual:', msgCAE);
      try {
        const nuevoUltimo = await ultimoNroCbte(cfg, token, sign, tipoCbte);
        if (nuevoUltimo === ultimo + 1) {
          const info = await consultarComprobante(cfg, token, sign, tipoCbte, nuevoUltimo);
          if (info.existe && Math.abs(parseFloat(info.imp_total||'0') - impTotal) < 0.01) {
            console.log('RECUPERADA: ARCA la había autorizado. CAE:', info.cae);
            resultado = { cae: info.cae!, caeVencimiento: info.cae_vto||'', nroCbte: nuevoUltimo };
          }
        }
      } catch(errRec) { console.error('Recuperación falló:', errRec); }
      if (!resultado) throw errCAE;
    }
    const {cae, caeVencimiento, nroCbte} = resultado;
    await supabase.from('facturas')
      .update({ cae, cae_vencimiento: caeVencimiento || null, nro_cbte: nroCbte, estado: 'emitida' })
      .eq('id', fRow.id);
    return json({ok:true, cae, cae_vencimiento: caeVencimiento, nro_cbte: nroCbte,
      punto_venta: cfg.punto_venta, tipo_cbte: tipoCbte, ambiente: cfg.ambiente});
  } catch(err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error:', msg);
    await supabase.from('facturas').update({ estado:'error', error_msg: msg }).eq('id', fRow.id);
    return json({ok:false, error: msg}, 500);
  }
});