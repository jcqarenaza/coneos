// Supabase simulado: PostgREST + Storage + RPC con las MISMAS reglas que el SQL (principal, límite 10).
const http = require('http'); const { randomUUID } = require('crypto')
let rows = []; let mode = 'ok'; const log = []
const J = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); res.end(body === undefined ? '' : JSON.stringify(body)) }
const scopeOf = r => r.producto_id + ':' + (r.presentacion_id || '')
const lista = (r) => rows.filter(x => scopeOf(x) === scopeOf(r))
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname
  if (req.method === 'OPTIONS') return J(res, 204)
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    if (p === '/__admin/reset') { rows = []; mode = u.searchParams.get('mode') || 'ok'; log.length = 0; return J(res, 200, { ok: 1 }) }
    if (p === '/__admin/state') return J(res, 200, { rows, log })
    if (p.startsWith('/storage/v1/object/')) { if (req.method === 'POST') log.push('UPLOAD ' + p); return J(res, 200, { Key: p }) }
    if (p === '/rest/v1/producto_imagenes') {
      if (mode === 'sin_tabla') return J(res, 404, { code: 'PGRST205', message: 'no table' })
      if (req.method === 'GET') {
        let out = rows
        const pr = u.searchParams.get('producto_id'); if (pr) out = out.filter(x => x.producto_id === pr.replace('eq.', ''))
        const ps = u.searchParams.get('presentacion_id'); if (ps) out = out.filter(x => ps === 'is.null' ? !x.presentacion_id : x.presentacion_id === ps.replace('eq.', ''))
        if (u.searchParams.get('limit')) out = out.slice(0, Number(u.searchParams.get('limit')))
        return J(res, 200, [...out].sort((a, b) => a.orden - b.orden))
      }
      if (req.method === 'POST') {
        const r = JSON.parse(body); const row = { id: randomUUID(), presentacion_id: null, es_principal: false, created_at: new Date().toISOString(), orden: 0, ...r }
        const l = lista(row)
        if (l.length >= 10) return J(res, 400, { code: 'P0001', message: 'LIMITE_IMAGENES' })
        if (l.length === 0) row.es_principal = true
        rows.push(row); log.push('INSERT'); return J(res, 201, [row])
      }
      if (req.method === 'DELETE') {
        const id = u.searchParams.get('id').replace('eq.', ''); const r = rows.find(x => x.id === id)
        rows = rows.filter(x => x.id !== id)
        if (r && r.es_principal) { const n = lista(r).sort((a, b) => a.orden - b.orden)[0]; if (n) n.es_principal = true }
        log.push('DELETE'); return J(res, 204)
      }
    }
    if (p === '/rest/v1/rpc/set_imagen_principal') {
      const { p_imagen_id } = JSON.parse(body); const r = rows.find(x => x.id === p_imagen_id)
      if (!r) return J(res, 400, { message: 'IMAGEN_NO_ENCONTRADA' })
      lista(r).forEach(x => x.es_principal = false); r.es_principal = true; log.push('PRINCIPAL'); return J(res, 200, null)
    }
    if (p === '/rest/v1/rpc/reordenar_imagenes') {
      const { p_ids } = JSON.parse(body); p_ids.forEach((id, i) => { const r = rows.find(x => x.id === id); if (r) r.orden = i }); log.push('REORDEN'); return J(res, 200, null)
    }
    J(res, 404, { message: 'no' })
  })
}).listen(54500, () => console.log('fake supabase :54500'))
