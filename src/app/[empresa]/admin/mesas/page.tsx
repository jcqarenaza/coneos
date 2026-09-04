'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { Loader2 } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// Admin → Mesas (F3)
// - Llave del negocio: "Recibir pedidos de mesa" (empresa_config.mesas_activo)
//   — doble llave: QP habilita el módulo (modulos.mesas), el local lo pausa acá.
// - Links de los QR (general y por mesa) para copiar.
// - Generador de QRs imprimibles: cartelitos 6×8 cm recortables (8 por A4)
//   o stickers circulares de 5 cm. Sin ploteos: imprimir, recortar, pegar.
// ═══════════════════════════════════════════════════════════════════

interface Sucursal { id: string; nombre: string; slug: string }

export default function MesasPage() {
  const { ctx } = useEmpresa()
  const [loading, setLoading] = useState(true)
  const [moduloActivo, setModuloActivo] = useState(false)
  const [mesasActivo, setMesasActivo] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [empresaSlug, setEmpresaSlug] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [color, setColor] = useState('#1E3A5F')
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalSel, setSucursalSel] = useState<string>('')
  const [cantidad, setCantidad] = useState(10)
  const [copiado, setCopiado] = useState<string | null>(null)

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    Promise.all([
      supabase.from('empresas').select('slug').eq('id', ctx.empresaId).single(),
      supabase.from('empresa_config').select('modulos, mesas_activo, primary_color, logo_url').eq('empresa_id', ctx.empresaId).maybeSingle(),
      supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', ctx.empresaId).eq('activo', true).order('nombre'),
    ]).then(([{ data: emp }, { data: cfg }, { data: sucs }]) => {
      if (emp) setEmpresaSlug(emp.slug)
      const modulos = (cfg?.modulos ?? {}) as Record<string, boolean>
      setModuloActivo(modulos.mesas === true)
      setMesasActivo(cfg?.mesas_activo !== false)
      if (cfg?.primary_color) setColor(cfg.primary_color)
      setLogoUrl(cfg?.logo_url ?? null)
      const lista = (sucs ?? []) as Sucursal[]
      setSucursales(lista)
      if (lista.length > 0) setSucursalSel(lista[0].id)
      setLoading(false)
    })
  }, [ctx])

  const suc = sucursales.find(s => s.id === sucursalSel)
  const baseUrl = suc ? `https://coneos.vercel.app/${empresaSlug}/mesa/${suc.slug}` : ''

  async function toggleRecibir() {
    if (!ctx || guardando) return
    setGuardando(true)
    const supabase = createClient()
    const nuevo = !mesasActivo
    await supabase.from('empresa_config').update({ mesas_activo: nuevo }).eq('empresa_id', ctx.empresaId)
    setMesasActivo(nuevo)
    setGuardando(false)
  }

  function copiar(texto: string, tag: string) {
    navigator.clipboard.writeText(texto).then(() => {
      setCopiado(tag)
      setTimeout(() => setCopiado(null), 2000)
    })
  }

  function imprimir(formato: 'cartelitos' | 'stickers') {
    if (!baseUrl) return
    const mesas = Array.from({ length: Math.max(1, Math.min(100, cantidad)) }, (_, i) => i + 1)
    const win = window.open('about:blank', '_blank')
    if (!win) return

    const piezas = formato === 'cartelitos'
      ? [
          // Cartelito del QR GENERAL primero, después uno por mesa
          `<div class="card"><div class="qr" data-url="${baseUrl}"></div><p class="mesa-label">Todas las mesas</p><p class="cta">Pedí desde tu mesa 📱</p>${logoUrl ? `<img class="logo" src="${logoUrl}" />` : ''}</div>`,
          ...mesas.map(n => `<div class="card"><div class="qr" data-url="${baseUrl}?m=${n}"></div><p class="mesa-label">Mesa ${n}</p><p class="cta">Pedí desde tu mesa 📱</p>${logoUrl ? `<img class="logo" src="${logoUrl}" />` : ''}</div>`),
        ]
      : mesas.map(n => `<div class="circle"><div class="qr" data-url="${baseUrl}?m=${n}"></div><p class="mesa-label">Mesa ${n}</p></div>`)

    const css = formato === 'cartelitos'
      ? `.hoja { display: grid; grid-template-columns: repeat(3, 60mm); gap: 6mm; justify-content: center; }
         .card { width: 60mm; height: 80mm; border: 1px dashed #bbb; border-radius: 4mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2mm; padding: 4mm; page-break-inside: avoid; position: relative; }
         .card .qr { width: 38mm; height: 38mm; }
         .card .qr img, .card .qr canvas { width: 38mm !important; height: 38mm !important; }
         .mesa-label { font-size: 16pt; font-weight: 900; color: ${color}; margin-top: 1mm; }
         .cta { font-size: 9pt; color: #666; }
         .logo { height: 8mm; object-fit: contain; margin-top: 1mm; }`
      : `.hoja { display: grid; grid-template-columns: repeat(3, 50mm); gap: 8mm; justify-content: center; }
         .circle { width: 50mm; height: 50mm; border: 1px dashed #bbb; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-inside: avoid; }
         .circle .qr { width: 26mm; height: 26mm; }
         .circle .qr img, .circle .qr canvas { width: 26mm !important; height: 26mm !important; }
         .mesa-label { font-size: 11pt; font-weight: 900; color: ${color}; margin-top: 1.5mm; }`

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>QRs de mesas</title>
<style>
@media print { @page { size: A4; margin: 10mm; } .btns { display: none !important; } }
* { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
body { padding: 10mm; }
${css}
.btns { display: flex; gap: 8px; justify-content: center; margin-bottom: 16px; }
.btn { padding: 10px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; }
</style>
</head>
<body>
<div class="btns">
  <button class="btn" style="background:#000;color:white" onclick="window.print()">Imprimir</button>
  <button class="btn" style="background:#f1f1f1;color:#333" onclick="window.close()">Cerrar</button>
</div>
<div class="hoja">${piezas.join('')}</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
<script>
  document.querySelectorAll('.qr').forEach(el => {
    new QRCode(el, { text: el.dataset.url, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
  });
<\/script>
</body>
</html>`
    win.document.write(html)
    win.document.close()
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  if (!moduloActivo) return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-8 text-center">
        <span className="text-5xl block mb-3">🪑</span>
        <h2 className="text-lg font-black text-neutral-800 mb-2">El módulo Mesas no está activo</h2>
        <p className="text-neutral-500 text-sm">Contactá a QP C&IA para activarlo en tu plan.</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-black text-neutral-900">🪑 Mesas</h1>
        <p className="text-neutral-400 text-sm">Pedidos con QR desde la mesa</p>
      </div>

      {/* Llave del negocio */}
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-bold text-neutral-800">Recibir pedidos de mesa</p>
          <p className="text-neutral-400 text-sm">Pausalo cuando no haya servicio en el salón. Los QR mostrarán &quot;no disponible&quot;.</p>
        </div>
        <button onClick={toggleRecibir} disabled={guardando}
          className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${mesasActivo ? 'bg-green-500' : 'bg-neutral-200'}`}>
          <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${mesasActivo ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Links + generador */}
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 space-y-4">
        {sucursales.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {sucursales.map(s => (
              <button key={s.id} onClick={() => setSucursalSel(s.id)}
                className={`px-3 py-1.5 rounded-xl text-sm font-semibold border transition-colors ${sucursalSel === s.id ? 'bg-neutral-800 text-white border-neutral-800' : 'bg-white text-neutral-400 border-neutral-200'}`}>
                {s.nombre}
              </button>
            ))}
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">Links del QR</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 bg-neutral-50 rounded-xl px-3 py-2.5 text-sm text-neutral-600 font-mono truncate">{baseUrl || '—'}</div>
              <button onClick={() => copiar(baseUrl, 'gral')}
                className="text-xs font-semibold px-3 py-2.5 rounded-xl border border-neutral-200 text-neutral-500 hover:text-neutral-700 flex-shrink-0">
                {copiado === 'gral' ? '✓ Copiado' : 'Copiar general'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 bg-neutral-50 rounded-xl px-3 py-2.5 text-sm text-neutral-600 font-mono truncate">{baseUrl ? `${baseUrl}?m=1` : '—'}</div>
              <button onClick={() => copiar(`${baseUrl}?m=1`, 'm1')}
                className="text-xs font-semibold px-3 py-2.5 rounded-xl border border-neutral-200 text-neutral-500 hover:text-neutral-700 flex-shrink-0">
                {copiado === 'm1' ? '✓ Copiado' : 'Copiar Mesa 1'}
              </button>
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-2">El link general pide nombre y número de mesa. El link con <span className="font-mono">?m=N</span> trae la mesa fijada y pide solo el nombre.</p>
        </div>

        <div className="border-t border-neutral-100 pt-4">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">Imprimir QRs</p>
          <div className="flex items-center gap-3 mb-3">
            <label className="text-sm text-neutral-600 font-semibold">Cantidad de mesas</label>
            <input type="number" min={1} max={100} value={cantidad}
              onChange={e => setCantidad(Number(e.target.value))}
              className="w-20 text-center font-bold rounded-xl border border-neutral-200 px-2 py-2" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => imprimir('cartelitos')} disabled={!baseUrl}
              className="flex-1 min-w-40 py-3 rounded-xl bg-neutral-800 text-white font-bold text-sm disabled:opacity-40">
              🖨️ Cartelitos 6×8 cm
            </button>
            <button onClick={() => imprimir('stickers')} disabled={!baseUrl}
              className="flex-1 min-w-40 py-3 rounded-xl border-2 border-neutral-200 text-neutral-600 font-bold text-sm disabled:opacity-40">
              ⭕ Stickers 5 cm
            </button>
          </div>
          <p className="text-xs text-neutral-400 mt-2">Se abren listos para imprimir en A4 y recortar: los cartelitos traen también el QR general (&quot;Todas las mesas&quot;), los stickers son uno por mesa.</p>
        </div>
      </div>
    </div>
  )
}
