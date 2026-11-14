'use client'

// ═══════════════════════════════════════════════════════════════════
// DEMOS ANIMADOS DE LA LANDING
// Simulaciones en bucle de pantallas reales de GastrOS (mismos textos,
// secciones y colores). Los datos son de ejemplo. No se muestra nada
// que el sistema no tenga.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, type ReactNode } from 'react'

const AZUL = '#38BDF8'
const NAVY = '#0A1F35'

const money = (n: number) => '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const ESTILOS = `
.gd-in{animation:gd-in .5s ease both}
@keyframes gd-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.gd-press{animation:gd-press .6s ease}
@keyframes gd-press{40%{transform:scale(.93)}}
.gd-glow{animation:gd-glow 1.2s ease}
@keyframes gd-glow{0%,100%{box-shadow:0 0 0 0 rgba(56,189,248,0)}40%{box-shadow:0 0 0 6px rgba(56,189,248,.35)}}
@media (prefers-reduced-motion: reduce){.gd-in,.gd-press,.gd-glow{animation:none}}
`

type Escena = { id: string; label: string; dur: number; render: (t: number) => ReactNode }

// ─── Reproductor genérico: avanza solo, se pausa con el mouse y fuera de pantalla ───
function Demo({ titulo, bajada, escenas, nota }: { titulo: string; bajada: string; escenas: Escena[]; nota: string }) {
  const [idx, setIdx] = useState(0)
  const [t, setT] = useState(0)
  const [pausa, setPausa] = useState(false)
  const [visible, setVisible] = useState(false)
  const [reducido, setReducido] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try { setReducido(window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch { /* sin matchMedia */ }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (pausa || !visible || reducido) return
    const id = setInterval(() => setT(x => x + 1), 900)
    return () => clearInterval(id)
  }, [pausa, visible, reducido])

  useEffect(() => {
    if (t >= escenas[idx].dur) { setIdx(i => (i + 1) % escenas.length); setT(0) }
  }, [t, idx, escenas])

  const esc = escenas[idx]
  const tt = reducido ? esc.dur - 1 : t

  return (
    <div ref={ref} className="max-w-5xl mx-auto"
      onMouseEnter={() => setPausa(true)} onMouseLeave={() => setPausa(false)}
      onFocusCapture={() => setPausa(true)} onBlurCapture={() => setPausa(false)}>
      <h3 className="text-2xl md:text-3xl font-black text-center mb-2">{titulo}</h3>
      <p className="text-slate-300 text-center mb-6">{bajada}</p>
      <div className="flex flex-wrap justify-center gap-2 mb-4">
        {escenas.map((e, i) => (
          <button key={e.id} type="button" onClick={() => { setIdx(i); setT(0) }} aria-pressed={i === idx}
            className="relative overflow-hidden px-4 py-2 rounded-full text-xs font-bold border transition-colors"
            style={i === idx ? { backgroundColor: AZUL, color: NAVY, borderColor: AZUL } : { backgroundColor: 'rgba(255,255,255,.06)', color: '#CBD5E1', borderColor: 'rgba(255,255,255,.18)' }}>
            {e.label}
            {i === idx && <span className="absolute left-0 bottom-0 h-[3px]" style={{ width: `${Math.min(100, ((tt + 1) / esc.dur) * 100)}%`, backgroundColor: NAVY, opacity: 0.35, transition: 'width .9s linear' }} />}
          </button>
        ))}
      </div>
      <div className="rounded-3xl overflow-hidden shadow-2xl shadow-black/50 bg-[#FAFAFA] text-neutral-800 h-[470px]" aria-label={titulo}>
        {esc.render(tt)}
      </div>
      <p className="text-slate-500 text-xs text-center mt-3">{nota}</p>
    </div>
  )
}

// ─── Piezas chicas comunes ───
function Pill({ children, bg, color }: { children: ReactNode; bg: string; color: string }) {
  return <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: bg, color }}>{children}</span>
}
const ESTADO: Record<string, [string, string]> = {
  Pendiente: ['#FEE2E2', '#B91C1C'], Pagado: ['#DBEAFE', '#1D4ED8'], Preparando: ['#FEF3C7', '#B45309'], Listo: ['#DCFCE7', '#15803D'],
}
function Estado({ e }: { e: string }) { const [bg, c] = ESTADO[e]; return <Pill bg={bg} color={c}>{e}</Pill> }
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-neutral-100 shadow-sm ${className}`}>{children}</div>
}
function Toggle({ on }: { on: boolean }) {
  return (
    <span className="inline-block w-11 h-6 rounded-full relative flex-shrink-0 transition-colors duration-500" style={{ backgroundColor: on ? '#1E293B' : '#D4D4D4' }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-500" style={{ left: on ? 22 : 2 }} />
    </span>
  )
}

// ═══════════════ DEMO 1 · PANEL DE ADMINISTRACIÓN ═══════════════
const MENU: [string, string | null][] = [
  ['Dashboard', null], ['Config. del negocio', null], ['Catálogo', 'Config. de productos'], ['Accesorios', null], ['Beneficios', null],
  ['Cobros', 'Administración'], ['Facturas', null], ['Stock', null], ['Ventas', 'Informes'], ['Tráfico', null], ['Configuración', 'Empresa'],
]

function AdminFrame({ activo, children }: { activo: string; children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="hidden sm:block w-48 flex-shrink-0 bg-white border-r border-neutral-100 py-3 px-2 overflow-hidden">
        <div className="px-2 pb-2 text-sm font-bold">Gastr<span style={{ color: AZUL }}>OS</span></div>
        {MENU.map(([label, seccion]) => (
          <div key={label}>
            {seccion && <p className="px-2 pt-2.5 pb-1 text-[9px] font-bold tracking-widest text-neutral-300 uppercase">{seccion}</p>}
            <div className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors duration-500"
              style={label === activo ? { backgroundColor: '#1E293B', color: '#fff' } : { color: '#737373' }}>{label}</div>
          </div>
        ))}
      </aside>
      <div className="flex-1 min-w-0 p-5 overflow-hidden">{children}</div>
    </div>
  )
}

function Stat({ titulo, valor, sub, subColor = '#A3A3A3' }: { titulo: string; valor: string; sub?: string; subColor?: string }) {
  return (
    <Card className="p-4">
      <p className="text-neutral-400 text-xs font-medium mb-2">{titulo}</p>
      <p className="text-xl font-black text-neutral-800">{valor}</p>
      {sub && <p className="text-[11px] mt-1 font-medium" style={{ color: subColor }}>{sub}</p>}
    </Card>
  )
}

const ADMIN: Escena[] = [
  {
    id: 'config', label: '⚙️ Configurar', dur: 7,
    render: t => (
      <AdminFrame activo="Configuración">
        <h4 className="text-xl font-semibold tracking-tight mb-3">Configuración</h4>
        <div className="grid md:grid-cols-2 gap-3">
          <Card className="p-4">
            <p className="font-bold text-sm mb-3">Datos fiscales</p>
            {([['Razón social', 'Mi Negocio S.R.L.'], ['CUIT', '30-12345678-9'], ['Condición IVA', 'Responsable Inscripto'], ['Punto de venta', '1']] as [string, string][]).map(([l, v]) => (
              <div key={l} className="mb-2"><p className="text-[11px] text-neutral-500 mb-0.5">{l}</p><div className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs bg-white">{v}</div></div>
            ))}
          </Card>
          <Card className="p-4">
            <p className="font-bold text-sm mb-3">Configuración de pedidos</p>
            {([['Mostrar productos agotados en el catálogo', true], ['App de pedidos de la marca', true]] as [string, boolean][]).map(([l, on]) => (
              <div key={l} className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2.5 mb-2 text-xs font-semibold"><span>{l}</span><Toggle on={on} /></div>
            ))}
            <div className={`flex items-center justify-between gap-3 rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2.5 mb-2 text-xs font-semibold ${t === 3 ? 'gd-glow' : ''}`}>
              <span>Avisar al cliente si envía un pedido idéntico</span><Toggle on={t >= 3} />
            </div>
            {t >= 4 && (
              <div className="gd-in rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2.5 text-xs">
                <p className="font-semibold mb-1">Comparar pedidos de los últimos (minutos)</p>
                <div className="inline-block rounded-lg border border-neutral-200 bg-white px-3 py-1">30</div>
              </div>
            )}
          </Card>
        </div>
      </AdminFrame>
    ),
  },
  {
    id: 'catalogo', label: '📖 Catálogo', dur: 7,
    render: t => (
      <AdminFrame activo="Catálogo">
        <h4 className="text-xl font-semibold tracking-tight mb-3">Catálogo</h4>
        <div className="inline-flex flex-wrap bg-neutral-100 rounded-xl p-1 mb-4 gap-1">
          {['Catálogo', '🍦 Sabores y opciones', '🏪 Disponibilidad por sucursal', '🎁 Promociones'].map((l, i) => {
            const on = (t < 4 ? 0 : 3) === i
            return <span key={l} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-500" style={on ? { backgroundColor: '#fff', color: '#171717', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: '#A3A3A3' }}>{l}</span>
          })}
        </div>
        {t < 4 ? (
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-50 font-bold text-sm">Helados</div>
            {([['Pote 1 kg', 18000], ['Pote ½ kg', 10500], ['Cucurucho doble', 4200]] as [string, number][]).map(([n, p], i) => (
              <div key={n} className="flex items-center justify-between px-4 py-3 border-t border-neutral-50 text-sm">
                <span className="font-semibold">{n}</span>
                <span className={`font-black px-2 py-0.5 rounded-md ${i === 0 && t >= 2 ? 'gd-glow bg-sky-50' : ''}`}>{money(i === 0 && t >= 2 ? 19500 : p)}</span>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="gd-in p-4">
            <p className="font-bold text-sm mb-1">Promociones y combos</p>
            <p className="text-xs text-neutral-500 mb-3">Combos con precio especial, con vigencia y en todos los canales.</p>
            <div className="flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-sm">
              <span className="font-semibold">🎁 Combo familiar</span>
              <span><span className="text-neutral-400 line-through text-xs mr-2">{money(26000)}</span><b>{money(22500)}</b></span>
            </div>
          </Card>
        )}
      </AdminFrame>
    ),
  },
  {
    id: 'dash', label: '📊 Métricas del Dashboard', dur: 7,
    render: t => {
      const k = Math.min(1, (t + 1) / 3)
      return (
        <AdminFrame activo="Dashboard">
          <p className="text-neutral-500 text-sm">Buen día</p>
          <h4 className="text-2xl font-semibold tracking-tight mb-3">Dashboard</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Stat titulo="Ventas hoy" valor={money(184500 * k)} sub={t >= 2 ? `↑ ${money(22300)} vs ayer` : ' '} subColor="#22C55E" />
            <Stat titulo="Pedidos hoy" valor={String(Math.round(42 * k))} sub="Ticket promedio: $4.393" />
            <Stat titulo="Sucursales" valor="3" sub="8 operadores activos" />
            <Stat titulo="Catálogo" valor="34" sub="Productos activos" />
          </div>
          {t >= 3 && (
            <Card className="gd-in overflow-hidden mb-3 border-amber-200">
              <div className="px-4 py-2.5 flex justify-between bg-amber-50/60 text-sm"><b>Stock por reponer</b><span className="text-xs font-semibold text-amber-700">1 agotados · 1 bajos</span></div>
              {([['Agotado', '#FEE2E2', '#B91C1C', 'Dulce de leche'], ['3 u.', '#FEF3C7', '#B45309', 'Cucuruchos']] as [string, string, string, string][]).map(([l, bg, c, p]) => (
                <div key={p} className="flex items-center gap-2 px-4 py-2 border-t border-neutral-50 text-xs"><Pill bg={bg} color={c}>{l}</Pill><b>{p}</b></div>
              ))}
            </Card>
          )}
          {t >= 5 && (
            <Card className="gd-in overflow-hidden">
              <div className="px-4 py-2.5 text-sm font-bold">Pedidos activos hoy</div>
              {([['#131', 'Pendiente', 'Ahora', 6850], ['#130', 'Preparando', 'Hace 9 min', 3900]] as [string, string, string, number][]).map(([n, e, h, m]) => (
                <div key={n} className="flex items-center justify-between px-4 py-2 border-t border-neutral-50 text-xs"><span className="flex items-center gap-2"><b className="text-sm">{n}</b><Estado e={e} /></span><span className="flex gap-3"><span className="text-neutral-400">{h}</span><b>{money(m)}</b></span></div>
              ))}
            </Card>
          )}
        </AdminFrame>
      )
    },
  },
  {
    id: 'ventas', label: '💰 Ventas', dur: 7,
    render: t => (
      <AdminFrame activo="Ventas">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xl font-semibold tracking-tight">Ventas</h4>
          <span className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-neutral-800 text-white ${t === 5 ? 'gd-press' : ''}`}>📥 Exportar CSV</span>
        </div>
        <div className="inline-flex bg-neutral-100 rounded-xl p-1 mb-3 gap-1">
          {['Resumen', 'Historial', 'Arqueo'].map((l, i) => <span key={l} className="px-4 py-1.5 rounded-lg text-[11px] font-semibold" style={i === 0 ? { backgroundColor: '#fff', color: '#171717', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: '#A3A3A3' }}>{l}</span>)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <Stat titulo="Facturación" valor={money(486000 * Math.min(1, (t + 1) / 3))} />
          <Stat titulo="Pedidos" valor={String(Math.round(92 * Math.min(1, (t + 1) / 3)))} />
          <Stat titulo="Ticket promedio" valor={money(5280)} />
          <Stat titulo="Métodos de pago" valor="3 medios" sub="Efectivo, Mercado Pago y Transferencia" />
        </div>
        {t >= 3 && (
          <Card className="gd-in overflow-hidden">
            <div className="px-4 py-2.5 text-sm font-bold">Productos más vendidos</div>
            {([['Pote 1 kg', 38], ['Cucurucho doble', 31], ['Pote ½ kg', 22]] as [string, number][]).map(([n, c]) => (
              <div key={n} className="px-4 py-2 border-t border-neutral-50 text-xs">
                <div className="flex justify-between mb-1"><b>{n}</b><span className="text-neutral-500">{c} u.</span></div>
                <div className="h-1.5 rounded-full bg-neutral-100"><div className="h-1.5 rounded-full bg-neutral-700 transition-all duration-1000" style={{ width: `${(c / 38) * 100}%` }} /></div>
              </div>
            ))}
          </Card>
        )}
      </AdminFrame>
    ),
  },
]

// ═══════════════ DEMO 2 · UN PEDIDO REAL, DE LA CAJA A LA PUERTA ═══════════════
function Barra({ titulo, derecha }: { titulo: string; derecha?: ReactNode }) {
  return <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-neutral-100"><b className="text-sm">{titulo}</b>{derecha}</div>
}
const EN_VIVO = <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ backgroundColor: AZUL, color: NAVY }}>EN VIVO</span>

function CajaRow({ n, tag, monto, estado, nuevo }: { n: string; tag: string; monto: number; estado: string; nuevo?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-5 py-3 border-b border-neutral-50 text-sm bg-white ${nuevo ? 'gd-in' : ''}`}>
      <span className="flex items-center gap-2"><b>{n}</b><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">{tag}</span><Estado e={estado} /></span>
      <b>{money(monto)}</b>
    </div>
  )
}

function DisplayCard({ n, tag }: { n: string; tag: string }) {
  return (
    <div className="gd-in flex flex-col items-center bg-white rounded-2xl shadow-sm border border-neutral-100 px-4 py-3" style={{ minWidth: 96 }}>
      <p className="font-black leading-none text-neutral-700 text-3xl">{n}</p>
      <p className="text-[9px] font-black tracking-wider text-neutral-400 mt-1.5">{tag}</p>
    </div>
  )
}

// Recorrido de la moto (coordenadas en un lienzo 300×150)
const RUTA: [number, number][] = [[14, 122], [14, 72], [54, 72], [92, 60], [92, 30], [150, 30], [200, 30], [200, 92], [270, 92]]
const PASOS = ['Recibido', 'Confirmado', 'Preparando', 'En camino', 'Entregado']

const OPERACION: Escena[] = [
  {
    id: 'caja', label: '1 · Entra en Caja', dur: 7,
    render: t => (
      <div className="h-full flex flex-col">
        <Barra titulo="Caja · Casa Central" derecha={EN_VIVO} />
        <div className="flex-1 overflow-hidden">
          <CajaRow n="#130" tag="🍽️ MESA 6" monto={3900} estado="Preparando" />
          <CajaRow n="#129" tag="🛒 KIOSCO" monto={5400} estado="Listo" />
          {t >= 1 && <CajaRow n="#131" tag="🛵 DELIVERY" monto={6850} estado={t >= 5 ? 'Preparando' : 'Pendiente'} nuevo />}
          {t >= 2 && t < 5 && (
            <div className="gd-in m-4 rounded-2xl border border-neutral-100 bg-white shadow-sm p-4">
              <p className="font-bold text-sm mb-1">Pedido #131 · Delivery</p>
              <p className="text-xs text-neutral-500 mb-3">Pago: Transferencia · {money(6850)}</p>
              <span className={`inline-block px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-green-600 ${t === 4 ? 'gd-press' : ''}`}>✓ Confirmar pago</span>
            </div>
          )}
          {t >= 5 && <p className="gd-in text-center text-xs font-semibold text-green-700 mt-4">Pago confirmado: el pedido pasa solo a preparación.</p>}
        </div>
      </div>
    ),
  },
  {
    id: 'prep', label: '2 · Se prepara y se ve en el Display', dur: 8,
    render: t => (
      <div className="h-full grid md:grid-cols-2">
        <div className="flex flex-col border-r border-neutral-100 bg-neutral-50">
          <Barra titulo="Preparación" />
          <div className="p-5">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white rounded-2xl border border-neutral-100 p-3 text-center"><p className="text-2xl font-black">3</p><p className="text-[11px] text-neutral-400">Total activos</p></div>
              <div className="bg-amber-50 rounded-2xl border border-amber-100 p-3 text-center"><p className="text-2xl font-black text-amber-600">{t >= 5 ? 2 : 3}</p><p className="text-[11px] text-amber-400">Preparando</p></div>
            </div>
            <Card className="gd-in p-4">
              <p className="font-black text-lg">#131 <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 align-middle">🛵 DELIVERY</span></p>
              <p className="text-xs text-neutral-500 my-2">Pote 1 kg — Dulce de leche, Frutilla, Chocolate</p>
              <span className={`inline-block px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-neutral-800 ${t === 5 ? 'gd-press' : ''}`}>✓ Marcar listo</span>
            </Card>
          </div>
        </div>
        <div className="hidden md:flex flex-col bg-neutral-50">
          <Barra titulo="Display de mostrador" />
          <div className="grid grid-cols-2 gap-4 p-5">
            <div>
              <p className="text-xs font-black tracking-widest text-neutral-400 uppercase mb-3">En preparación</p>
              <div className="flex flex-wrap gap-2">
                <DisplayCard n="#129" tag="🛒 KIOSCO" />
                {t >= 1 && t < 6 && <DisplayCard n="#131" tag="🛵 DELIVERY" />}
              </div>
            </div>
            <div>
              <p className="text-xs font-black tracking-widest uppercase mb-3" style={{ color: '#16A34A' }}>✅ Para retirar</p>
              <div className="flex flex-wrap gap-2">{t >= 6 && <DisplayCard n="#131" tag="🛵 DELIVERY" />}</div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'cadete', label: '3 · Se asigna el cadete', dur: 6,
    render: t => (
      <div className="h-full relative bg-neutral-50">
        <Barra titulo="Caja · Casa Central" derecha={EN_VIVO} />
        <CajaRow n="#131" tag="🛵 DELIVERY" monto={6850} estado="Listo" />
        <div className="absolute inset-0 top-12 bg-black/10 flex items-center justify-center">
          <div className="gd-in bg-white rounded-2xl shadow-xl p-5 w-[300px]">
            <p className="font-bold text-lg mb-3">Asignar cadete</p>
            {['🛵 Martín', '🛵 Sofía'].map((c, i) => (
              <div key={c} className="rounded-xl border px-3 py-2.5 mb-2 text-sm font-semibold transition-colors duration-500"
                style={t >= 2 && i === 0 ? { borderColor: AZUL, backgroundColor: 'rgba(56,189,248,.1)' } : { borderColor: '#E5E5E5' }}>{c}</div>
            ))}
            <span className={`block text-center mt-3 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-colors duration-500 ${t === 4 ? 'gd-press' : ''}`} style={{ backgroundColor: t >= 5 ? '#16A34A' : '#1E293B' }}>
              {t >= 5 ? '✓ Asignado' : '🛵 Asignar e imprimir comanda'}
            </span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'moto', label: '4 · La moto lleva el pedido', dur: 11,
    render: t => {
      const i = Math.min(t, RUTA.length - 1)
      const entregado = t >= RUTA.length
      const paso = entregado ? 4 : 3
      const [x, y] = RUTA[i]
      return (
        <div className="h-full bg-neutral-50 p-5 overflow-hidden">
          <p className="text-center text-sm font-bold text-neutral-700 mb-3">Seguimiento de tu pedido #131</p>
          <Card className="p-3 mb-3">
            <div className="relative w-full overflow-hidden rounded-xl" style={{ height: 175, backgroundColor: '#E8F0E6' }}>
              <svg viewBox="0 0 300 150" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
                <polyline points="0,122 60,122 60,72 130,72 130,30 300,30" fill="none" stroke="#fff" strokeWidth="9" vectorEffect="non-scaling-stroke" />
                <polyline points="200,0 200,150" fill="none" stroke="#fff" strokeWidth="9" vectorEffect="non-scaling-stroke" />
                <polyline points="0,92 300,92" fill="none" stroke="#fff" strokeWidth="9" vectorEffect="non-scaling-stroke" />
                <polyline points={RUTA.map(p => p.join(',')).join(' ')} fill="none" stroke={AZUL} strokeWidth="3.5" strokeDasharray="7 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="absolute text-lg" style={{ left: '4%', top: '78%' }} title="Local">🏪</span>
              <span className="absolute text-lg" style={{ left: '90%', top: '52%' }} title="Tu casa">🏠</span>
              <span className="absolute text-2xl" style={{ left: `${(x / 300) * 100}%`, top: `${(y / 150) * 100}%`, transform: 'translate(-50%,-60%)', transition: 'left .9s linear, top .9s linear' }}>🛵</span>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center">
              {PASOS.map((p, k) => {
                const hecho = k <= paso
                return (
                  <div key={p} className="flex flex-col items-center flex-1">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center mb-1 transition-colors duration-500" style={{ backgroundColor: hecho ? (k === paso ? AZUL : 'rgba(56,189,248,.35)') : '#F5F5F5' }}>
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: hecho ? '#fff' : '#D4D4D4' }} />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: hecho ? '#262626' : '#A3A3A3' }}>{p}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-center text-xs font-semibold text-neutral-600 mt-3">{entregado ? '¡Entregado! Buen provecho 🎉' : '🛵 Martín va a llevar tu pedido'}</p>
          </Card>
        </div>
      )
    },
  },
]

export default function DemoVideos() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ESTILOS }} />
      <div className="space-y-20">
        <Demo
          titulo="Recorré el panel de administración"
          bajada="Configurá, armá tu catálogo y mirá las métricas y las ventas de tu negocio."
          escenas={ADMIN}
          nota="Simulación con datos de ejemplo. Las pantallas y secciones son las del sistema."
        />
        <Demo
          titulo="Un pedido real, de la Caja a la puerta"
          bajada="Se activa en la Caja, se prepara y aparece en el Display, sale con el cadete y llega a destino."
          escenas={OPERACION}
          nota="Simulación con datos de ejemplo. Los pasos y pantallas son los del sistema."
        />
      </div>
    </>
  )
}
