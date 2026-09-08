// ═══════════════════════════════════════════════════════════════════
// arca-facturar — Edge Function ConeOS (multi-tenant) — FA-2
// Historial: adaptada de Piamonte (C monotributo); FA-1 sumó receptor por
// parámetros; FA-2 agrega Factura A/B + IVA 21% + NC por tipo, TODO detrás
// del flag facturacion_config.emite_factura_a (DEFAULT false).
// REGLA DE ORO FA-2: con flag OFF (o emisor monotributo) la rama C conserva
// el comportamiento y el XML ACTUALES — sin AlicIva, ImpNeto=total, ImpIVA=0.
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

// ═══════════════ FA-2: LÓGICA FISCAL PURA (testeable, sin I/O) ═══════════════
// Tipos: 1=Factura A, 6=Factura B, 11=Factura C, 3=NC A, 8=NC B, 13=NC C.
// Condiciones IVA receptor (códigos ARCA): 1=RI, 4=Exento, 5=Cons. Final, 6=Monotributo.

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// IVA por RESTA: neto + iva === total, centavo a centavo. Solo 21% en FA-2.
export function calcularImportes(tipoCbte: number, total: number): { neto: number; iva: number; conIva: boolean } {
  const t = round2(total);
  const conIva = tipoCbte === 1 || tipoCbte === 6 || tipoCbte === 3 || tipoCbte === 8;
  if (!conIva) return { neto: t, iva: 0, conIva: false };
  const neto = round2(t / 1.21);
  const iva = round2(t - neto);
  return { neto, iva, conIva: true };
}

// Determinación centralizada del tipo. SIN rubro, SIN duplicación de reglas.
// Factura: mono o flag OFF → 11. RI+flag ON: receptor RI(1)/Monotributo(6) → A(1)
// [Ley 27.618]; CF(5)/Exento(4) → B(6). NC: derivada de la original 11→13, 1→3, 6→8.
export function determinarTipoCbte(
  condicionEmisor: 'monotributo' | 'ri',
  emiteFacturaA: boolean,
  condicionReceptor: number,
  esNC: boolean,
  tipoOriginal?: number,
): number {
  if (esNC) {
    if (tipoOriginal === 1) return 3;
    if (tipoOriginal === 6) return 8;
    return 13;
  }
  if (condicionEmisor !== 'ri' || !emiteFacturaA) return 11;
  return (condicionReceptor === 1 || condicionReceptor === 6) ? 1 : 6;
}

// Coherencia de configuración: la Edge es la AUTORIDAD FINAL (la UI puede
// fallar o la config editarse por SQL — acá se corta antes de llamar a ARCA).
export function validarCoherencia(cfg: { condicion_fiscal: string; emite_factura_a: boolean }): string | null {
  if (cfg.emite_factura_a && cfg.condicion_fiscal !== 'ri') {
    return 'Configuración fiscal incoherente: emite_factura_a requiere condicion_fiscal = ri';
  }
  return null;
}

