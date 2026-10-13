'use client'

// ═══════════════════════════════════════════════════════════════════
// QR PÚBLICO — "Este es tu QR para pedir" (reorganizado JC/CTO 13/10)
// UN solo QR destacado para clientes por empresa:
//   📱 App de pedidos → /{empresa}/pedidos  (el cliente elige sucursal y canal;
//      con 1 sola sucursal la página redirige directo)
// Opción secundaria, dentro de "Otros accesos" (colapsado):
//   QR de UNA sola sucursal → /{empresa}/pedidos/{sucursal}
// Se RETIRAN de esta pantalla (solo la tarjeta; las RUTAS siguen vivas y
// funcionando — /delivery/{sucursal} también la usan los dispositivos
// DELIVERY vinculados con ?token=): Delivery directo, Take Away directo.
// El QR de CADETES se muestra ahora en Equipo → Colaboradores.
// REGLAS DEL CICLO:
//  - Sin tabla nueva: el QR público ES una URL estable dibujada
//  - COMPLETAMENTE separado del QR-token de dispositivos (operación)
//  - /[empresa]/d (link corto de dispositivo, Federal) NO se toca
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeCard } from '@/components/admin/ConeComponents'
import { Loader2, Copy, Download, Printer, Check } from 'lucide-react'
import QRCode from 'qrcode'
import QrMesas from '@/components/admin/QrMesas'

interface Sucursal { id: string; nombre: string; slug: string }

// QR PRINCIPAL: toda la empresa (un solo acceso destacado para clientes)
const DESTINO_EMPRESA = { id: 'app-empresa', emoji: '📱', titulo: 'App de pedidos', desc: 'Un solo QR para toda la empresa: el cliente elige sucursal y canal (Delivery o Take Away) y ve los horarios. Con una sola sucursal entra directo. Es el que se recomienda imprimir.', path: 'pedidos-empresa' }
// OPCIÓN SECUNDARIA: una sola sucursal (dentro de "Otros accesos")
const DESTINO_SUCURSAL = { id: 'app', emoji: '📱', titulo: 'App de pedidos — una sucursal', desc: 'Para un cartel o un local puntual: entra a la App de esa sucursal.', path: 'pedidos' }

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
    if (!ctx) return ''
    // QR de empresa: URL sin sucursal — el selector vive en la página
    if (path === 'pedidos-empresa') return `https://coneos.com.ar/${ctx.empresaSlug}/pedidos`
    if (!sucursalSel) return ''
    return `https://coneos.com.ar/${ctx.empresaSlug}/${path}/${sucursalSel.slug}`
  }

  const destinos = [DESTINO_EMPRESA, ...(sucursalSel ? [DESTINO_SUCURSAL] : [])]

  // Dibujar los QRs cada vez que cambia la sucursal (o el set de destinos)
  useEffect(() => {
    if (!ctx) return
    let vivo = true
    Promise.all(destinos.map(d =>
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
    const png = qrs[id]; if (!png || !ctx) return
    if (id !== 'app-empresa' && !sucursalSel) return
    const a = document.createElement('a')
    a.href = png
    a.download = id === 'app-empresa' ? `qr-${ctx.empresaSlug}-pedidos.png` : `qr-${ctx.empresaSlug}-${sucursalSel!.slug}-${id}.png`
    a.click()
  }

  function imprimir(id: string, titulo: string) {
    const png = qrs[id]; if (!png) return
    if (id !== 'app-empresa' && !sucursalSel) return
    const rotulo = id === 'app-empresa' ? titulo : `${titulo} — ${sucursalSel!.nombre}`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><title>QR ${titulo}</title></head>
      <body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#fff">
        <img src="${png}" style="width:70vmin;height:70vmin" />
        <p style="font-size:22px;font-weight:800;margin:8px 0 0">${rotulo}</p>
        <p style="font-size:14px;color:#888;margin:4px 0 0">Escaneá para pedir</p>
        <script>window.onload = () => setTimeout(() => window.print(), 300)</script>
      </body></html>`)
    w.document.close()
  }

  const tarjeta = (d: { id: string; emoji: string; titulo: string; desc: string; path: string }) => {
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
  }

  if (ctxLoading || !ctx || cargando) return (
    <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  return (
    <div className="space-y-5">

      {appEncendida === false && (
        <span className="inline-block text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">⚠️ La App de pedidos está apagada (se enciende en Configuración) — su QR mostrará "no disponible" hasta entonces</span>
      )}

      {/* ═══ QR PRINCIPAL — un solo acceso destacado para clientes ═══ */}
      <div className="max-w-md">{tarjeta(DESTINO_EMPRESA)}</div>

      {/* ═══ OTROS ACCESOS — opción secundaria, colapsado ═══ */}
      <details className="group rounded-2xl border border-neutral-100 bg-white">
        <summary className="cursor-pointer select-none px-5 py-3 text-sm font-bold text-neutral-600 hover:text-neutral-800">Otros accesos — QR de una sola sucursal</summary>
        <div className="px-5 pb-5 space-y-4">
          {!sucursalId && sucursales.length > 1 && (
            <select value={sucursalSel?.id ?? ''} onChange={e => setSucursalSel(sucursales.find(s => s.id === e.target.value) ?? null)}
              className="px-3 py-2 rounded-xl border border-neutral-200 text-sm font-semibold bg-white text-neutral-700">
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
          {sucursalSel && <div className="max-w-md">{tarjeta(DESTINO_SUCURSAL)}</div>}
        </div>
      </details>

      {/* ═══ MESAS — otra entrada pública más (generador mudado de Admin→Mesas;
          la llave "Recibir pedidos de mesa" sigue en su página) ═══ */}
      {moduloMesas && (
        <div>
          <p className="font-bold text-neutral-800 mb-2">🪑 Mesas</p>
          <QrMesas sucursalId={sucursalSel?.id} />
        </div>
      )}

      <p className="text-xs text-neutral-400">💡 Todo lo de esta página es <b>entrada pública</b>: URL estable de producción, sin token — cambiar horarios, servicios o la UI de la App jamás invalida un QR impreso. Los QR para <b>vincular equipos</b> (kiosk, caja, delivery) viven en el tab <b>🔧 Dispositivos</b>: llevan la llave del equipo y no se reparten a clientes. El acceso de los <b>cadetes</b> está en <b>Equipo → Colaboradores</b>.</p>
    </div>
  )
}
