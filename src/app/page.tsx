import Image from 'next/image'

// ============================================================
// LANDING coneos.com.ar — AOKI GASTROS
// Formato de la casa Aoki: hero navy con degradé, tipografía
// grande con quiebre en celeste, cards flotantes del producto.
// Marca: Aoki (logo oficial) + GastrOS como nombre del sistema.
// Requiere: public/aoki-logo.png (logo blanco transparente).
// ============================================================

export const metadata = {
  title: 'Aoki GastrOS — El sistema operativo de tu negocio gastronómico',
  description:
    'Kiosco de autoservicio, delivery, mesas con QR, take away con hora de retiro y caja. Cobros con Mercado Pago y transferencias por canal, control de stock y facturación ARCA automática.',
}

const NAVY = '#0A1F35'
const CIAN = '#38BDF8'

const CANALES = [
  { emoji: '🛒', title: 'Kiosco', desc: 'Autoservicio en el local: el cliente arma su pedido, paga y retira con su número.' },
  { emoji: '🛵', title: 'Delivery', desc: 'Pedidos online con envío, horarios propios, cadetes y comprobante de pago.' },
  { emoji: '🍽️', title: 'Mesas', desc: 'QR en la mesa: piden desde el celular y cierran la cuenta como quieran.' },
  { emoji: '🥡', title: 'Take Away', desc: 'Encargan y eligen a qué hora retirar. La cocina se organiza sola por horario.', nuevo: '🕐' },
  { emoji: '🧾', title: 'Caja', desc: 'Venta de mostrador y pedidos telefónicos, cargados por tu equipo en segundos.' },
]

const FUNCIONES = [
  { emoji: '📦', title: 'Control de stock', desc: 'Los productos contables se descuentan solos y desaparecen de los cinco canales al agotarse. El panel y la caja te avisan qué reponer.', destacada: true, nuevo: true },
  { emoji: '🧾', title: 'Facturación ARCA automática', desc: 'Factura electrónica emitida sola al confirmarse el pago, con QR fiscal en el ticket. Consumidor final o con CUIT.' },
  { emoji: '🖥️', title: 'Display de cocina', desc: 'Preparación con cada pedido identificado por canal y hora de retiro; pantalla de retiro para que el cliente se entere solo.' },
  { emoji: '🎁', title: 'Beneficios y puntos', desc: 'Tus clientes suman con cada compra y canjean premios. Fidelización propia, sin apps de terceros.' },
  { emoji: '📊', title: 'Caja y resúmenes por canal', desc: 'El día completo en una pantalla: cuánto entró por cada canal y cada método de pago.' },
  { emoji: '📱', title: 'La app de tu comercio', desc: 'Tu marca, tu logo y tus colores en una app que tus clientes instalan desde el navegador, sin tiendas ni comisiones.' },
]

const FAQ = [
  ['¿Necesito instalar algo?', 'No. Todo funciona desde el navegador: tus clientes desde el celular y tu equipo desde cualquier compu o tablet. La app de tu comercio se instala en un toque desde el navegador, sin tiendas.'],
  ['¿Puedo integrar Mercado Pago?', 'Sí. Se integra de forma oficial con la cuenta de Mercado Pago del comercio — o con varias: podés dirigir los cobros de cada canal a cuentas distintas. La plata va directo a tu cuenta.'],
  ['¿Emite factura electrónica?', 'Sí. GastrOS factura automáticamente por ARCA al confirmarse cada pago, con el QR fiscal en el ticket.'],
  ['¿Sirve para mi rubro?', 'Heladerías, cafeterías, hamburgueserías, pizzerías y todo negocio gastronómico con mostrador, mesas o reparto.'],
  ['¿Cómo empiezo?', 'Contactanos y armamos una demo con tu catálogo real, para que la pruebes desde el celular como la verían tus clientes.'],
]

