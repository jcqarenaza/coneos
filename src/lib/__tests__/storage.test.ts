import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rutaSubida, rutaCaptura, extensionSegura, esUuid, rutaDesdeValorCaptura, rutaCapturaDelPedido, firmarCaptura, firmarCapturasDePedidos,
  subirImagen, validarArchivoImagen, StorageRutaError, resumirCaptura,
} from '../storage'

const E = 'aaaaaaaa-0000-0000-0000-000000000001'
const P = '30000000-0000-0000-0000-000000000001'
const U = '11111111-2222-3333-4444-555555555555'
const rechaza = (f: () => unknown, codigo: string) => assert.throws(f, (e: unknown) => e instanceof StorageRutaError && e.codigo === codigo)

test('rutaSubida: empresa como primer segmento, carpeta, uuid y extensión', () => {
  assert.equal(rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'sabores', archivoNombre: 'foto.PNG', uuid: U }), `${E}/sabores/${U}.png`)
  assert.equal(rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'galeria', subcarpeta: P, archivoNombre: 'a.jpeg', uuid: U }), `${E}/galeria/${P}/${U}.jpg`)
})
test('rutaSubida: logo de empresa va al bucket logos (no a productos); carpeta y bucket deben coincidir', () => {
  assert.equal(rutaSubida({ bucket: 'logos', empresaId: E, carpeta: 'logos', archivoNombre: 'l.png', uuid: U }), `${E}/logos/${U}.png`)
  assert.equal(rutaSubida({ bucket: 'logos', empresaId: E, carpeta: 'pwa-icons', archivoNombre: 'i.png', uuid: U }), `${E}/pwa-icons/${U}.png`)
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'logos', archivoNombre: 'l.png' }), 'CARPETA')
  rechaza(() => rutaSubida({ bucket: 'logos', empresaId: E, carpeta: 'galeria', archivoNombre: 'l.png' }), 'CARPETA')
})
test('rutaSubida: sin uuid genera uno nuevo cada vez (no pisa)', () => {
  const a = rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'promos', archivoNombre: 'x.webp' })
  const b = rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'promos', archivoNombre: 'x.webp' })
  assert.notEqual(a, b)
})
test('rutaSubida: rechaza empresa inválida, carpeta fuera de lista, subcarpeta con .. o barras, extensión no permitida', () => {
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: 'abc', carpeta: 'promos', archivoNombre: 'x.png' }), 'EMPRESA')
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: `${E}/../x`, carpeta: 'promos', archivoNombre: 'x.png' }), 'EMPRESA')
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: '../x' as never, archivoNombre: 'x.png' }), 'CARPETA')
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'galeria', subcarpeta: '../otra', archivoNombre: 'x.png' }), 'SEGMENTO')
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'galeria', subcarpeta: 'a/b', archivoNombre: 'x.png' }), 'SEGMENTO')
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'promos', archivoNombre: 'x.exe' }), 'EXTENSION')
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'promos', archivoNombre: 'sin-extension' }), 'EXTENSION')
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'promos', archivoNombre: 'x.png', uuid: 'no-es-uuid' }), 'UUID')
})
test('extensionSegura: el tipo manda sobre un nombre engañoso', () => {
  assert.equal(extensionSegura('foto.exe', 'image/png'), 'png')
  assert.equal(extensionSegura('x.JPEG'), 'jpg')
  assert.equal(extensionSegura('icono.ico'), 'ico')
})
test('rutaCaptura: <empresa>/pedidos/<pedido>.<ext>; valida ambos ids', () => {
  assert.equal(rutaCaptura(E, P, 'comp.jpg', 'image/jpeg'), `${E}/pedidos/${P}.jpg`)
  assert.equal(rutaCaptura(E, P, 'x', 'application/pdf'), `${E}/pedidos/${P}.pdf`)
  rechaza(() => rutaCaptura('x', P, 'a.jpg'), 'EMPRESA')
  rechaza(() => rutaCaptura(E, '../p', 'a.jpg'), 'PEDIDO')
})
test('esUuid', () => { assert.ok(esUuid(E)); assert.ok(!esUuid('x')); assert.ok(!esUuid(null)) })
test('validarArchivoImagen: tipo y tamaño', () => {
  assert.equal(validarArchivoImagen({ type: 'image/png', size: 100, name: 'a.png' }), null)
  assert.match(validarArchivoImagen({ type: 'application/pdf', size: 100, name: 'a.pdf' })!, /solo JPG/)
  assert.match(validarArchivoImagen({ type: 'image/png', size: 11 * 1024 * 1024, name: 'g.png' })!, /10 MB/)
})

