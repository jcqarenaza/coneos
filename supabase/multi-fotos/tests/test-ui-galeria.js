const { chromium } = require('playwright')
const BASE = 'http://localhost:3111/harness-galeria', F = 'http://localhost:54500'
const out = []; const chk = (n, ok, m = '') => { out.push([n, ok, m]); console.log((ok ? 'OK    ' : 'FALLA ') + n + (ok ? '' : ' :: ' + m)) }
const reset = (mode = 'ok') => fetch(F + '/__admin/reset?mode=' + mode)
const state = () => fetch(F + '/__admin/state').then(r => r.json())
;(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 420, height: 800 }, deviceScaleFactor: 1 }); const pg = await ctx.newPage()
  const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()) })
  const tiles = () => pg.locator('#admin .grid > *').count()
  const principalIdx = async () => pg.locator('#admin .grid > div').evaluateAll(els => els.findIndex(e => e.textContent.includes('Principal')))
  const files = n => Array.from({ length: n }, (_, i) => `/tmp/ph${i}.png`)
  const input = () => pg.locator('#admin input[type=file]')

  // 1) tabla inexistente → fallback
  await reset('sin_tabla'); await pg.goto(BASE); await pg.waitForSelector('#fallback', { timeout: 20000 })
  chk('U01 sin tabla (SQL sin aplicar): se muestra el cargador clásico (fallback)', await pg.locator('#fallback').count() === 1 && await pg.locator('#admin .grid').count() === 0)

  // 2) con tabla
  await reset('ok'); await pg.goto(BASE); await pg.waitForSelector('#admin .grid', { timeout: 20000 })
  chk('U02 galería vacía: solo el botón "Agregar fotos"', await tiles() === 1)
  await input().setInputFiles(files(3)); await pg.waitForFunction(() => document.querySelectorAll('#admin .grid > *').length === 4, null, { timeout: 15000 })
  let st = await state()
  chk('U03 subir 3 fotos juntas: 3 filas, 3 uploads a Storage', st.rows.length === 3 && st.log.filter(l => l.startsWith('UPLOAD')).length === 3, JSON.stringify(st.log))
  chk('U04 la primera queda como principal (una sola)', st.rows.filter(r => r.es_principal).length === 1 && st.rows[0].es_principal && await principalIdx() === 0)
  chk('U05 orden 0,1,2 asignado', JSON.stringify(st.rows.map(r => r.orden)) === '[0,1,2]')
  chk('U06 rutas de Storage: galeria/<producto>/<uuid>.png (sin upsert de nombres fijos)', st.log.filter(l => l.startsWith('UPLOAD')).every(l => /\/productos\/galeria\/p1\/[0-9a-f-]{36}\.png$/.test(l)), JSON.stringify(st.log))
  const cambios0 = await pg.locator('#cambios').textContent()
  chk('U07 notifica al padre (onCambio) para refrescar miniaturas', cambios0 !== 'cambios:0', cambios0)

  // principal → 3ra
  await pg.locator('#admin .grid > div').nth(2).locator('button[aria-label="Hacer principal"]').click()
  await pg.waitForFunction(() => document.querySelectorAll('#admin .grid > div')[0].textContent.includes('Principal'))
  st = await state(); chk('U08 marcar principal: RPC set_imagen_principal; sigue habiendo UNA', st.log.includes('PRINCIPAL') && st.rows.filter(r => r.es_principal).length === 1)
  // mover la 2da (idx 2 ahora: principal primero) hacia atrás
  const ordenAntes = (await state()).rows.map(r => r.id + ':' + r.orden).join()
  await pg.locator('#admin .grid > div').nth(2).locator('button[aria-label="Mover antes"]').click()
  await pg.waitForFunction(() => true); await pg.waitForTimeout(600)
  st = await state(); chk('U09 reordenar: RPC reordenar_imagenes con el nuevo orden', st.log.includes('REORDEN') && st.rows.map(r => r.id + ':' + r.orden).join() !== ordenAntes)
  // quitar la principal → se promueve otra
  await pg.locator('#admin .grid > div').nth(0).locator('button[aria-label="Quitar foto"]').click()
  await pg.waitForFunction(() => document.querySelectorAll('#admin .grid > *').length === 3); st = await state()
  chk('U10 quitar la principal: queda 2 y alguna es principal (promoción)', st.rows.length === 2 && st.rows.filter(r => r.es_principal).length === 1)

  // límite 10 desde la UI
  await input().setInputFiles(files(12)); await pg.waitForFunction(() => /10\/10 fotos/.test(document.querySelector('#admin').textContent), null, { timeout: 20000 })
  st = await state(); chk('U11 subir 12 con 2 existentes: entran solo 8 (tope 10) y avisa', st.rows.length === 10 && /Solo entran 8/.test(await pg.locator('#admin').textContent()), await pg.locator('#admin').textContent())
  chk('U12 con 10 fotos desaparece el botón "Agregar fotos"', await pg.locator('#admin button:has-text("Agregar fotos")').count() === 0)
  chk('U13 contador visible 10/10', /10\/10 fotos/.test(await pg.locator('#admin').textContent()))

  // tipos inválidos
  await reset('ok'); await pg.goto(BASE); await pg.waitForSelector('#admin .grid')
  await input().setInputFiles(['/tmp/nota.txt']); await pg.waitForTimeout(800); st = await state()
  chk('U14 archivo no imagen: no sube nada y muestra el motivo', st.rows.length === 0 && st.log.filter(l => l.startsWith('UPLOAD')).length === 0 && /solo JPG, PNG, WEBP o GIF/.test(await pg.locator('#admin').textContent()))

  // carrusel
  await pg.click('#abrir'); await pg.waitForSelector('[role=dialog]')
  const cnt = () => pg.locator('[role=dialog] >> text=/\\d \\/ 3/').first().textContent()
  chk('U15 carrusel abre mostrando "1 / 3" y 3 puntos', (await cnt()).trim() === '1 / 3' && await pg.locator('[role=dialog] button[aria-label^="Ir a la foto"]').count() === 3)
  await pg.screenshot({ path: '/tmp/carrusel-movil.png' })
  await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(700)
  chk('U16 flecha derecha → "2 / 3"', (await cnt()).trim() === '2 / 3', await cnt())
  await pg.locator('[role=dialog] button[aria-label="Ir a la foto 3"]').click(); await pg.waitForTimeout(700)
  chk('U17 punto 3 → "3 / 3"', (await cnt()).trim() === '3 / 3', await cnt())
  // deslizar con el dedo (scroll nativo)
  await pg.evaluate(() => { const el = document.querySelector('[role=dialog] .snap-x'); el.scrollTo({ left: 0 }) }); await pg.waitForTimeout(700)
  chk('U18 deslizar a la primera → "1 / 3"', (await cnt()).trim() === '1 / 3', await cnt())
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(300)
  chk('U19 Escape cierra el carrusel', await pg.locator('[role=dialog]').count() === 0)
  await pg.click('#abrir'); await pg.locator('[role=dialog] button[aria-label="Cerrar"]').click(); await pg.waitForTimeout(200)
  chk('U20 botón cerrar funciona', await pg.locator('[role=dialog]').count() === 0)
  chk('U21 sin errores de consola/JS en toda la corrida', errs.length === 0, errs.slice(0, 3).join(' | '))
  // pantalla ancha (kiosk/tablet) con flechas visibles
  await pg.setViewportSize({ width: 1100, height: 760 }); await pg.click('#abrir'); await pg.waitForSelector('[role=dialog]')
  chk('U22 pantalla ancha: flecha "siguiente" visible', await pg.locator('[role=dialog] button[aria-label="Foto siguiente"]').isVisible())
  await pg.screenshot({ path: '/tmp/carrusel-ancho.png' })
  await b.close()
  const bad = out.filter(o => !o[1]).length; console.log(`\n${out.length - bad}/${out.length} OK`); process.exit(bad ? 1 : 0)
})().catch(e => { console.error('EXC', e); process.exit(2) })
