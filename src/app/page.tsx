export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <nav className="border-b border-neutral-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-neutral-900 rounded-lg flex items-center justify-center">
            <span className="text-amber-400 text-base">🍦</span>
          </div>
          <span className="font-bold text-neutral-900 text-lg">ConeOS</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#features" className="text-neutral-500 text-sm hover:text-neutral-800 transition-colors">Funciones</a>
          <a href="#contacto" className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-700 transition-colors">Solicitar demo</a>
        </div>
      </nav>

      <section className="px-8 py-20 text-center max-w-3xl mx-auto">
        <div className="inline-block bg-neutral-100 text-neutral-600 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 tracking-wide uppercase">
          Sistema de pedidos para heladerías
        </div>
        <h1 className="text-5xl font-black text-neutral-900 leading-tight mb-6">
          Más ventas,<br />menos colas.
        </h1>
        <p className="text-xl text-neutral-500 mb-10 leading-relaxed max-w-xl mx-auto">
          Kiosk táctil, caja, preparación y display — todo integrado, en tiempo real, desde cualquier dispositivo.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a href="#contacto" className="px-8 py-4 bg-neutral-900 text-white font-bold rounded-2xl text-base hover:bg-neutral-700 transition-colors">
            Solicitar demo →
          </a>
          <a href="#features" className="px-8 py-4 border border-neutral-200 text-neutral-600 font-semibold rounded-2xl text-base hover:bg-neutral-50 transition-colors">
            Ver funciones
          </a>
        </div>
      </section>

      <section className="px-8 pb-20 max-w-4xl mx-auto">
        <div className="bg-neutral-50 rounded-3xl border border-neutral-100 overflow-hidden shadow-sm">
          <div className="bg-white border-b border-neutral-100 px-5 py-3 flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-300" />
              <div className="w-3 h-3 rounded-full bg-amber-300" />
              <div className="w-3 h-3 rounded-full bg-green-300" />
            </div>
            <div className="flex-1 bg-neutral-100 rounded-lg px-4 py-1.5 text-xs text-neutral-400 font-mono max-w-xs mx-auto text-center">
              coneos.vercel.app/[tu-heladería]/admin
            </div>
          </div>
          <div className="flex min-h-64">
            <div className="w-44 bg-white border-r border-neutral-100 p-4">
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-neutral-100">
                <div className="w-6 h-6 bg-neutral-900 rounded-md flex items-center justify-center text-xs">🍦</div>
                <span className="text-xs font-bold text-neutral-800">ConeOS</span>
              </div>
              {['Dashboard', 'Catálogo', 'Sucursales', 'Equipo', 'Ventas', 'Configuración'].map((item, i) => (
                <div key={item} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium mb-0.5 ${i === 0 ? 'bg-neutral-900 text-white' : 'text-neutral-400'}`}>
                  {item}
                </div>
              ))}
            </div>
            <div className="flex-1 p-5">
              <p className="text-neutral-400 text-xs mb-0.5">Buen día</p>
              <h3 className="text-neutral-900 font-bold text-base mb-4">Dashboard</h3>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Ventas hoy', value: '$84.000', color: 'text-green-600' },
                  { label: 'Pedidos', value: '12', color: 'text-neutral-800' },
                  { label: 'Ticket prom.', value: '$7.000', color: 'text-neutral-800' },
                  { label: 'Productos', value: '27', color: 'text-neutral-800' },
                ].map(stat => (
                  <div key={stat.label} className="bg-white rounded-xl border border-neutral-100 p-3">
                    <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
                    <p className="text-neutral-400 text-xs mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-neutral-100 overflow-hidden">
                {[
                  { num: '#124', estado: 'Pagado', color: 'bg-blue-100 text-blue-700', total: '$17.000' },
                  { num: '#123', estado: 'Preparando', color: 'bg-amber-100 text-amber-700', total: '$10.500' },
                  { num: '#122', estado: 'Listo', color: 'bg-green-100 text-green-700', total: '$28.000' },
                ].map(p => (
                  <div key={p.num} className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-50 last:border-0">
                    <span className="text-xs font-bold text-neutral-800">{p.num}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.color}`}>{p.estado}</span>
                    <span className="text-xs text-neutral-500 font-medium">{p.total}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-8 py-20 bg-neutral-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-black text-neutral-900 text-center mb-4">Todo lo que necesitás</h2>
          <p className="text-neutral-500 text-center mb-12 text-lg">Cinco módulos integrados, un solo sistema.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { emoji: '📱', title: 'Kiosk táctil', desc: 'El cliente elige, personaliza sabores y paga sin esperar. Touch-first, funciona en tablet, tótem o celular.' },
              { emoji: '🏪', title: 'Caja', desc: 'Recibí pedidos, cobrá en efectivo, transferencia o Mercado Pago y mandá a preparación con un toque.' },
              { emoji: '👨‍🍳', title: 'Preparación', desc: 'Los pedidos llegan en tiempo real. El equipo ve los sabores exactos de cada unidad, sin confusiones.' },
              { emoji: '📺', title: 'Display público', desc: 'Pantalla para el local que muestra los números listos para retirar. Se actualiza automáticamente.' },
              { emoji: '📊', title: 'Admin completo', desc: 'Dashboard con métricas, catálogo con fotos, operadores, dispositivos y reportes de ventas.' },
              { emoji: '🔒', title: 'Multi-sucursal', desc: 'Cada heladería tiene su propio entorno aislado. Podés tener varias sucursales en un sistema.' },
            ].map(f => (
              <div key={f.title} className="bg-white rounded-2xl border border-neutral-100 p-6">
                <div className="text-3xl mb-4">{f.emoji}</div>
                <h3 className="font-bold text-neutral-900 mb-2">{f.title}</h3>
                <p className="text-neutral-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-8 py-20 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-black text-neutral-900 mb-4">El cliente compra solo,<br />vos vendés más</h2>
            <p className="text-neutral-500 mb-6 leading-relaxed">El kiosk táctil permite que cada cliente arme su pedido con sus propios sabores, sin esperar atención.</p>
            <ul className="space-y-3">
              {['Fotos de productos y sabores', 'Hasta 4 sabores por unidad', 'Pago con Mercado Pago o en caja', 'Código de retiro automático', 'Funciona en tablet, tótem o celular'].map(item => (
                <li key={item} className="flex items-center gap-3 text-sm text-neutral-600">
                  <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-green-700 text-xs">✓</span>
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-neutral-50 border border-neutral-100 rounded-3xl p-6">
            <div className="text-center mb-4">
              <div className="inline-block border border-neutral-200 rounded-lg px-3 py-1 text-xs font-semibold text-neutral-600 mb-3">Tu heladería</div>
              <p className="text-neutral-500 text-sm">¿Qué querés pedir?</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[{ emoji: '🍦', name: 'Helados por kilo' }, { emoji: '🧊', name: 'Baldes' }, { emoji: '🎂', name: 'Tortas heladas' }, { emoji: '🍫', name: 'Bombones' }].map(cat => (
                <div key={cat.name} className="bg-white border border-neutral-100 rounded-2xl p-4 text-center">
                  <div className="text-3xl mb-2">{cat.emoji}</div>
                  <p className="text-xs font-medium text-neutral-600">{cat.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="contacto" className="px-8 py-20 bg-neutral-900">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl font-black text-white mb-4">¿Querés verlo en tu heladería?</h2>
          <p className="text-neutral-400 mb-8 text-lg">Pedí una demo y te mostramos el sistema funcionando con tu catálogo real.</p>
          <div className="bg-white rounded-2xl p-6 text-left">
            <div className="space-y-3 mb-4">
              <input type="text" placeholder="Nombre de tu heladería" className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400 bg-neutral-50" />
              <input type="email" placeholder="Tu email" className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400 bg-neutral-50" />
              <input type="tel" placeholder="WhatsApp" className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400 bg-neutral-50" />
            </div>
            <button className="w-full py-3.5 bg-neutral-900 text-white font-bold rounded-xl text-sm hover:bg-neutral-700 transition-colors">
              Solicitar demo gratuita →
            </button>
          </div>
        </div>
      </section>

      <footer className="px-8 py-6 border-t border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-neutral-900 rounded-md flex items-center justify-center text-xs">🍦</div>
          <span className="text-sm font-semibold text-neutral-700">ConeOS</span>
          <span className="text-neutral-400 text-sm">· Sistema de pedidos para heladerías</span>
        </div>
        <p className="text-neutral-400 text-xs">Desarrollado por QP C&IA</p>
      </footer>
    </div>
  )
}
