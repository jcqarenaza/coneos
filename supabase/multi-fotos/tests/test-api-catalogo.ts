// Prueba de /api/kiosk/catalogo con un PostgREST simulado (sin red, sin base real).
// Uso (desde la raíz del repo):  npx tsx supabase/multi-fotos/tests/test-api-catalogo.ts
import http from 'node:http'

const E = 'e0000000-0000-0000-0000-000000000001', S = 's0000000-0000-0000-0000-000000000001'
const U = (n: string) => `https://x.supabase.co/storage/v1/object/public/productos/${n}.jpg`
type Row = Record<string, unknown>
let modo: 'normal' | 'sin_tabla' | 'grande' = 'normal'
const base: Record<string, Row[]> = {
  categorias: [{ id: 'c1', nombre: 'Cat', icono_url: null, orden: 1 }],
  productos: [
    { id: 'pA', nombre: 'A (galería)', descripcion: null, imagen_url: U('a1'), categoria_id: 'c1', orden: 1, controla_stock: false },
    { id: 'pB', nombre: 'B (solo imagen_url legacy)', descripcion: null, imagen_url: U('b-legacy'), categoria_id: 'c1', orden: 2, controla_stock: false },
    { id: 'pC', nombre: 'C (sin fotos)', descripcion: null, imagen_url: null, categoria_id: 'c1', orden: 3, controla_stock: false },
  ],
  presentaciones: [
    { id: 'rA1', nombre: 'A roja (2 propias)', precio: 10, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1, producto_id: 'pA', imagen_url: U('r1'), es_novedad: false },
    { id: 'rA2', nombre: 'A azul (hereda)', precio: 10, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 2, producto_id: 'pA', imagen_url: null, es_novedad: false },
    { id: 'rB1', nombre: 'B1 (hereda legacy)', precio: 5, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1, producto_id: 'pB', imagen_url: null, es_novedad: false },
    { id: 'rC1', nombre: 'C1', precio: 5, permite_opciones: false, opciones_min: 0, opciones_max: 0, orden: 1, producto_id: 'pC', imagen_url: null, es_novedad: false },
  ],
  grupos_opciones: [], opciones: [], inventario_opciones: [], presentacion_grupos: [], sucursal_catalogo_config: [], producto_stock: [],
  empresa_config: [{ mostrar_agotados: false }], promociones: [],
}
const galeria = (): Row[] => modo === 'grande'
  ? Array.from({ length: 2500 }, (_, i) => ({ id: 'g' + String(i).padStart(5, '0'), producto_id: 'pA', presentacion_id: null, url: U('big' + i), orden: i, es_principal: i === 0, created_at: '2026-01-01T00:00:00Z' }))
  : [
    { id: 'g3', producto_id: 'pA', presentacion_id: null, url: U('a3'), orden: 2, es_principal: false, created_at: '2026-01-03T00:00:00Z' },
    { id: 'g1', producto_id: 'pA', presentacion_id: null, url: U('a1'), orden: 0, es_principal: false, created_at: '2026-01-01T00:00:00Z' },
    { id: 'g2', producto_id: 'pA', presentacion_id: null, url: U('a2'), orden: 1, es_principal: true, created_at: '2026-01-02T00:00:00Z' },   // principal con orden 1 → va primera
    { id: 'g4', producto_id: 'pA', presentacion_id: 'rA1', url: U('r2'), orden: 1, es_principal: false, created_at: '2026-01-04T00:00:00Z' },
    { id: 'g5', producto_id: 'pA', presentacion_id: 'rA1', url: U('r1'), orden: 0, es_principal: true, created_at: '2026-01-04T00:00:00Z' },
  ]
