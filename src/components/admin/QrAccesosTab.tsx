'use client'

// ═══════════════════════════════════════════════════════════════════
// MINI-CICLO QR PÚBLICO — "Este es tu QR para pedir"
// Genera QRs de ENTRADA PÚBLICA por sucursal y destino:
//   📱 App de pedidos → /{empresa}/pedidos/{sucursal}   (la puerta única)
//   🛵 Delivery directo → /{empresa}/delivery/{sucursal}
//   🥡 Take Away directo → /{empresa}/takeaway/{sucursal}
// REGLAS DEL CICLO (roadmap oficial):
//  - Sin tabla nueva: el QR público ES una URL estable dibujada — nada que
//    persistir, nada que administrar
//  - COMPLETAMENTE separado del QR-token de dispositivos (operación). Esta
//    página no conoce tokens, no toca device/verify, no toca el bridge:
//    cero archivos de Delivery involucrados.
//  - La librería `qrcode` ya estaba en el proyecto (generador de Mesas)
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeCard } from '@/components/admin/ConeComponents'
import { Loader2, Copy, Download, Printer, Check } from 'lucide-react'
import QRCode from 'qrcode'
import QrMesas from '@/components/admin/QrMesas'

interface Sucursal { id: string; nombre: string; slug: string }

const DESTINOS = [
  { id: 'app', emoji: '📱', titulo: 'App de pedidos', desc: 'La puerta única: el cliente elige Delivery o Take Away y ve los horarios. Recomendado para imprimir.', path: 'pedidos' },
  { id: 'delivery', emoji: '🛵', titulo: 'Delivery directo', desc: 'Entra derecho al pedido a domicilio, sin selector.', path: 'delivery' },
  { id: 'takeaway', emoji: '🥡', titulo: 'Take Away directo', desc: 'Entra derecho al pedido para retirar, sin selector.', path: 'takeaway' },
] as const

