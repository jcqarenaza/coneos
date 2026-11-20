// Visor de comprobantes de Caja (preparación Fase D): tipo por ruta, tipo recibido, vencimiento del enlace y render real
// (renderToStaticMarkup) de imagen y PDF. Ejecutar: npx tsx --test src/lib/__tests__/comprobante-visor.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tipoVisorDeRuta, normalizarTipoVisor, enlaceVencido, MARGEN_RENOVACION_SEG, EXPIRA_FIRMA_POR_DEFECTO_SEG } from '../comprobante-visor'
import { firmarCapturaConTipo, firmarCaptura, TTL_URL_FIRMADA_SEG } from '../storage'
import VisorComprobante, { TEXTO_ABRIR_PDF } from '../../components/operacion/VisorComprobante'

const E = 'e0000000-0000-4000-8000-000000000001', P = '30000000-0000-4000-8000-000000000001'

describe('tipoVisorDeRuta', () => {
  test('pdf en cualquier combinación de mayúsculas → "pdf"', () => {
    for (const r of [`pedidos/${P}.pdf`, `${E}/pedidos/${P}.pdf`, `${E}/pedidos/${P}.PDF`, `${E}/pedidos/${P}.Pdf`]) assert.equal(tipoVisorDeRuta(r), 'pdf', r)
  })
  test('JPEG, PNG, WebP y cualquier otra extensión → "imagen" (comportamiento de siempre)', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'jfif', 'gif', 'heic', 'JPG', 'xyz']) assert.equal(tipoVisorDeRuta(`${E}/pedidos/${P}.${ext}`), 'imagen', ext)
  })
  test('nombres engañosos no son PDF: "pdf" en el medio o sin extensión', () => {
    for (const r of ['pedidos/x.pdf.png', 'pedidos/pdf', 'pedidos/archivo.pdfx', '', null, undefined]) assert.equal(tipoVisorDeRuta(r as string), 'imagen', String(r))
  })
})
describe('normalizarTipoVisor (lo que llega del servidor)', () => {
  test('solo "pdf" cambia el visor; ausente/nulo/desconocido = imagen', () => {
    assert.equal(normalizarTipoVisor('pdf'), 'pdf')
    for (const v of ['imagen', 'PDF', 'application/pdf', '', null, undefined, 1, {}, ['pdf']]) assert.equal(normalizarTipoVisor(v), 'imagen', String(v))
  })
})
describe('enlaceVencido (renovación de la firma de 600 s)', () => {
  const t0 = 1_000_000
  test('recién firmada → vigente; pasado el margen → hay que renovar', () => {
    assert.equal(enlaceVencido(t0, t0, 600), false)
    assert.equal(enlaceVencido(t0, t0 + 569_999, 600), false)
    assert.equal(enlaceVencido(t0, t0 + (600 - MARGEN_RENOVACION_SEG) * 1000, 600), true)   // exactamente en el margen
    assert.equal(enlaceVencido(t0, t0 + 600_000, 600), true)
    assert.equal(enlaceVencido(t0, t0 + 3_600_000, 600), true)
  })
  test('expiración ausente o inválida usa los 600 s por defecto; fechas inválidas renuevan', () => {
    assert.equal(EXPIRA_FIRMA_POR_DEFECTO_SEG, 600)
    for (const e of [undefined, null, 'x', NaN, 0, -5]) { assert.equal(enlaceVencido(t0, t0 + 100_000, e), false, String(e)); assert.equal(enlaceVencido(t0, t0 + 580_000, e), true, String(e)) }
    assert.equal(enlaceVencido(NaN, t0, 600), true); assert.equal(enlaceVencido(t0, NaN, 600), true)
  })
})
describe('VisorComprobante (render real)', () => {
  const URL_FIRMADA = 'https://x.supabase.co/storage/v1/object/sign/capturas/p.png?token=FIRMA'
  test('imagen: el mismo visor de siempre (<a><img>), sin enlace de PDF', () => {
    // React 19 antepone <link rel="preload" as="image"> al renderizar un <img>: no es parte del visor, se descarta para comparar su marcado.
    const html = renderToStaticMarkup(createElement(VisorComprobante, { url: URL_FIRMADA, tipo: 'imagen' })).replace(/^<link [^>]*>/, '')
    assert.match(html, /^<a href="[^"]+" target="_blank" rel="noopener noreferrer"><img src="[^"]+" alt="Comprobante"/)
    assert.match(html, /cursor-zoom-in/); assert.equal(html.includes(TEXTO_ABRIR_PDF), false)
  })
  test('pdf: enlace explícito con la URL firmada, en pestaña nueva, sin <img>', () => {
    const html = renderToStaticMarkup(createElement(VisorComprobante, { url: URL_FIRMADA, tipo: 'pdf' }))
    assert.equal(html.includes('<img'), false); assert.ok(html.includes(TEXTO_ABRIR_PDF))
    assert.ok(html.includes('href="https://x.supabase.co/storage/v1/object/sign/capturas/p.png?token=FIRMA"'))
    assert.ok(html.includes('target="_blank"')); assert.ok(html.includes('rel="noopener noreferrer"'))
    assert.match(html, /10 minutos/)
  })
  test('solo muestra la URL firmada que recibe: nunca una URL pública de Storage', () => {
    for (const tipo of ['imagen', 'pdf'] as const) assert.equal(renderToStaticMarkup(createElement(VisorComprobante, { url: URL_FIRMADA, tipo })).includes('/object/public/'), false)
  })
})
describe('firmarCapturaConTipo (cliente de Storage simulado)', () => {
  const pedido = (ext: string, empresa = E) => ({ id: P, empresa_id: empresa, captura_transferencia_url: `${empresa}/pedidos/${P}.${ext}` })
  const storage = (res: { data: { signedUrl: string } | null; error: { message: string } | null }, pedidas: { ruta: string; ttl: number }[] = []) => ({
    storage: { from: () => ({ createSignedUrl: async (ruta: string, ttl: number) => { pedidas.push({ ruta, ttl }); return res }, createSignedUrls: async () => ({ data: [], error: null }) }) },
  })
  test('PDF y PNG: devuelve url y tipo; firma con el TTL de 600 s', async () => {
    const pedidas: { ruta: string; ttl: number }[] = []
    const cli = storage({ data: { signedUrl: 'https://f/firmada' }, error: null }, pedidas) as never
    assert.deepEqual(await firmarCapturaConTipo(cli, pedido('pdf'), E), { url: 'https://f/firmada', tipo: 'pdf' })
    assert.deepEqual(await firmarCapturaConTipo(cli, pedido('png'), E), { url: 'https://f/firmada', tipo: 'imagen' })
    assert.deepEqual(pedidas.map(p => p.ttl), [600, 600]); assert.equal(TTL_URL_FIRMADA_SEG, 600)
  })
  test('error de firma → null (sin url ni tipo); firmarCaptura sigue devolviendo solo la URL', async () => {
    const mal = storage({ data: null, error: { message: 'boom' } }) as never
    assert.equal(await firmarCapturaConTipo(mal, pedido('pdf'), E), null)
    assert.equal(await firmarCaptura(mal, pedido('pdf'), E), null)
    const bien = storage({ data: { signedUrl: 'https://f/firmada' }, error: null }) as never
    assert.equal(await firmarCaptura(bien, pedido('pdf'), E), 'https://f/firmada')
  })
  test('empresa distinta o ruta ajena → null y NO se pide firma', async () => {
    const pedidas: { ruta: string; ttl: number }[] = []
    const cli = storage({ data: { signedUrl: 'https://f/firmada' }, error: null }, pedidas) as never
    assert.equal(await firmarCapturaConTipo(cli, pedido('pdf'), 'e0000000-0000-4000-8000-000000000002'), null)
    assert.equal(await firmarCapturaConTipo(cli, { id: P, empresa_id: E, captura_transferencia_url: `${E}/pedidos/otro.pdf` }, E), null)
    assert.equal(pedidas.length, 0)
  })
})