export function cuitValido(cuit: string): boolean {
  const d = (cuit ?? '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = mult.reduce((a, m, i) => a + m * Number(d[i]), 0);
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return dv === Number(d[10]);
}
// ═══════════════ fin lógica pura ═══════════════

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
interface FactConfig {
  empresa_id: string; cuit: string; razon_social: string;
  condicion_fiscal: 'monotributo' | 'ri'; punto_venta: number;
  cert_pem: string | null; key_pem: string | null;
  ambiente: 'homologacion' | 'produccion'; activo: boolean;
  emite_factura_a: boolean;
  scope_sucursal: string | null;
}
const SELECT_CFG = 'empresa_id, sucursal_id, cuit, razon_social, condicion_fiscal, punto_venta, cert_pem, key_pem, ambiente, activo, emite_factura_a';
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
  return { ...(data as object), emite_factura_a: !!data.emite_factura_a, scope_sucursal: (data.sucursal_id as string | null) ?? null } as FactConfig;
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

// FA-2: orden del XML en A/B validado contra la Edge de PIAMONTE en producción
// (Factura A con CAE real): CondicionIVAReceptorId ANTES del bloque Iva, y
// CbtesAsoc DESPUÉS de Iva — el schema SOAP de WSFE es posicional. La rama C
// conserva SU orden histórico propio (CbtesAsoc antes de CondIVA), también
// con CAEs reales (facturas 115/116 de Federal por esta misma Edge).
// solicitarCAE recibe los importes YA calculados (calcularImportes es la
// única fuente). Rama C (conIva=false): XML idéntico al histórico — ImpNeto =
// total, ImpIVA = 0.00, SIN bloque Iva. Rama A/B (conIva=true): ImpNeto = neto,
// ImpIVA = iva + bloque AlicIva Id 5 (21%).
async function solicitarCAE(cfg: FactConfig, token: string, sign: string, p: {
  tipoCbte: number; impTotal: number; neto: number; iva: number; conIva: boolean;
  docTipo: number; docNro: string; condIvaReceptor: number; cbteAsoc?: CbteAsoc;
}, nro: number) {
  const fecha = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const cbtesAsocXml = p.cbteAsoc
    ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${p.cbteAsoc.tipo}</ar:Tipo><ar:PtoVta>${p.cbteAsoc.ptoVta}</ar:PtoVta><ar:Nro>${p.cbteAsoc.nro}</ar:Nro></ar:CbteAsoc></ar:CbtesAsoc>`
    : '';
  const impNetoStr = p.conIva ? p.neto.toFixed(2) : p.impTotal.toFixed(2);
  const impIvaStr = p.conIva ? p.iva.toFixed(2) : '0.00';
  const ivaXml = p.conIva
    ? `<ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>${p.neto.toFixed(2)}</ar:BaseImp><ar:Importe>${p.iva.toFixed(2)}</ar:Importe></ar:AlicIva></ar:Iva>`
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
          <ar:ImpNeto>${impNetoStr}</ar:ImpNeto>
          <ar:ImpOpEx>0.00</ar:ImpOpEx>
          <ar:ImpIVA>${impIvaStr}</ar:ImpIVA>
          <ar:ImpTrib>0.00</ar:ImpTrib>
          <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>
          ${p.conIva
            ? `<ar:CondicionIVAReceptorId>${p.condIvaReceptor}</ar:CondicionIVAReceptorId>
          ${ivaXml}
          ${cbtesAsocXml}`
            : `${cbtesAsocXml}
          <ar:CondicionIVAReceptorId>${p.condIvaReceptor}</ar:CondicionIVAReceptorId>`}
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
  sucursal_id?: string;
  accion?: 'facturar' | 'consultar' | 'test' | 'nota_credito';
  pedido_id?: string;
  tipoCbte?: number;
  nro?: number;
  docTipo?: number;
  docNro?: string;
  condIvaReceptor?: number;
  motivo?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method==='OPTIONS') return new Response(null,{headers:CORS});
  if (req.method!=='POST') return json({error:'Metodo no permitido'},405);
  let p: BodyParams;
  try { p = await req.json(); } catch { return json({error:'JSON invalido'},400); }
  if (!p.empresa_id) return json({error:'empresa_id requerido'},400);

  let sucursalPedido: string | null = null;
  if ((p.accion === undefined || p.accion === 'facturar' || p.accion === 'nota_credito') && p.pedido_id) {
    const { data: ped } = await supabase.from('pedidos')
      .select('sucursal_id').eq('id', p.pedido_id).eq('empresa_id', p.empresa_id).maybeSingle();
    sucursalPedido = (ped?.sucursal_id as string | null) ?? null;
  }
  let cfg: FactConfig;
  try { cfg = await getConfig(p.empresa_id, sucursalPedido ?? p.sucursal_id ?? null); }
  catch(err) { return json({ok:false,error:err instanceof Error?err.message:String(err)},400); }

  // FA-2: coherencia de configuración — autoridad final, antes de cualquier
  // llamada a ARCA, para TODAS las acciones que emiten.
  const errCoherencia = validarCoherencia(cfg);
  if (errCoherencia && (p.accion === undefined || p.accion === 'facturar' || p.accion === 'nota_credito')) {
    return json({ ok: false, error: errCoherencia }, 400);
  }

  // ── TEST: valida config + WSAA + consulta numeración (no emite nada) ──
  if (p.accion === 'test') {
    try {
      const {token,sign} = await getARCAToken(cfg);
      const ultimo = await ultimoNroCbte(cfg, token, sign, 11);
      return json({ok:true, ambiente:cfg.ambiente, cuit:cfg.cuit, punto_venta:cfg.punto_venta,
        emite_factura_a: cfg.emite_factura_a, condicion_fiscal: cfg.condicion_fiscal,
        coherencia: errCoherencia ?? 'OK',
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

  // ── NOTA DE CRÉDITO: NC derivada de la factura emitida del pedido ──
  if (p.accion === 'nota_credito') {
    if (!p.pedido_id) return json({error:'pedido_id requerido'},400);

    // FA-2: buscar la factura emitida SIN hardcode de tipo (antes: eq 11 — una
    // Factura A jamás encontraba su original). Solo tipos de FACTURA (1/6/11).
    const { data: fOriginal } = await supabase.from('facturas')
      .select('id, tipo_cbte, punto_venta, nro_cbte, total, doc_tipo, doc_nro, cond_iva_receptor, imp_neto, imp_iva')
      .eq('pedido_id', p.pedido_id).eq('empresa_id', p.empresa_id)
      .eq('estado','emitida').in('tipo_cbte', [1, 6, 11]).maybeSingle();
    if (!fOriginal || !fOriginal.nro_cbte) return json({ok:false,error:'El pedido no tiene factura emitida para anular'},404);

    const tipoCbte = determinarTipoCbte(cfg.condicion_fiscal, cfg.emite_factura_a, fOriginal.cond_iva_receptor ?? 5, true, fOriginal.tipo_cbte);

    const { data: ncPrevia } = await supabase.from('facturas')
      .select('id, nro_cbte, cae').eq('pedido_id', p.pedido_id).eq('estado','emitida').in('tipo_cbte', [3, 8, 13]).maybeSingle();
    if (ncPrevia) return json({ok:false,error:'El pedido ya tiene nota de crédito emitida',nota_credito:ncPrevia},409);

    const docTipo = fOriginal.doc_tipo ?? 99;
    const docNro = fOriginal.doc_nro ?? '0';
    const condIva = fOriginal.cond_iva_receptor ?? 5;
    const impTotal = Number(fOriginal.total);
    // NC con el MISMO esquema de importes que su original (A/B con IVA, C sin)
    const importes = calcularImportes(tipoCbte, impTotal);
    const cbteAsoc: CbteAsoc = { tipo: fOriginal.tipo_cbte, ptoVta: fOriginal.punto_venta, nro: fOriginal.nro_cbte };

    const { data: fRow, error: insertErr } = await supabase.from('facturas')
      .insert({ empresa_id: p.empresa_id, pedido_id: p.pedido_id, tipo_cbte: tipoCbte,
        sucursal_id: sucursalPedido,
        punto_venta: cfg.punto_venta, total: impTotal, doc_tipo: docTipo, doc_nro: docNro,
        cond_iva_receptor: condIva, ambiente: cfg.ambiente, estado: 'pendiente',
        imp_neto: importes.conIva ? importes.neto : null,
        imp_iva: importes.conIva ? importes.iva : null })
      .select('id').single();
    if (insertErr || !fRow) return json({error:'Error DB',detail:insertErr?.message},500);

    try {
      const {token,sign} = await getARCAToken(cfg);
      const ultimo = await ultimoNroCbte(cfg, token, sign, tipoCbte);
      let resultado;
      try {
        resultado = await solicitarCAE(cfg, token, sign, {tipoCbte, impTotal, ...importes, docTipo, docNro, condIvaReceptor: condIva, cbteAsoc}, ultimo+1);
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
      // (una emitida por pedido) rechaza el orden inverso.
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

  const { data: pedido } = await supabase.from('pedidos')
    .select('id, empresa_id, total, metodo_pago, numero_pedido')
    .eq('id', p.pedido_id).eq('empresa_id', p.empresa_id).single();
  if (!pedido) return json({ok:false,error:'Pedido no encontrado'},404);
  const { data: yaFacturada } = await supabase.from('facturas')
    .select('id, nro_cbte, cae').eq('pedido_id', p.pedido_id).eq('estado','emitida').maybeSingle();
  if (yaFacturada) return json({ok:false,error:'Pedido ya facturado',factura:yaFacturada},409);

  const docTipo = p.docTipo ?? 99;
  const docNro = p.docNro ?? '0';
  const condIva = p.condIvaReceptor ?? 5;
  const impTotal = Number(pedido.total);

  // FA-2: tipo por regla centralizada (mono o flag OFF → 11; RI+flag: A/B)
  const tipoCbte = determinarTipoCbte(cfg.condicion_fiscal, cfg.emite_factura_a, condIva, false);

  // Factura A exige receptor identificado con CUIT válido (RI o Monotributo).
  // Rechazo LOCAL: sin consumir numeración ni llamar a ARCA.
  if (tipoCbte === 1) {
    if (docTipo !== 80 || !cuitValido(docNro)) {
      return json({ok:false,error:'Factura A requiere CUIT válido del receptor (docTipo 80)'},400);
    }
    if (condIva !== 1 && condIva !== 6) {
      return json({ok:false,error:'Factura A requiere receptor RI o Monotributo'},400);
    }
  }

  const importes = calcularImportes(tipoCbte, impTotal);

  const { data: fRow, error: insertErr } = await supabase.from('facturas')
    .insert({ empresa_id: p.empresa_id, pedido_id: p.pedido_id, tipo_cbte: tipoCbte,
      sucursal_id: sucursalPedido,
      punto_venta: cfg.punto_venta, total: impTotal, doc_tipo: docTipo, doc_nro: docNro,
      cond_iva_receptor: condIva, ambiente: cfg.ambiente, estado: 'pendiente',
      imp_neto: importes.conIva ? importes.neto : null,
      imp_iva: importes.conIva ? importes.iva : null })
    .select('id').single();
  if (insertErr || !fRow) return json({error:'Error DB',detail:insertErr?.message},500);

  try {
    const {token,sign} = await getARCAToken(cfg);
    const ultimo = await ultimoNroCbte(cfg, token, sign, tipoCbte);
    let resultado;
    try {
      resultado = await solicitarCAE(cfg, token, sign, {tipoCbte, impTotal, ...importes, docTipo, docNro, condIvaReceptor: condIva}, ultimo+1);
    } catch(errCAE) {
      const msgCAE = errCAE instanceof Error ? errCAE.message : String(errCAE);
      if (msgCAE.startsWith('WSFE rechazó')) throw errCAE;
      // BLINDAJE ANTI-TIMEOUT (heredado de Piamonte, caso FA-73):
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
      punto_venta: cfg.punto_venta, tipo_cbte: tipoCbte, ambiente: cfg.ambiente,
      imp_neto: importes.conIva ? importes.neto : null, imp_iva: importes.conIva ? importes.iva : null});
  } catch(err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error:', msg);
    await supabase.from('facturas').update({ estado:'error', error_msg: msg }).eq('id', fRow.id);
    return json({ok:false, error: msg}, 500);
  }
});