// UN solo selector (orden JC): el de la casa manda; este tab obedece la
// sucursal que le pasan y esconde su selector propio.
export default function QrAccesosTab({ sucursalId }: { sucursalId?: string } = {}) {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const supabase = useMemo(() => createClient(), [])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalSel, setSucursalSel] = useState<Sucursal | null>(null)
  useEffect(() => {
    if (!sucursalId || sucursales.length === 0) return
    setSucursalSel(prev => prev?.id === sucursalId ? prev : (sucursales.find(s => s.id === sucursalId) ?? prev))
  }, [sucursalId, sucursales])
  const [appEncendida, setAppEncendida] = useState<boolean | null>(null)
  const [qrs, setQrs] = useState<Record<string, string>>({})
  const [copiado, setCopiado] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [moduloMesas, setModuloMesas] = useState(false)

  useEffect(() => {
    if (!ctx?.empresaId) return
    Promise.all([
      supabase.from('sucursales').select('id, nombre, slug').eq('empresa_id', ctx.empresaId).eq('activo', true).order('nombre'),
      supabase.from('empresa_config').select('entrada_unificada, modulos').eq('empresa_id', ctx.empresaId).maybeSingle(),
    ]).then(([{ data: sucs }, { data: cfg }]) => {
      const lista = (sucs ?? []) as Sucursal[]
      setSucursales(lista)
      if (lista.length > 0) setSucursalSel(lista.find(s => s.id === sucursalId) ?? lista[0])
      setAppEncendida(cfg?.entrada_unificada === true)
      setModuloMesas(((cfg?.modulos ?? {}) as Record<string, boolean>).mesas === true)
      setCargando(false)
    })
  }, [ctx?.empresaId, supabase])

  // Dominio CANÓNICO de producción SIEMPRE (lección del generador de mesas):
  // estos QR se imprimen y viven en el mundo físico — generados desde un
  // preview igual deben apuntar a producción.
  const urlDe = (path: string) => {
    if (!ctx || !sucursalSel) return ''
    return `https://coneos.com.ar/${ctx.empresaSlug}/${path}/${sucursalSel.slug}`
  }

  // Dibujar los 3 QRs cada vez que cambia la sucursal
  useEffect(() => {
    if (!sucursalSel || !ctx) return
    let vivo = true
    Promise.all(DESTINOS.map(d =>
      QRCode.toDataURL(urlDe(d.path), { width: 640, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } })
        .then(png => [d.id, png] as const)
    )).then(pares => { if (vivo) setQrs(Object.fromEntries(pares)) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalSel, ctx])

  async function copiar(id: string, url: string) {
    try { await navigator.clipboard.writeText(url); setCopiado(id); setTimeout(() => setCopiado(null), 1800) } catch {}
  }

  function descargar(id: string, titulo: string) {
    const png = qrs[id]; if (!png || !sucursalSel || !ctx) return
    const a = document.createElement('a')
    a.href = png
    a.download = `qr-${ctx.empresaSlug}-${sucursalSel.slug}-${id}.png`
    a.click()
  }

  function imprimir(id: string, titulo: string) {
    const png = qrs[id]; if (!png || !sucursalSel) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><title>QR ${titulo}</title></head>
      <body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#fff">
        <img src="${png}" style="width:70vmin;height:70vmin" />
        <p style="font-size:22px;font-weight:800;margin:8px 0 0">${titulo} — ${sucursalSel.nombre}</p>
        <p style="font-size:14px;color:#888;margin:4px 0 0">Escaneá para pedir</p>
        <script>window.onload = () => setTimeout(() => window.print(), 300)</script>
      </body></html>`)
    w.document.close()
  }

  if (ctxLoading || !ctx || cargando) return (
    <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  return (
    <div className="space-y-5">

      <div className="flex items-center gap-2">
        {!sucursalId && sucursales.length > 1 && (
          <select value={sucursalSel?.id ?? ''} onChange={e => setSucursalSel(sucursales.find(s => s.id === e.target.value) ?? null)}
            className="px-3 py-2 rounded-xl border border-neutral-200 text-sm font-semibold bg-white text-neutral-700">
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        {appEncendida === false && (
          <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">⚠️ La App de pedidos está apagada (se enciende en Configuración) — su QR mostrará "no disponible" hasta entonces</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {DESTINOS.map(d => {
          const url = urlDe(d.path)
          return (
            <ConeCard key={d.id}>
              <div className="text-center">
                <p className="font-black text-neutral-800">{d.emoji} {d.titulo}</p>
                <p className="text-xs text-neutral-400 mt-1 min-h-[32px]">{d.desc}</p>
                <div className="my-3 flex justify-center">
                  {qrs[d.id]
                    ? <img src={qrs[d.id]} alt={`QR ${d.titulo}`} className="w-44 h-44 rounded-xl border border-neutral-100" />
                    : <div className="w-44 h-44 rounded-xl border border-neutral-100 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-neutral-200" /></div>}
                </div>
                <p className="text-[11px] text-neutral-400 break-all bg-neutral-50 border border-neutral-100 rounded-lg px-2 py-1.5 mb-3">{url}</p>
                <div className="flex justify-center gap-2">
                  <button onClick={() => copiar(d.id, url)} title="Copiar link"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 text-xs font-bold text-neutral-600 hover:border-neutral-400 transition-colors">
                    {copiado === d.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />} {copiado === d.id ? 'Copiado' : 'Copiar'}
                  </button>
                  <button onClick={() => descargar(d.id, d.titulo)} title="Descargar PNG"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 text-xs font-bold text-neutral-600 hover:border-neutral-400 transition-colors">
                    <Download className="h-3.5 w-3.5" /> PNG
                  </button>
                  <button onClick={() => imprimir(d.id, d.titulo)} title="Imprimir"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 text-xs font-bold text-neutral-600 hover:border-neutral-400 transition-colors">
                    <Printer className="h-3.5 w-3.5" /> Imprimir
                  </button>
                </div>
              </div>
            </ConeCard>
          )
        })}
      </div>

      {/* ═══ MESAS — otra entrada pública más (generador mudado de Admin→Mesas;
          la llave "Recibir pedidos de mesa" sigue en su página) ═══ */}
      {moduloMesas && (
        <div>
          <p className="font-bold text-neutral-800 mb-2">🪑 Mesas</p>
          <QrMesas />
        </div>
      )}

      <p className="text-xs text-neutral-400">💡 Todo lo de esta página es <b>entrada pública</b>: URL estable de producción, sin token — cambiar horarios, servicios o la UI de la App jamás invalida un QR impreso. Los QR para <b>vincular equipos</b> (kiosk, caja, delivery) viven en el tab <b>🔧 Dispositivos</b> de esta misma casa: llevan la llave del equipo y no se reparten a clientes.</p>
    </div>
  )
}
