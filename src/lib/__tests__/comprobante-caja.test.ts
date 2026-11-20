// Tipo de comprobante que informa el servidor a Vista Caja (PDF histórico «archivado»). Decisión CTO 20/11.
// Ejecutar: npx tsx --test src/lib/__tests__/comprobante-caja.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tipoCapturaDeRuta, normalizarTipoCaptura, TEXTO_PDF_ARCHIVADO } from '../comprobante-caja'

test('tipoCapturaDeRuta: .pdf (cualquier mayúscula) = pdf_archivado; imágenes y todo lo demás = imagen', () => {
  const P = '30000000-0000-4000-8000-000000000001'
  for (const r of [`pedidos/${P}.pdf`, `e/pedidos/${P}.PDF`, `e/pedidos/${P}.Pdf`]) assert.equal(tipoCapturaDeRuta(r), 'pdf_archivado', r)
  for (const r of [`pedidos/${P}.jpg`, `e/pedidos/${P}.png`, `e/pedidos/${P}.webp`, `e/pedidos/${P}.jpeg`, `e/pedidos/${P}`, '', 'x.pdf.jpg', 'pdf']) assert.equal(tipoCapturaDeRuta(r), 'imagen', r)
  assert.equal(tipoCapturaDeRuta(null), 'imagen'); assert.equal(tipoCapturaDeRuta(undefined), 'imagen')
})
test('normalizarTipoCaptura: solo "pdf_archivado" cambia la vista (respuestas viejas o raras = imagen)', () => {
  assert.equal(normalizarTipoCaptura('pdf_archivado'), 'pdf_archivado')
  for (const v of ['imagen', 'pdf', undefined, null, 1, {}, 'PDF_ARCHIVADO']) assert.equal(normalizarTipoCaptura(v), 'imagen')
})
test('el texto del aviso es el indicado por el CTO', () => {
  assert.equal(TEXTO_PDF_ARCHIVADO, 'Comprobante PDF archivado; no disponible para visualización')
})

// ── Estático: la vista del PDF histórico es solo texto (sin enlace, visor ni descarga) ──
const leer = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
test('Vista Caja: el estado «archivado» muestra solo el texto; el <a>/<img> existe únicamente en el estado de imagen', () => {
  const caja = leer('src/components/operacion/VistaCaja.tsx')
  const i = caja.indexOf("{estado === 'archivado'")
  assert.ok(i > 0)
  const lineaArchivado = caja.slice(i, caja.indexOf('\n', i))
  assert.match(lineaArchivado, /TEXTO_PDF_ARCHIVADO/)
  assert.doesNotMatch(lineaArchivado, /<a |<img|href|download|iframe|embed|object/i)
  // el <a> y el <img> viven dentro de {estado === 'ok' && url && ...}
  const j = caja.indexOf("{estado === 'ok' && url")
  assert.ok(j > i)
  assert.doesNotMatch(caja.slice(0, j).slice(i), /<a |<img/)   // entre el aviso y el bloque de imagen no hay enlaces
  assert.doesNotMatch(caja, /pdfjs|VisorComprobante|Abrir comprobante|download=/i)
})
test('servidor: el PDF archivado se responde sin URL ni firma', () => {
  const ruta = leer('src/app/api/operacion/consulta/route.ts')
  assert.match(ruta, /c\.tipo === 'pdf_archivado'\) return NextResponse\.json\(\{ tipo: 'pdf_archivado' \}\)/)
  const st = leer('src/lib/storage.ts')
  assert.match(st, /tipoCapturaDeRuta\(ruta\) === 'pdf_archivado'\) return \{ tipo: 'pdf_archivado' \}/)   // se decide ANTES de createSignedUrl
})