test('rutaDesdeValorCaptura: acepta URL pública vieja, URL firmada, ruta nueva; rechaza URL ajena y vacío', () => {
  const base = 'https://x.supabase.co/storage/v1/object'
  assert.equal(rutaDesdeValorCaptura(`${base}/public/capturas/pedidos/${P}.jpg`), `pedidos/${P}.jpg`)
  assert.equal(rutaDesdeValorCaptura(`${base}/sign/capturas/${E}/pedidos/${P}.jpg?token=abc`), `${E}/pedidos/${P}.jpg`)
  assert.equal(rutaDesdeValorCaptura(`${E}/pedidos/${P}.jpg`), `${E}/pedidos/${P}.jpg`)
  assert.equal(rutaDesdeValorCaptura('https://otro.com/comprobante.jpg'), null)
  assert.equal(rutaDesdeValorCaptura(''), null); assert.equal(rutaDesdeValorCaptura(null), null)
})

function clienteFalso(opts: { falla?: Set<string>; subidas?: { bucket: string; path: string; upsert?: boolean }[] } = {}) {
  const subidas = opts.subidas ?? []
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _f: File | Blob, o?: { upsert?: boolean }) => { subidas.push({ bucket, path, upsert: o?.upsert }); return { error: null } },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        createSignedUrl: async (path: string, ttl: number) => opts.falla?.has(path)
          ? { data: null, error: { message: 'no existe' } }
          : { data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t&ttl=${ttl}` }, error: null },
        createSignedUrls: async (paths: string[], ttl: number) => ({
          data: paths.map(path => opts.falla?.has(path)
            ? { path, signedUrl: '', error: 'no existe' }
            : { path, signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t&ttl=${ttl}`, error: null }),
          error: null,
        }),
      }),
    },
  }
}

test('subirImagen: sube SIEMPRE con upsert:false y a la ruta de la empresa', async () => {
  const subidas: { bucket: string; path: string; upsert?: boolean }[] = []
  const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })
  const r = await subirImagen(clienteFalso({ subidas }), { bucket: 'productos', empresaId: E, carpeta: 'categorias', archivo: file })
  assert.equal(subidas.length, 1)
  assert.equal(subidas[0].upsert, false)
  assert.ok(subidas[0].path.startsWith(`${E}/categorias/`) && subidas[0].path.endsWith('.png'))
  assert.equal(r.url, `https://x.supabase.co/storage/v1/object/public/productos/${r.path}`)
})
test('subirImagen: archivo inválido no llega a Storage', async () => {
  const subidas: { bucket: string; path: string }[] = []
  const pdf = new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' })
  await assert.rejects(subirImagen(clienteFalso({ subidas }), { bucket: 'productos', empresaId: E, carpeta: 'promos', archivo: pdf }), StorageRutaError)
  assert.equal(subidas.length, 0)
})
const E2 = 'bbbbbbbb-0000-0000-0000-000000000002'
const P2 = '30000000-0000-0000-0000-000000000002'
const ped = (id: string, url: string | null, empresa = E) => ({ id, empresa_id: empresa, captura_transferencia_url: url })

