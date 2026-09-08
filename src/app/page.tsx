import type { Metadata } from 'next'
import { LANDING, waLink } from '@/lib/landing.config'

// ═══ SEO ═══
export const metadata: Metadata = {
  title: 'ConeOS — Todo tu negocio gastronómico, en un solo lugar',
  description: 'Pedidos, caja, delivery, mesas, preparación, pagos, facturación y gestión. ConeOS conecta toda la operación de tu negocio gastronómico para que vendas más y trabajes mejor.',
  openGraph: {
    title: 'ConeOS — Todo tu negocio gastronómico, en un solo lugar',
    description: 'Kiosco, delivery, mesas con QR, caja, preparación, Mercado Pago y facturación ARCA. Una sola plataforma, configurable para cada rubro.',
    type: 'website',
    locale: 'es_AR',
  },
  robots: { index: true, follow: true },
}

// ═══ Paleta del logo ═══
const NAVY = '#1B2A4A'
const AZUL = '#2F7DE1'
const VERDE = '#34A853'
const AMARILLO = '#F6B91C'
const ROJO = '#EA4350'

const MODULOS = [
  { emoji: '🛒', color: AZUL, title: 'Kiosco / Autopedido', desc: 'El cliente arma su pedido desde un celular, tablet o tótem, con fotos y opciones de cada producto.' },
  { emoji: '📱', color: VERDE, title: 'Delivery', desc: 'Pedidos online con datos del cliente, envío, cadetes con comanda, pagos y horarios por sucursal.' },
  { emoji: '🍽️', color: AMARILLO, title: 'Mesas', desc: 'QR por mesa, pedidos desde el celular, cuenta abierta que suma y cobro — incluso dividido entre varios medios.' },
  { emoji: '💰', color: ROJO, title: 'Caja', desc: 'Todos los pedidos en un solo lugar: medios de pago, comprobantes, resumen del día y control por canal.' },
  { emoji: '👨‍🍳', color: AZUL, title: 'Preparación', desc: 'Los pedidos llegan automáticamente al área correspondiente, con el detalle exacto de cada unidad.' },
  { emoji: '🖥️', color: VERDE, title: 'Display', desc: 'Pantalla de pedidos listos para organizar la preparación y la entrega en el local.' },
  { emoji: '🧾', color: NAVY, title: 'Facturación', desc: 'Integración con ARCA para facturación electrónica: comprobante con CAE y QR fiscal desde la misma venta.' },
  { emoji: '💳', color: AZUL, title: 'Mercado Pago', desc: 'Cobros integrados usando la cuenta de Mercado Pago del comercio. La plata va directo a tu cuenta.' },
  { emoji: '👥', color: ROJO, title: 'Clientes y beneficios', desc: 'Identificación por teléfono, puntos por compra y canjes configurables. Sin registros ni contraseñas.' },
  { emoji: '📊', color: AMARILLO, title: 'Gestión', desc: 'Ventas, productos, opciones, sucursales, equipo, dispositivos, horarios y métricas del negocio.' },
]

const RUBROS: [string, string][] = [
  ['🍦', 'Heladerías'], ['🍔', 'Hamburgueserías'], ['🍕', 'Pizzerías'], ['🍣', 'Sushi'],
  ['🍽️', 'Restaurantes'], ['🍺', 'Bares'], ['☕', 'Cafeterías'], ['🥩', 'Parrillas'], ['➕', 'Otros negocios'],
]

const FLUJO = [
  { n: '1', color: AZUL, t: 'El cliente pide', d: 'Kiosco · QR de mesa · Delivery · Pedido manual' },
  { n: '2', color: VERDE, t: 'El pedido entra', d: 'Todos los canales llegan a ConeOS, con su número y detalle.' },
  { n: '3', color: AMARILLO, t: 'Se prepara', d: 'El equipo recibe exactamente qué tiene que preparar.' },
  { n: '4', color: ROJO, t: 'Se cobra', d: 'Caja registra el pago: efectivo, transferencia o Mercado Pago.' },
  { n: '5', color: NAVY, t: 'Se entrega', d: 'El pedido queda finalizado y trazable de punta a punta.' },
]