let galeriaCalls = 0
const srv = http.createServer((req, res) => {
  const u = new URL(req.url!, 'http://x'); const t = u.pathname.replace('/rest/v1/', '')
  res.setHeader('content-type', 'application/json')
  if (t === 'producto_imagenes') {
    galeriaCalls++
    if (modo === 'sin_tabla') { res.statusCode = 404; return res.end(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.producto_imagenes'" })) }
    const all = galeria().sort((a, b) => String(a.id).localeCompare(String(b.id)))
    const off = Number(u.searchParams.get('offset') ?? 0)
    let lim = u.searchParams.get('limit') ? Number(u.searchParams.get('limit')) : 1000
    const rg = req.headers['range']; let o = off
    if (typeof rg === 'string' && /^\d+-\d+$/.test(rg)) { const [a, b] = rg.split('-').map(Number); o = a; lim = b - a + 1 }
    return res.end(JSON.stringify(all.slice(o, o + Math.min(lim, 1000))))
  }
  if (t === 'empresa_config') return res.end(JSON.stringify(base.empresa_config[0]))
  res.end(JSON.stringify(base[t] ?? []))
})
async function main() {
  await new Promise<void>(r => srv.listen(0, r))
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  const { GET } = await import('../../../src/app/api/kiosk/catalogo/route')
  const llamar = async () => (await GET(new Request(`http://x/api/kiosk/catalogo?empresa_id=${E}&sucursal_id=${S}`))).json() as Promise<{ productos: any[]; presentaciones: any[] }>
  const out: [string, boolean, string][] = []
  const chk = (n: string, ok: boolean, m = '') => out.push([n, ok, m])
  const P = (d: any, id: string) => d.productos.find((p: any) => p.id === id), R = (d: any, id: string) => d.presentaciones.find((p: any) => p.id === id)

  modo = 'normal'; const d = await llamar()
  chk('A01 producto con galería: imagenes = principal primero, luego por orden', JSON.stringify(P(d, 'pA').imagenes) === JSON.stringify([U('a2'), U('a1'), U('a3')]), JSON.stringify(P(d, 'pA').imagenes))
  chk('A02 imagen_url del producto NO cambia (compat con los 17 usos)', P(d, 'pA').imagen_url === U('a1') && P(d, 'pB').imagen_url === U('b-legacy') && P(d, 'pC').imagen_url === null)
  chk('A03 producto sin fila de galería usa imagen_url legacy', JSON.stringify(P(d, 'pB').imagenes) === JSON.stringify([U('b-legacy')]))
  chk('A04 producto sin fotos → []', JSON.stringify(P(d, 'pC').imagenes) === '[]')
  chk('A05 presentación con fotos propias: las suyas (principal primero)', JSON.stringify(R(d, 'rA1').imagenes) === JSON.stringify([U('r1'), U('r2')]), JSON.stringify(R(d, 'rA1').imagenes))
  chk('A06 presentación sin fotos propias HEREDA las del producto', JSON.stringify(R(d, 'rA2').imagenes) === JSON.stringify(P(d, 'pA').imagenes))
  chk('A07 presentación sin fotos hereda imagen_url legacy del producto', JSON.stringify(R(d, 'rB1').imagenes) === JSON.stringify([U('b-legacy')]))
  chk('A08 presentación sin nada → []', JSON.stringify(R(d, 'rC1').imagenes) === '[]')
  chk('A09 imagen_url de presentaciones NO cambia (la herencia es solo de lectura)', R(d, 'rA2').imagen_url === null && R(d, 'rA1').imagen_url === U('r1'))
  chk('A10 la grilla puede seguir usando solo imagen_url (campos originales intactos)', ['id', 'nombre', 'descripcion', 'imagen_url', 'categoria_id', 'orden', 'agotado'].every(k => k in P(d, 'pA')))

  modo = 'sin_tabla'; const s = await llamar()
  chk('A11 SIN la tabla (SQL no aplicado): catálogo responde igual, imagenes = [imagen_url]', JSON.stringify(P(s, 'pA').imagenes) === JSON.stringify([U('a1')]) && P(s, 'pC').imagenes.length === 0 && s.productos.length === 3)
  chk('A12 SIN la tabla: presentación hereda y no rompe', JSON.stringify(R(s, 'rA2').imagenes) === JSON.stringify([U('a1')]))

  modo = 'grande'; galeriaCalls = 0; const g = await llamar()
  chk('A13 paginación: 2500 filas → 3 consultas y las 2500 fotos', galeriaCalls === 3 && P(g, 'pA').imagenes.length === 2500, `calls=${galeriaCalls} n=${P(g, 'pA').imagenes.length}`)
  chk('A14 paginación conserva la principal primero', P(g, 'pA').imagenes[0] === U('big0'))
  srv.close()
  for (const [n, ok, m] of out) console.log((ok ? 'OK    ' : 'FALLA ') + n + (ok ? '' : ' :: ' + m))
  const bad = out.filter(o => !o[1]).length; console.log(`\n${out.length - bad}/${out.length} OK`); process.exit(bad ? 1 : 0)
}
main()
