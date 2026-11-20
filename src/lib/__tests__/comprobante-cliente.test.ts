// Validación en el navegador del comprobante (delivery/takeaway): solo imágenes JPG, PNG o WebP; PDF rechazado. Decisión CTO 20/11.
// Ejecutar: npx tsx --test src/lib/__tests__/comprobante-cliente.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCEPT_COMPROBANTE, MENSAJE_SOLO_IMAGEN, MENSAJE_ARCHIVO_VACIO, MENSAJE_ARCHIVO_GRANDE, validarCapturaCliente } from '../comprobante-cliente'
import { MAX_BYTES_COMPROBANTE } from '../storage'

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([9, 9, 9, 9]), Buffer.from('WEBPVP8 ')])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 7)])
const archivo = (b: Buffer, name: string, type: string) => new File([new Uint8Array(b)], name, { type })

test('acepta JPG, PNG y WebP (por contenido)', async () => {
  assert.deepEqual(await validarCapturaCliente(archivo(JPG, 'a.jpg', 'image/jpeg')), { ok: true })
  assert.deepEqual(await validarCapturaCliente(archivo(JPG, 'a.jpeg', 'image/jpeg')), { ok: true })
  assert.deepEqual(await validarCapturaCliente(archivo(PNG, 'a.png', 'image/png')), { ok: true })
  assert.deepEqual(await validarCapturaCliente(archivo(WEBP, 'a.webp', 'image/webp')), { ok: true })
  assert.deepEqual(await validarCapturaCliente(archivo(JPG, 'image', '')), { ok: true })   // celulares que entregan el archivo sin extensión ni tipo
})

test('rechaza el PDF: por nombre, por tipo y disfrazado de imagen', async () => {
  for (const [n, t] of [['comp.pdf', 'application/pdf'], ['comp.pdf', ''], ['comp.jpg', 'image/jpeg'], ['comp.png', 'image/png'], ['comp', '']] as const) {
    assert.deepEqual(await validarCapturaCliente(archivo(PDF, n, t)), { ok: false, mensaje: MENSAJE_SOLO_IMAGEN }, `${n} ${t}`)
  }
})

test('rechaza otros formatos, vacío y demasiado grande', async () => {
  for (const b of [Buffer.from('GIF89a......'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0]), Buffer.concat([Buffer.from('RIFF'), Buffer.from([9, 9, 9, 9]), Buffer.from('WAVEfmt ')])]) {
    assert.deepEqual(await validarCapturaCliente(archivo(b, 'x.jpg', 'image/jpeg')), { ok: false, mensaje: MENSAJE_SOLO_IMAGEN })
  }
  assert.deepEqual(await validarCapturaCliente(archivo(Buffer.alloc(0), 'a.jpg', 'image/jpeg')), { ok: false, mensaje: MENSAJE_ARCHIVO_VACIO })
  const grande = Buffer.concat([JPG, Buffer.alloc(MAX_BYTES_COMPROBANTE)])
  assert.deepEqual(await validarCapturaCliente(archivo(grande, 'a.jpg', 'image/jpeg')), { ok: false, mensaje: MENSAJE_ARCHIVO_GRANDE })
})

test('el selector de archivos solo ofrece JPG, PNG y WebP (sin PDF ni image/* genérico)', () => {
  assert.deepEqual(ACCEPT_COMPROBANTE.split(','), ['image/jpeg', 'image/png', 'image/webp'])
  assert.ok(!/pdf/i.test(ACCEPT_COMPROBANTE))
})

// ── Estático: el delivery usa la validación y no queda ningún rastro del visor/soporte PDF ──
const leer = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
test('delivery/takeaway: usa ACCEPT_COMPROBANTE y validarCapturaCliente; sin image/* ni PDF', () => {
  const src = leer('src/components/delivery/KioskConfirmacionDelivery.tsx')
  assert.match(src, /accept=\{ACCEPT_COMPROBANTE\}/)
  assert.match(src, /validarCapturaCliente\(/)
  assert.doesNotMatch(src, /accept="image\/\*"/)
  assert.doesNotMatch(src, /application\/pdf/i)
})
test('Vista Caja: sin visor PDF, sin PDF.js, sin enlaces externos de comprobante, imagen directa con URL firmada', () => {
  const caja = leer('src/components/operacion/VistaCaja.tsx')
  assert.doesNotMatch(caja, /VisorComprobante|pdfjs|comprobante-visor|TipoVisorCaptura|Abrir comprobante/i)
  assert.match(caja, /<img src=\{url\}/)
  const pkg = leer('package.json')
  assert.doesNotMatch(pkg, /pdfjs|pdf-lib|react-pdf/i)
  const ruta = leer('src/app/api/operacion/consulta/route.ts')
  assert.doesNotMatch(ruta, /firmarCapturaConTipo|tipoVisor/)
})