const FAQ: [string, string][] = [
  ['¿ConeOS sirve solamente para heladerías?', 'No. ConeOS está diseñado para distintos tipos de negocios gastronómicos: el catálogo y la operación se configuran según cada rubro.'],
  ['¿Puedo usarlo en varias sucursales?', 'Sí, la plataforma está preparada para operación multisucursal, manteniendo la información de cada una organizada.'],
  ['¿Necesito comprar hardware?', 'El hardware no está incluido. ConeOS funciona en celulares, tablets, tótems y otros dispositivos compatibles según el módulo.'],
  ['¿Puedo recibir pedidos por QR?', 'Sí. Cada mesa puede tener su QR, y el pedido cae directo a preparación.'],
  ['¿Puedo trabajar con delivery?', 'Sí, con formulario de entrega, cadetes y horarios configurables por sucursal.'],
  ['¿Puedo integrar Mercado Pago?', 'Sí. Se integra con la cuenta de Mercado Pago del comercio: los cobros van directo a tu cuenta.'],
  ['¿Puedo facturar desde ConeOS?', 'Sí, mediante la integración fiscal correspondiente con ARCA: el comprobante sale con CAE y QR desde la misma venta.'],
  ['¿Tengo que cambiar mi forma de trabajar?', 'No necesariamente. ConeOS se configura según la operación del negocio: podés empezar por un canal y sumar el resto cuando quieras.'],
  ['¿Me ayudan con la implementación?', 'Sí. La implementación incluye configuración, capacitación y acompañamiento inicial.'],
]