export default function Landing() {
  return (
    <div className="min-h-screen text-white" style={{ background: `linear-gradient(165deg, #081A2E, #0D2C4F 55%, #0F3358)` }}>
      {/* NAV */}
      <nav className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/aoki-logo.png" alt="Aoki" width={92} height={30} className="h-7 w-auto" />
          <span className="text-sm font-semibold text-white/60 border-l border-white/20 pl-3">GastrOS</span>
        </div>
        <div className="hidden md:flex items-center gap-7 text-sm text-slate-300">
          <a href="#canales" className="hover:text-white transition-colors">Canales</a>
          <a href="#cobros" className="hover:text-white transition-colors">Cobros</a>
          <a href="#funciones" className="hover:text-white transition-colors">Funciones</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          <a href="#contacto" className="border-[1.5px] border-white/35 hover:border-white rounded-full px-5 py-2 font-semibold text-white transition-colors">Contacto</a>
        </div>
      </nav>

      {/* HERO */}
      <header className="max-w-6xl mx-auto px-6 pt-10 pb-20 grid lg:grid-cols-2 gap-12 items-center overflow-hidden">
        <div>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-[1.1] tracking-tight">
            El sistema operativo{' '}
            <span style={{ color: CIAN }}>de tu negocio gastronómico</span>
          </h1>
          <p className="mt-5 text-lg text-slate-300 max-w-lg">
            Kiosco de autoservicio, delivery, mesas con QR, take away con hora de retiro y caja — un solo catálogo, una sola operación, todo cobrado y facturado sin cargarlo dos veces.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#contacto" className="rounded-full px-7 py-3.5 font-extrabold text-[15px] transition-colors" style={{ backgroundColor: CIAN, color: NAVY }}>
              Contactanos
            </a>
            <a href="#canales" className="rounded-full px-7 py-3.5 font-semibold text-[15px] border-[1.5px] border-white/35 hover:border-white transition-colors">
              Conocé los canales
            </a>
          </div>
          <p className="mt-5 text-sm text-slate-400">Operando hoy en gastronómicos de Argentina, con facturación ARCA automática.</p>
        </div>

        {/* Paneles del producto — recortes nítidos estilo Aoki (legibles a este tamaño) */}
        <div className="relative h-[460px] hidden sm:block">
          {/* Caja en vivo — frente */}
          <div className="absolute top-0 right-6 w-[330px] rotate-2 bg-white text-neutral-800 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-30">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
              <b className="text-sm">Caja · Casa Central</b>
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full" style={{ backgroundColor: CIAN, color: NAVY }}>EN VIVO</span>
            </div>
            {[
              ['#15', '🍽️ MESA 15', null, '$9.000'],
              ['#14', '🥡 TAKE AWAY', '🕐 16:45', '$9.000'],
              ['#13', '🧾 CAJA', null, '$12.500'],
              ['#10', '🥡 TAKE AWAY', '🕐 16:15', '$8.500'],
            ].map(([n, tag, hora, monto]) => (
              <div key={n as string} className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-50 last:border-0 text-[13px]">
                <div className="flex items-center gap-2">
                  <b>{n}</b>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">{tag}</span>
                  {hora && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-900 text-white">{hora}</span>}
                </div>
                <b>{monto}</b>
              </div>
            ))}
          </div>
          {/* Display de cocina — medio */}
          <div className="absolute bottom-24 right-56 w-[270px] -rotate-3 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-20 bg-[#151A21]">
            <p className="px-4 pt-3 pb-2 text-[10px] font-bold tracking-widest text-slate-400">DISPLAY DE COCINA</p>
            <div className="flex gap-2 px-4 pb-4">
              <span className="bg-[#1F2630] text-amber-400 font-extrabold rounded-lg px-3 py-2">#13</span>
              <span className="bg-[#1F2630] text-amber-400 font-extrabold rounded-lg px-3 py-2">#14</span>
              <span className="bg-[#17351F] text-green-400 font-extrabold rounded-lg px-3 py-2">#12</span>
            </div>
          </div>
          {/* Matriz de cuentas — fondo */}
          <div className="absolute bottom-0 right-0 w-[300px] rotate-1 bg-white text-neutral-800 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-10">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-slate-50 text-slate-500 text-left"><th className="px-3 py-2">Canal</th><th className="px-3 py-2">Transferencia</th><th className="px-3 py-2">Mercado Pago</th></tr></thead>
              <tbody>
                {[['🛵 Delivery', 'Cuenta local', 'MP Delivery'], ['🛒 Kiosco', 'Cuenta local', 'MP Mostrador'], ['🥡 Take Away', 'Cuenta 2', 'MP Mostrador']].map(([c, t, m2]) => (
                  <tr key={c} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold whitespace-nowrap">{c}</td>
                    <td className="px-3 py-2"><span className="bg-slate-100 rounded-md px-2 py-0.5 whitespace-nowrap">{t}</span></td>
                    <td className="px-3 py-2"><span className="bg-sky-50 text-sky-700 rounded-md px-2 py-0.5 whitespace-nowrap">{m2}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </header>

      {/* CANALES */}
      <section id="canales" className="border-t border-[#1E3A5C]/60 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">Cinco formas de vender. <span style={{ color: CIAN }}>Una sola operación.</span></h2>
          <p className="mt-3 text-slate-400 max-w-xl">Cada canal con su experiencia; todos contra el mismo catálogo, el mismo stock y la misma caja.</p>
          <div className="mt-9 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {CANALES.map(c => (
              <div key={c.title} className="rounded-2xl border border-[#1E3A5C] bg-white/[.04] p-5 hover:border-sky-400 hover:-translate-y-1 transition-all">
                <span className="text-2xl">{c.emoji}</span>
                <h3 className="mt-2.5 font-extrabold text-[15px]">
                  {c.title} {c.nuevo && <span className="ml-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full align-middle" style={{ backgroundColor: CIAN, color: NAVY }}>{c.nuevo}</span>}
                </h3>
                <p className="mt-1.5 text-[13px] text-slate-400 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COBROS */}
      <section id="cobros" className="border-t border-[#1E3A5C]/60 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">
            La plata de cada canal, <span style={{ color: CIAN }}>a la cuenta que vos digas</span>
            <span className="ml-3 text-[11px] font-extrabold px-2.5 py-1 rounded-full align-middle" style={{ backgroundColor: CIAN, color: NAVY }}>NUEVO</span>
          </h2>
          <p className="mt-3 text-slate-400 max-w-xl">Conectá varias cuentas de Mercado Pago y cargá tus cuentas de transferencia. Después decidí, canal por canal, dónde entra cada cobro — ideal para separar cajas, socios o franquicias.</p>
          <div className="mt-8 grid lg:grid-cols-2 gap-10 items-center">
            <div className="bg-white text-neutral-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-slate-500 text-left text-xs"><th className="px-4 py-2.5">Canal</th><th className="px-4 py-2.5">🏦 Transferencia</th><th className="px-4 py-2.5">Mercado Pago</th></tr></thead>
                <tbody>
                  {[['🛒 Kiosco', 'Cuenta local', 'MP Mostrador'], ['🛵 Delivery', 'Cuenta delivery', 'MP Delivery'], ['🍽️ Mesa', 'Cuenta local', 'MP Mostrador'], ['🥡 Take Away', 'Cuenta de siempre', 'MP Take Away'], ['🧾 Caja', 'Cuenta local', 'Cuenta de siempre']].map(([c, t, m]) => (
                    <tr key={c} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-bold whitespace-nowrap">{c}</td>
                      <td className="px-4 py-2.5">{t}</td>
                      <td className="px-4 py-2.5">{m}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3">
              {[
                'Varias cuentas de Mercado Pago conectadas de forma oficial, con renovación automática.',
                'Todas tus cuentas de transferencia — el cliente ve la correcta según por dónde compró.',
                'Cada pedido guarda para siempre en qué cuenta se cobró: la historia no cambia aunque cambies la configuración.',
                '¿No configurás nada? Todo funciona como siempre. Es opcional.',
              ].map(t => (
                <li key={t} className="relative pl-8 text-[15px] text-slate-200">
                  <span className="absolute left-0 top-1.5 w-4 h-4 rounded-md" style={{ backgroundColor: CIAN }} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FUNCIONES */}
      <section id="funciones" className="border-t border-[#1E3A5C]/60 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">Todo lo demás, <span style={{ color: CIAN }}>sin sumar sistemas</span></h2>
          <div className="mt-9 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FUNCIONES.map(f => (
              <div key={f.title} className={`rounded-2xl border p-6 ${f.destacada ? 'border-sky-400 bg-sky-400/[.07]' : 'border-[#1E3A5C] bg-white/[.04]'}`}>
                <span className="text-2xl">{f.emoji}</span>
                <h3 className="mt-3 font-extrabold text-[15px]">
                  {f.title} {f.nuevo && <span className="ml-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full align-middle" style={{ backgroundColor: CIAN, color: NAVY }}>NUEVO</span>}
                </h3>
                <p className="mt-2 text-[13px] text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-[#1E3A5C]/60 py-16">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">Preguntas <span style={{ color: CIAN }}>frecuentes</span></h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="rounded-2xl border border-[#1E3A5C] bg-white/[.04] px-5 py-4 group">
                <summary className="font-bold text-[15px] cursor-pointer list-none flex justify-between items-center">
                  {q}<span className="text-slate-500 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-sm text-slate-400 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACTO */}
      <div className="max-w-6xl mx-auto px-6">
        <div id="contacto" className="my-16 rounded-3xl border p-10 sm:p-12 grid lg:grid-cols-[1.2fr_.8fr] gap-8 items-center" style={{ borderColor: CIAN, backgroundColor: 'rgba(56,189,248,.08)' }}>
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Vení a verlo <span style={{ color: CIAN }}>con tus propios productos</span></h2>
            <p className="mt-3 text-slate-300">Te armamos una demo con tu catálogo real y la probás desde el celular, como la verían tus clientes. Sin compromiso.</p>
          </div>
          <div className="lg:text-right">
            <a href="https://wa.me/5492236807302?text=Hola!%20Quiero%20una%20demo%20de%20GastrOS" target="_blank" rel="noopener" className="inline-block rounded-full px-8 py-4 font-extrabold" style={{ backgroundColor: CIAN, color: NAVY }}>
              📱 Pedir una demo por WhatsApp
            </a>
            <p className="mt-3 text-sm text-slate-400 lg:text-right">+54 9 2236 80-7302</p>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="border-t border-[#1E3A5C]/60">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <Image src="/aoki-logo.png" alt="Aoki" width={70} height={23} className="h-5 w-auto opacity-80" />
            <span><b className="text-white">GastrOS</b> — el sistema operativo gastronómico</span>
          </div>
          <span>Contacto: <a href="https://wa.me/5492236807302" className="hover:text-white transition-colors">+54 9 2236 80-7302</a> · Argentina</span>
        </div>
      </footer>
    </div>
  )
}