test('rutaCapturaDelPedido: acepta SOLO la ruta de ese pedido y de su empresa (formato nuevo y viejo)', () => {
  assert.equal(rutaCapturaDelPedido(ped(P, `${E}/pedidos/${P}.jpg`), E), `${E}/pedidos/${P}.jpg`)
  assert.equal(rutaCapturaDelPedido(ped(P, `https://x.supabase.co/storage/v1/object/public/capturas/pedidos/${P}.png`), E), `pedidos/${P}.png`)
  assert.equal(rutaCapturaDelPedido(ped(P, `pedidos/${P}.pdf`), E), `pedidos/${P}.pdf`)
})
test('rutaCapturaDelPedido: rechaza ruta de otra empresa, de otro pedido, traversal, pedido de otra empresa y ids inválidos', () => {
  assert.equal(rutaCapturaDelPedido(ped(P, `${E2}/pedidos/${P}.jpg`), E), null)            // prefijo de otra empresa
  assert.equal(rutaCapturaDelPedido(ped(P, `${E}/pedidos/${P2}.jpg`), E), null)            // comprobante de OTRO pedido
  assert.equal(rutaCapturaDelPedido(ped(P, `pedidos/${P2}.jpg`), E), null)                 // viejo, de otro pedido
  assert.equal(rutaCapturaDelPedido(ped(P, `${E}/pedidos/../${E2}/pedidos/${P}.jpg`), E), null)
  assert.equal(rutaCapturaDelPedido(ped(P, `${E}/pedidos/${P}.jpg`, E2), E), null)         // el pedido es de otra empresa que la que consulta
  assert.equal(rutaCapturaDelPedido(ped(P, `${E}/pedidos/${P}.jpg`), E2), null)            // consulta otra empresa
  assert.equal(rutaCapturaDelPedido(ped('no-uuid', `pedidos/no-uuid.jpg`), E), null)
  assert.equal(rutaCapturaDelPedido(ped(P, 'https://otro.com/x.jpg'), E), null)
  assert.equal(rutaCapturaDelPedido(ped(P, null), E), null)
})
test('firmarCaptura: firma con TTL corto solo si la ruta es del pedido; si no, ni llama a Storage', async () => {
  let llamadas = 0
  const c = clienteFalso(); const o = c.storage.from
  c.storage.from = (b: string) => { const x = o(b); const f = x.createSignedUrl; x.createSignedUrl = async (p: string, t: number) => { llamadas++; return f(p, t) }; return x }
  assert.match((await firmarCaptura(c, ped(P, `pedidos/${P}.png`), E))!, /ttl=600/)
  assert.equal(llamadas, 1)
  assert.equal(await firmarCaptura(c, ped(P, `${E2}/pedidos/${P}.png`), E), null)
  assert.equal(await firmarCaptura(c, ped(P, `${E}/pedidos/${P2}.png`), E), null)
  assert.equal(llamadas, 1, 'no debe firmar rutas ajenas')
})
test('firmarCaptura: error de Storage → null (no rompe la caja)', async () => {
  const c = clienteFalso({ falla: new Set([`${E}/pedidos/${P}.jpg`]) })
  assert.equal(await firmarCaptura(c, ped(P, `${E}/pedidos/${P}.jpg`), E), null)
})
test('firmarCapturasDePedidos: lote en una llamada; mezcla viejo/nuevo; ajenos y vacíos → null y NO se piden a Storage', async () => {
  const llamadas: string[][] = []
  const c = clienteFalso(); const orig = c.storage.from
  c.storage.from = (b: string) => { const x = orig(b); const f = x.createSignedUrls; x.createSignedUrls = async (p: string[], t: number) => { llamadas.push(p); return f(p, t) }; return x }
  const P3 = '30000000-0000-0000-0000-000000000003'
  const m = await firmarCapturasDePedidos(c, E, [
    ped(P, `https://x.supabase.co/storage/v1/object/public/capturas/pedidos/${P}.jpg`),
    ped(P2, `${E}/pedidos/${P2}.png`),
    ped(P3, `${E2}/pedidos/${P3}.png`),                       // prefijo de otra empresa
    ped('30000000-0000-0000-0000-000000000004', null),
    ped('30000000-0000-0000-0000-000000000005', `${E}/pedidos/${P}.jpg`),   // apunta al comprobante de otro pedido
    ped('30000000-0000-0000-0000-000000000006', `${E2}/pedidos/30000000-0000-0000-0000-000000000006.jpg`, E2),   // pedido de otra empresa
  ])
  assert.equal(llamadas.length, 1); assert.deepEqual(llamadas[0].sort(), [`${E}/pedidos/${P2}.png`, `pedidos/${P}.jpg`].sort())
  assert.match(m.get(P)!, /\/sign\/capturas\/pedidos\//); assert.match(m.get(P2)!, new RegExp(`/sign/capturas/${E}/pedidos/`))
  for (const id of [P3, '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000006']) assert.equal(m.get(id), null, id)
})
test('firmarCapturasDePedidos: lista vacía o sin comprobantes válidos no llama a Storage', async () => {
  let n = 0
  const c = clienteFalso(); const o = c.storage.from
  c.storage.from = (b: string) => { const x = o(b); x.createSignedUrls = async () => { n++; return { data: [], error: null } }; return x }
  assert.equal((await firmarCapturasDePedidos(c, E, [])).size, 0)
  await firmarCapturasDePedidos(c, E, [ped(P, null)])
  assert.equal(n, 0)
})

test('rutaDesdeValorCaptura: secuencia %% malformada devuelve null (no lanza)', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/capturas'
  assert.doesNotThrow(() => rutaDesdeValorCaptura(`${base}/pedidos/%ZZ.jpg`))
  assert.equal(rutaDesdeValorCaptura(`${base}/pedidos/%E0%A4%A.jpg`), null)
  assert.equal(rutaCapturaDelPedido(ped(P, `${base}/pedidos/%ZZ.jpg`), E), null)
})
test('.ico: solo para logo/favicon (bucket logos, carpeta logos); nunca en catálogo ni en pwa-icons', () => {
  assert.equal(rutaSubida({ bucket: 'logos', empresaId: E, carpeta: 'logos', archivoNombre: 'f.ico', archivoTipo: 'image/x-icon', uuid: U }), `${E}/logos/${U}.ico`)
  assert.equal(rutaSubida({ bucket: 'logos', empresaId: E, carpeta: 'logos', archivoNombre: 'f.ico', archivoTipo: 'image/vnd.microsoft.icon', uuid: U }), `${E}/logos/${U}.ico`)
  rechaza(() => rutaSubida({ bucket: 'productos', empresaId: E, carpeta: 'productos', archivoNombre: 'f.ico', archivoTipo: 'image/x-icon' }), 'EXTENSION')
  rechaza(() => rutaSubida({ bucket: 'logos', empresaId: E, carpeta: 'pwa-icons', archivoNombre: 'f.ico', archivoTipo: 'image/x-icon' }), 'EXTENSION')
  assert.equal(validarArchivoImagen({ type: 'image/x-icon', size: 10, name: 'f.ico' }, { permitirIco: true }), null)
  assert.equal(validarArchivoImagen({ type: '', size: 10, name: 'f.ico' }, { permitirIco: true }), null)   // algunos navegadores no informan el tipo
  assert.match(validarArchivoImagen({ type: 'image/x-icon', size: 10, name: 'f.ico' })!, /solo JPG/)
})
test('subirImagen: .ico entra por logos/logos y no por productos', async () => {
  const subidas: { bucket: string; path: string }[] = []
  const ico = new File([new Uint8Array(10)], 'favicon.ico', { type: 'image/x-icon' })
  const r = await subirImagen(clienteFalso({ subidas }), { bucket: 'logos', empresaId: E, carpeta: 'logos', archivo: ico })
  assert.ok(r.path.startsWith(`${E}/logos/`) && r.path.endsWith('.ico'))
  await assert.rejects(subirImagen(clienteFalso({ subidas }), { bucket: 'productos', empresaId: E, carpeta: 'productos', archivo: ico }), StorageRutaError)
  assert.equal(subidas.length, 1)
})

test('resumirCaptura: saca el valor guardado y deja solo tiene_captura (true únicamente si es firmable para ese pedido y empresa)', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/capturas'
  const a = resumirCaptura({ id: P, total: 5, captura_transferencia_url: `${base}/pedidos/${P}.jpg` }, E)
  assert.equal(a.tiene_captura, true); assert.equal('captura_transferencia_url' in a, false); assert.equal(a.total, 5)
  assert.equal(resumirCaptura({ id: P, captura_transferencia_url: `${E}/pedidos/${P}.png` }, E).tiene_captura, true)
  assert.equal(resumirCaptura({ id: P, captura_transferencia_url: null }, E).tiene_captura, false)
  assert.equal(resumirCaptura({ id: P }, E).tiene_captura, false)
  assert.equal(resumirCaptura({ id: P, captura_transferencia_url: `${base}/pedidos/${U}.jpg` }, E).tiene_captura, false)          // comprobante de otro pedido
  assert.equal(resumirCaptura({ id: P, captura_transferencia_url: `${base}/${U}/pedidos/${P}.jpg` }, E).tiene_captura, false)      // empresa distinta
})