const chip = (bg: string) => ({ backgroundColor: bg + '14', color: bg })

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900">

      {/* NAV */}
      <nav className="border-b border-neutral-100 px-6 md:px-8 py-4 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm z-50">
        <div className="flex items-center gap-2.5">
          <img src="/coneos-icon.png" alt="ConeOS" className="w-8 h-8 rounded-xl" />
          <span className="font-bold text-lg">Cone<span style={{ color: AZUL }}>OS</span></span>
        </div>
        <div className="flex items-center gap-5">
          <a href="#funciones" className="text-neutral-500 text-sm hover:text-neutral-800 transition-colors hidden md:block">Funcionalidades</a>
          <a href="#rubros" className="text-neutral-500 text-sm hover:text-neutral-800 transition-colors hidden md:block">Soluciones</a>
          <a href="#precios" className="text-neutral-500 text-sm hover:text-neutral-800 transition-colors hidden md:block">Precios</a>
          <a href="#faq" className="text-neutral-500 text-sm hover:text-neutral-800 transition-colors hidden md:block">FAQ</a>
          <a href="#contacto" className="px-4 py-2 text-white text-sm font-semibold rounded-xl transition-colors" style={{ backgroundColor: NAVY }}>Quiero una demo</a>
        </div>
      </nav>

      {/* HERO */}
      <section className="px-6 md:px-8 pt-16 pb-12 max-w-5xl mx-auto text-center">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-[1.05] mb-5">
          Todo tu negocio gastronómico,<br />en <span style={{ color: AZUL }}>un solo lugar</span>.
        </h1>
        <p className="text-neutral-500 text-lg md:text-xl max-w-2xl mx-auto mb-8 leading-relaxed">
          Pedidos, caja, delivery, mesas, preparación, pagos y gestión. ConeOS conecta toda la
          operación de tu negocio para que vendas más y trabajes mejor.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap mb-14">
          <a href="#contacto" className="px-8 py-4 text-white font-bold rounded-2xl text-base transition-transform hover:-translate-y-0.5" style={{ backgroundColor: NAVY }}>Quiero una demo</a>
          <a href="#flujo" className="px-8 py-4 border border-neutral-200 text-neutral-600 font-semibold rounded-2xl text-base hover:bg-neutral-50 transition-colors">Ver cómo funciona</a>
        </div>

        {/* Visual: tres pantallas del producto conectadas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
          <div className="bg-neutral-50 border border-neutral-100 rounded-3xl p-5">
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3">El cliente pide</p>
            <div className="bg-white rounded-2xl border border-neutral-100 p-4 shadow-sm">
              <p className="text-xs text-neutral-400 mb-2">🍔 Hamburguesa Doble</p>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {['Cheddar', 'Panceta', 'Huevo'].map(o => (
                  <span key={o} className="text-[10px] font-semibold px-2 py-1 rounded-full" style={chip(AZUL)}>{o}</span>
                ))}
              </div>
              <div className="rounded-xl py-2.5 text-center text-white text-xs font-bold" style={{ backgroundColor: VERDE }}>Agregar — $12.000</div>
            </div>
          </div>
          <div className="bg-neutral-50 border border-neutral-100 rounded-3xl p-5">
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3">La caja lo ve al instante</p>
            <div className="bg-white rounded-2xl border border-neutral-100 p-4 shadow-sm space-y-2">
              {([['#14', 'Delivery', AZUL, '$23.000'], ['#13', 'Mesa 4', AMARILLO, '$18.500'], ['#12', 'Kiosco', VERDE, '$9.000']] as [string, string, string, string][]).map(([num, canal, color, total]) => (
                <div key={num} className="flex items-center justify-between text-xs">
                  <span className="font-bold">{num}</span>
                  <span className="font-semibold px-2 py-0.5 rounded-full text-[10px]" style={chip(color)}>{canal}</span>
                  <span className="font-bold">{total}</span>
                </div>
              ))}
              <div className="border-t border-dashed border-neutral-200 pt-2 flex justify-between text-xs">
                <span className="text-neutral-400">Hoy</span><span className="font-black">$50.500 · 3 pedidos</span>
              </div>
            </div>
          </div>
          <div className="bg-neutral-50 border border-neutral-100 rounded-3xl p-5">
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3">Cocina y ticket, solos</p>
            <div className="bg-white rounded-2xl border border-neutral-100 p-4 shadow-sm font-mono text-[11px] leading-relaxed">
              <p className="text-center font-black text-lg">#13</p>
              <p className="border-b border-dashed border-neutral-300 pb-1 mb-1">1× Doble — cheddar · panceta</p>
              <p className="border-b border-dashed border-neutral-300 pb-1 mb-1">1× Papas grandes</p>
              <div className="flex justify-between font-black"><span>TOTAL</span><span>$18.500</span></div>
              <p className="text-center text-[9px] text-neutral-400 mt-1">CAE + QR fiscal en el ticket</p>
            </div>
          </div>
        </div>
      </section>

      {/* BARRA DE CONFIANZA */}
      <section className="px-6 md:px-8 py-10 border-y border-neutral-100 bg-neutral-50/60">
        <div className="max-w-4xl mx-auto text-center">
          <p className="font-black text-lg mb-5">Una plataforma. Toda la operación.</p>
          <div className="flex items-center justify-center gap-2 flex-wrap text-xs font-bold mb-4">
            {['KIOSCO', 'PEDIDOS', 'CAJA', 'PREPARACIÓN', 'ENTREGA'].map((p, i, arr) => (
              <span key={p} className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-full text-white" style={{ backgroundColor: [AZUL, VERDE, ROJO, AMARILLO, NAVY][i] }}>{p}</span>
                {i < arr.length - 1 && <span className="text-neutral-300">→</span>}
              </span>
            ))}
          </div>
          <p className="text-neutral-400 text-xs font-semibold tracking-widest">MESAS · DELIVERY · PAGOS · FISCAL · CLIENTES · REPORTES</p>
        </div>
      </section>

      {/* EL PROBLEMA */}
      <section className="px-6 md:px-8 py-20 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-black mb-6">Tu negocio no debería funcionar<br />con cinco sistemas distintos.</h2>
        <div className="flex flex-wrap justify-center gap-2 mb-6 text-sm text-neutral-500">
          {['Pedidos por WhatsApp', 'Mesas por un lado', 'Caja por otro', 'Delivery manual', 'Comandas impresas', 'Pagos difíciles de controlar'].map(p => (
            <span key={p} className="px-3 py-1.5 bg-neutral-50 border border-neutral-100 rounded-full">{p}</span>
          ))}
        </div>
        <p className="text-neutral-600 text-lg leading-relaxed">
          ConeOS unifica la operación para que cada pedido tenga <b>trazabilidad desde que entra
          hasta que se cobra y se entrega</b>.
        </p>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funciones" className="px-6 md:px-8 py-20 bg-neutral-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-black text-center mb-3">Todo lo que necesitás para operar</h2>
          <p className="text-neutral-500 text-center mb-12 text-lg">Diez módulos integrados, un solo sistema.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODULOS.map(m => (
              <div key={m.title} className="bg-white rounded-2xl border border-neutral-100 p-6 border-t-4 transition-shadow hover:shadow-md" style={{ borderTopColor: m.color }}>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-4" style={{ backgroundColor: m.color + '14' }}>{m.emoji}</div>
                <h3 className="font-bold mb-2">{m.title}</h3>
                <p className="text-neutral-500 text-sm leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RUBROS */}
      <section id="rubros" className="px-6 md:px-8 py-20 max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-black mb-3">ConeOS se adapta a tu negocio</h2>
        <p className="text-neutral-500 text-lg mb-10">Una misma plataforma, configurable. No son productos distintos: es tu catálogo y tu operación, con tus nombres.</p>
        <div className="flex flex-wrap justify-center gap-3">
          {RUBROS.map(([emoji, nombre], i) => (
            <span key={nombre} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-neutral-100 rounded-2xl text-sm font-semibold shadow-sm border-b-2" style={{ borderBottomColor: [AZUL, VERDE, AMARILLO, ROJO, NAVY][i % 5] }}>
              <span className="text-xl">{emoji}</span>{nombre}
            </span>
          ))}
        </div>
        <p className="text-neutral-400 text-sm mt-8">ConeOS adapta su catálogo y operación a la forma en que trabaja cada negocio.</p>
      </section>

      {/* FLUJO */}
      <section id="flujo" className="px-6 md:px-8 py-20" style={{ backgroundColor: NAVY }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-black text-white text-center mb-12">Del pedido a la entrega,<br />sin perder el control</h2>
          <div>
            {FLUJO.map((f, i) => (
              <div key={f.n} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black flex-shrink-0" style={{ backgroundColor: f.color }}>{f.n}</div>
                  {i < FLUJO.length - 1 && <div className="w-px flex-1 bg-white/15 my-1" />}
                </div>
                <div className={i < FLUJO.length - 1 ? 'pb-8' : ''}>
                  <h3 className="text-white font-bold text-lg">{f.t}</h3>
                  <p className="text-white/60 text-sm">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RÁPIDO */}
      <section className="px-6 md:px-8 py-20 max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-black mb-4">Diseñado para trabajar rápido</h2>
        <p className="text-neutral-500 text-lg mb-8">Porque en gastronomía cada segundo cuenta.</p>
        <div className="flex flex-wrap justify-center gap-2 mb-10 text-sm">
          {['Interfaz táctil', 'Celular', 'Tablet', 'Tótem', 'Pantallas horizontales', 'Responsive', 'Instalable como app (PWA)', 'Operación simple'].map(t => (
            <span key={t} className="px-3.5 py-2 bg-neutral-50 border border-neutral-100 rounded-full font-semibold text-neutral-600">{t}</span>
          ))}
        </div>
        <div className="rounded-3xl border-2 p-8 md:p-10" style={{ borderColor: AZUL, backgroundColor: AZUL + '08' }}>
          <p className="text-2xl md:text-3xl font-black leading-snug" style={{ color: NAVY }}>
            ConeOS está diseñado para <span style={{ color: AZUL }}>no hacer más lento</span> el proceso de venta.
          </p>
        </div>
      </section>

      {/* ADMINISTRACIÓN */}
      <section className="px-6 md:px-8 py-20 bg-neutral-50">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-black mb-4">Vos controlás el negocio.</h2>
            <p className="text-neutral-500 mb-6 leading-relaxed">Toda la configuración de tu negocio desde un único lugar.</p>
            <div className="flex flex-wrap gap-2 text-xs font-semibold text-neutral-600">
              {['Ventas', 'Productos', 'Categorías', 'Sucursales', 'Usuarios', 'Dispositivos', 'Mesas', 'Beneficios', 'Facturación', 'Configuración'].map(t => (
                <span key={t} className="px-3 py-1.5 bg-white border border-neutral-100 rounded-full">{t}</span>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-3xl border border-neutral-100 shadow-sm overflow-hidden">
            <div className="border-b border-neutral-100 px-4 py-2.5 flex items-center gap-2">
              <img src="/coneos-icon.png" alt="" className="w-5 h-5 rounded-md" />
              <span className="text-xs font-bold">Cone<span style={{ color: AZUL }}>OS</span> · Dashboard</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {([['Ventas de hoy', '$486.000', VERDE], ['Pedidos', '92', AZUL], ['Ticket promedio', '$5.280', AMARILLO], ['Por canal', 'K 41 · D 32 · M 19', ROJO]] as [string, string, string][]).map(([l, v, c]) => (
                <div key={l} className="rounded-2xl border border-neutral-100 p-3">
                  <p className="text-[10px] text-neutral-400 font-semibold">{l}</p>
                  <p className="font-black text-sm" style={{ color: c }}>{v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MULTISUCURSAL */}
      <section className="px-6 md:px-8 py-20 max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-black mb-4">Empezá con una sucursal.<br />Crecé sin cambiar de plataforma.</h2>
        <p className="text-neutral-500 text-lg mb-10 max-w-2xl mx-auto">ConeOS está preparado para trabajar con múltiples sucursales, manteniendo la operación y la información de cada una organizada.</p>
        <div className="flex flex-col items-center gap-3">
          <div className="px-6 py-3 rounded-2xl text-white font-bold text-sm shadow-sm" style={{ backgroundColor: NAVY }}>📊 Dashboard central</div>
          <div className="w-px h-6 bg-neutral-200" />
          <div className="flex flex-wrap justify-center gap-3">
            {['Sucursal 1', 'Sucursal 2', 'Sucursal 3', 'Sucursal 4'].map((s, i) => (
              <div key={s} className="px-5 py-3 bg-white border border-neutral-100 rounded-2xl text-sm font-semibold shadow-sm border-t-4" style={{ borderTopColor: [AZUL, VERDE, AMARILLO, ROJO][i] }}>🏪 {s}</div>
            ))}
          </div>
        </div>
      </section>

      {/* SEGURIDAD */}
      <section className="px-6 md:px-8 py-20 bg-neutral-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-black mb-10">Tu negocio, separado y protegido</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {([['🔐', 'Datos separados por comercio'], ['👤', 'Usuarios y permisos'], ['🔑', 'Acceso seguro'], ['☁️', 'Infraestructura cloud'], ['💾', 'Copias de seguridad'], ['🤝', 'Integraciones seguras con pagos y servicios fiscales']] as [string, string][]).map(([e, t]) => (
              <div key={t} className="bg-white rounded-2xl border border-neutral-100 p-5">
                <div className="text-2xl mb-2">{e}</div>
                <p className="font-semibold text-neutral-700">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FACTURACIÓN */}
      <section className="px-6 md:px-8 py-20 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-black mb-4">También podés facturar<br />desde ConeOS</h2>
            <p className="text-neutral-500 leading-relaxed mb-5">
              Facturación electrónica preparada para ARCA: emití tus comprobantes desde la misma
              operación de venta, con CAE y QR fiscal en el ticket.
            </p>
            <ul className="space-y-2.5 text-sm text-neutral-600">
              {['Comprobante automático al cobrar', 'CAE y QR fiscal en el ticket', 'Notas de crédito desde el panel', 'Factura A/B/C según la configuración fiscal del comercio'].map(t => (
                <li key={t} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0" style={chip(VERDE)}>✓</span>{t}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white border border-neutral-100 rounded-3xl p-6 shadow-sm font-mono text-xs leading-relaxed max-w-xs mx-auto w-full">
            <p className="text-center font-black">TU COMERCIO</p>
            <p className="text-center text-[10px] text-neutral-400 border-b border-dashed border-neutral-300 pb-2 mb-2">FACTURA · 00003-00000116</p>
            <div className="flex justify-between"><span>Almuerzo x4</span><span>$48.000</span></div>
            <div className="flex justify-between font-black border-t border-dashed border-neutral-300 mt-2 pt-2"><span>TOTAL</span><span>$48.000</span></div>
            <p className="text-[10px] text-neutral-400 mt-2">CAE: 86361990251606</p>
            <div className="w-16 h-16 mx-auto mt-2 rounded-lg border border-neutral-200 grid grid-cols-4 grid-rows-4 gap-0.5 p-1">
              {[0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15].map(i => (
                <div key={i} className="bg-neutral-800 rounded-[1px]" style={{ gridColumnStart: (i % 4) + 1, gridRowStart: Math.floor(i / 4) + 1 }} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PAGOS */}
      <section className="px-6 md:px-8 py-16 bg-neutral-50">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-black mb-8">Cobrá como tus clientes prefieren</h2>
          <div className="flex flex-wrap justify-center gap-4">
            {([['💳', 'Mercado Pago', 'con la cuenta del comercio'], ['🏦', 'Transferencia', 'con alias copiable'], ['💵', 'Efectivo', 'con control en caja']] as [string, string, string][]).map(([e, t, d]) => (
              <div key={t} className="bg-white rounded-2xl border border-neutral-100 px-6 py-5 shadow-sm">
                <div className="text-2xl mb-1">{e}</div>
                <p className="font-bold text-sm">{t}</p>
                <p className="text-neutral-400 text-xs">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* IMPLEMENTACIÓN */}
      <section className="px-6 md:px-8 py-20 max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-black mb-3">Empezar es más simple de lo que parece</h2>
        <p className="text-neutral-500 text-lg mb-12">Vos conocés tu negocio. Nosotros nos encargamos de convertirlo en una operación conectada.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
          {([['01', AZUL, 'Configuramos tu negocio', 'Productos, precios, categorías, sucursal y dispositivos.'], ['02', VERDE, 'Ponemos ConeOS a funcionar', 'Kiosco, mesas, delivery, caja y operación según corresponda.'], ['03', AMARILLO, 'Te acompañamos', 'Capacitación y puesta en marcha, con soporte cercano.']] as [string, string, string, string][]).map(([n, c, t, d]) => (
            <div key={n} className="bg-white rounded-2xl border border-neutral-100 p-6 shadow-sm">
              <p className="font-black text-3xl mb-3" style={{ color: c }}>{n}</p>
              <h3 className="font-bold mb-1.5">{t}</h3>
              <p className="text-neutral-500 text-sm">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRECIOS — escalera de planes (desde config centralizada) */}
      <section id="precios" className="px-6 md:px-8 py-20 bg-neutral-50">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-black mb-3">Un sistema que crece con tu negocio</h2>
          <p className="text-neutral-600 text-lg mb-12 font-semibold">{LANDING.precios.fraseEscalera}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch text-left">
            {LANDING.precios.planes.map(plan => (
              <div key={plan.id}
                className={`bg-white rounded-3xl p-7 shadow-sm border-t-4 relative flex flex-col ${plan.destacado ? 'border border-neutral-200 shadow-md md:-translate-y-2' : 'border border-neutral-100'}`}
                style={{ borderTopColor: plan.color }}>
                {'badge' in plan && plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold text-white px-3 py-1 rounded-full" style={{ backgroundColor: plan.color }}>{plan.badge}</span>
                )}
                <p className="text-sm font-black uppercase tracking-wide mb-1" style={{ color: plan.color }}>{plan.nombre}</p>
                <p className="text-neutral-500 text-sm mb-4">{plan.bajada}</p>
                <p className="text-2xl font-black mb-0.5">{plan.precio}</p>
                <p className="text-neutral-400 text-xs mb-5">{plan.detalle}</p>
                {plan.base && <p className="text-xs font-bold text-neutral-400 uppercase tracking-wide mb-2">{plan.base}</p>}
                <ul className="space-y-2 text-sm text-neutral-600 flex-1">
                  {plan.modulos.map(m => (
                    <li key={m} className="flex items-center gap-2.5">
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] flex-shrink-0" style={{ backgroundColor: plan.color + '14', color: plan.color }}>✓</span>{m}
                    </li>
                  ))}
                </ul>
                <a href="#contacto" className={`mt-6 text-center text-sm font-bold rounded-xl py-3 transition-colors ${plan.destacado ? 'text-white' : 'border border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}
                  style={plan.destacado ? { backgroundColor: plan.color } : undefined}>Quiero este plan</a>
              </div>
            ))}
          </div>
          <p className="text-neutral-500 text-sm mt-8 font-semibold">{LANDING.precios.implementacion}</p>
          <div className="mt-2 text-sm text-neutral-400 space-y-1">
            {LANDING.precios.aclaraciones.map(a => <p key={a}>{a}</p>)}
          </div>
        </div>
      </section>

      {/* DEMO / CTA */}
      <section id="contacto" className="px-6 md:px-8 py-20" style={{ backgroundColor: NAVY }}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">¿Querés ver ConeOS funcionando<br />en tu negocio?</h2>
          <p className="text-white/60 text-lg mb-8">Coordinemos una demo y te mostramos cómo podría funcionar en tu operación.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a href={waLink()} target="_blank" rel="noopener noreferrer"
              className="px-8 py-4 bg-white font-bold rounded-2xl text-base transition-transform hover:-translate-y-0.5" style={{ color: NAVY }}>Quiero una demo</a>
            <a href={waLink()} target="_blank" rel="noopener noreferrer"
              className="px-8 py-4 text-white font-bold rounded-2xl text-base transition-colors" style={{ backgroundColor: VERDE }}>💬 Hablar por WhatsApp</a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-6 md:px-8 py-20 max-w-2xl mx-auto">
        <h2 className="text-3xl font-black text-center mb-10">Preguntas frecuentes</h2>
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group bg-white border border-neutral-100 rounded-2xl px-5 py-4 shadow-sm">
              <summary className="font-bold text-sm cursor-pointer list-none flex items-center justify-between gap-3">
                {q}
                <span className="text-neutral-300 group-open:rotate-45 transition-transform text-lg leading-none">+</span>
              </summary>
              <p className="text-neutral-500 text-sm mt-3 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="px-6 md:px-8 py-10 border-t border-neutral-100">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <img src="/coneos-icon.png" alt="ConeOS" className="w-6 h-6 rounded-md" />
              <span className="font-bold">Cone<span style={{ color: AZUL }}>OS</span></span>
            </div>
            <p className="text-neutral-400 text-xs max-w-xs">{LANDING.empresa.bajada}</p>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-neutral-400 justify-center">
            {([['#funciones', 'Funcionalidades'], ['#rubros', 'Soluciones'], ['#precios', 'Precios'], ['#faq', 'FAQ'], ['#contacto', 'Contacto']] as [string, string][]).map(([h, l]) => (
              <a key={l} href={h} className="hover:text-neutral-700 transition-colors">{l}</a>
            ))}
          </div>
          <p className="text-neutral-300 text-xs">{LANDING.empresa.copyright}</p>
        </div>
      </footer>
    </div>
  )
}
