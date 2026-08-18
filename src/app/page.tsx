export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans">

      {/* NAV */}
      <nav className="border-b border-neutral-100 px-8 py-4 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm z-50">
        <div className="flex items-center gap-2.5">
          <img src="/icon-192.png" alt="ConeOS" className="w-8 h-8 rounded-xl" />
          <span className="font-bold text-neutral-900 text-lg">ConeOS</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#funciones" className="text-neutral-500 text-sm hover:text-neutral-800 transition-colors hidden md:block">Funciones</a>
          <a href="#delivery" className="text-neutral-500 text-sm hover:text-neutral-800 transition-colors hidden md:block">Delivery</a>
          <a href="#contacto" className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-700 transition-colors">Solicitar demo</a>
        </div>
      </nav>

      {/* HERO */}
      <section className="px-8 py-20 text-center max-w-3xl mx-auto">
        <div className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 tracking-wide uppercase">
          Sistema de pedidos para heladerías
        </div>
        <h1 className="text-5xl font-black text-neutral-900 leading-tight mb-6">
          Más ventas,<br />menos colas.
        </h1>
        <p className="text-xl text-neutral-500 mb-10 leading-relaxed max-w-xl mx-auto">
          Kiosk táctil, caja, preparación, display y delivery — todo integrado, en tiempo real, desde cualquier dispositivo.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a href="#contacto" className="px-8 py-4 bg-neutral-900 text-white font-bold rounded-2xl text-base hover:bg-neutral-700 transition-colors">
            Solicitar demo →
          </a>
          <a href="#funciones" className="px-8 py-4 border border-neutral-200 text-neutral-600 font-semibold rounded-2xl text-base hover:bg-neutral-50 transition-colors">
            Ver funciones
          </a>
        </div>
      </section>

      {/* MOCKUP ADMIN */}
      <section className="px-8 pb-20 max-w-4xl mx-auto">
        <div className="bg-neutral-50 rounded-3xl border border-neutral-100 overflow-hidden shadow-sm">
          <div className="bg-white border-b border-neutral-100 px-5 py-3 flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-300" />
              <div className="w-3 h-3 rounded-full bg-amber-300" />
              <div className="w-3 h-3 rounded-full bg-green-300" />
            </div>
            <div className="flex-1 bg-neutral-100 rounded-lg px-4 py-1.5 text-xs text-neutral-400 font-mono max-w-xs mx-auto text-center">
              coneos.vercel.app/tu-heladería/admin
            </div>
          </div>
          <div className="flex min-h-64">
            <div className="w-44 bg-white border-r border-neutral-100 p-4">
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-neutral-100">
                <img src="/icon-192.png" alt="ConeOS" className="w-6 h-6 rounded-md" />
                <span className="text-xs font-bold text-neutral-800">ConeOS</span>
              </div>
              {['Dashboard', 'Catálogo', 'Sucursales', 'Equipo', 'Ventas', 'Delivery 🛵'].map((item, i) => (
                <div key={item} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium mb-0.5 ${i === 0 ? 'bg-neutral-900 text-white' : i === 5 ? 'text-blue-600 bg-blue-50' : 'text-neutral-400'}`}>
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
                  { label: 'Delivery', value: '4', color: 'text-blue-600' },
                  { label: 'Ticket prom.', value: '$7.000', color: 'text-neutral-800' },
                ].map(stat => (
                  <div key={stat.label} className="bg-white rounded-xl border border-neutral-100 p-3">
                    <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
                    <p className="text-neutral-400 text-xs mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-neutral-100 overflow-hidden">
                {[
                  { num: '#14', estado: 'Delivery', color: 'bg-purple-100 text-purple-700', total: '$23.000' },
                  { num: '#13', estado: 'Preparando', color: 'bg-amber-100 text-amber-700', total: '$10.500' },
                  { num: '#12', estado: 'Listo', color: 'bg-green-100 text-green-700', total: '$28.000' },
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

      {/* FUNCIONES */}
      <section id="funciones" className="px-8 py-20 bg-neutral-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-black text-neutral-900 text-center mb-4">Todo lo que necesitás</h2>
          <p className="text-neutral-500 text-center mb-12 text-lg">Seis módulos integrados, un solo sistema.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { emoji: '📱', title: 'Kiosk táctil', desc: 'El cliente elige, personaliza sabores y paga sin esperar. Touch-first, funciona en tablet, tótem o celular. Instalable como app PWA.' },
              { emoji: '🏪', title: 'Caja', desc: 'Recibí pedidos en tiempo real, cobrá en efectivo, transferencia o Mercado Pago. Historial por día con desglose por método de pago.' },
              { emoji: '👨‍🍳', title: 'Preparación', desc: 'Los pedidos llegan en tiempo real. El equipo ve los sabores exactos de cada unidad, sin confusiones.' },
              { emoji: '📺', title: 'Display público', desc: 'Pantalla para el local que muestra los números listos para retirar. Se actualiza automáticamente.' },
              { emoji: '🛵', title: 'Delivery', desc: 'Pedidos a domicilio con formulario de entrega, transferencia con alias copiable, cadetes con comanda y horarios configurables por sucursal.' },
              { emoji: '📊', title: 'Admin completo', desc: 'Dashboard con métricas, catálogo con fotos, operadores con PIN, dispositivos con QR, colaboradores y reportes de ventas.' },
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

      {/* KIOSK SECTION */}
      <section className="px-8 py-20 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-black text-neutral-900 mb-4">El cliente compra solo,<br />vos vendés más</h2>
            <p className="text-neutral-500 mb-6 leading-relaxed">El kiosk táctil permite que cada cliente arme su pedido con sus propios sabores, sin esperar atención.</p>
            <ul className="space-y-3">
              {[
                'Fotos de productos y sabores',
                'Hasta 4 sabores por unidad',
                'Pago con Mercado Pago, efectivo o transferencia',
                'Código de retiro automático',
                'Funciona en tablet, tótem o celular',
                'Instalable como app — sin barra del navegador',
              ].map(item => (
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

      {/* DELIVERY SECTION */}
      <section id="delivery" className="px-8 py-20 bg-blue-50">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="bg-white rounded-3xl border border-blue-100 p-6 shadow-sm">
              <div className="bg-blue-600 text-white text-center rounded-2xl p-4 mb-4">
                <p className="text-xs font-semibold opacity-70 mb-1">PEDIDO #14</p>
                <p className="font-black text-2xl">$23.000</p>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-neutral-100 pb-2">
                  <span className="text-neutral-500">📍 Dirección</span>
                  <span className="font-semibold text-neutral-800">Av. San Martín 456</span>
                </div>
                <div className="flex justify-between border-b border-neutral-100 pb-2">
                  <span className="text-neutral-500">🍦 Pedido</span>
                  <span className="font-semibold text-neutral-800">1/2 Kg — 3 sabores</span>
                </div>
                <div className="flex justify-between border-b border-neutral-100 pb-2">
                  <span className="text-neutral-500">📞 Teléfono</span>
                  <span className="font-semibold text-neutral-800">2302 456497</span>
                </div>
                <div className="flex justify-between border-b border-neutral-100 pb-2">
                  <span className="text-neutral-500">💳 Pago</span>
                  <span className="font-semibold text-neutral-800">Transferencia</span>
                </div>
                <div className="bg-neutral-900 text-white text-center rounded-xl py-2 font-bold text-sm">
                  🛵 Cadete: María García
                </div>
              </div>
            </div>
            <div>
              <div className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
                Módulo Delivery
              </div>
              <h2 className="text-3xl font-black text-neutral-900 mb-4">Delivery integrado<br />al sistema</h2>
              <p className="text-neutral-500 mb-6 leading-relaxed">El cliente pide desde su celular, la caja lo ve en tiempo real, asigna un cadete e imprime la comanda automáticamente.</p>
              <ul className="space-y-3">
                {[
                  'Formulario de entrega mobile-first',
                  'Alias de transferencia copiable',
                  'Horarios configurables por sucursal',
                  'Asignación de cadetes con comanda',
                  'Compatible con ticketera térmica 80mm',
                  'Seguimiento del pedido en tiempo real',
                ].map(item => (
                  <li key={item} className="flex items-center gap-3 text-sm text-neutral-600">
                    <div className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-700 text-xs">✓</span>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* MULTI-TENANT */}
      <section className="px-8 py-20 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-black text-neutral-900 mb-4">Multi-sucursal y multi-empresa</h2>
          <p className="text-neutral-500 text-lg">Cada heladería tiene su propio entorno completamente aislado.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: '🔒', title: 'Aislamiento total', desc: 'Cada empresa solo ve sus propios datos. RLS habilitado en todas las tablas.' },
            { icon: '🏪', title: 'Múltiples sucursales', desc: 'Una empresa puede tener varias sucursales con catálogos, dispositivos y operadores independientes.' },
            { icon: '📱', title: 'Dispositivos por QR', desc: 'Vinculá kiosks, cajas y pantallas escaneando un QR. Sin configuración técnica.' },
          ].map(f => (
            <div key={f.title} className="bg-neutral-50 rounded-2xl border border-neutral-100 p-6 text-center">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-bold text-neutral-900 mb-2">{f.title}</h3>
              <p className="text-neutral-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CONTACTO */}
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
            <a href="https://wa.me/542302456497?text=Hola%20Juan%20Cruz%2C%20quiero%20una%20demo%20de%20ConeOS%20para%20mi%20heladería"
              target="_blank" rel="noopener noreferrer"
              className="w-full block text-center py-3.5 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-sm transition-colors">
              💬 Solicitar demo por WhatsApp →
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="px-8 py-6 border-t border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/icon-192.png" alt="ConeOS" className="w-6 h-6 rounded-md" />
          <span className="text-sm font-semibold text-neutral-700">ConeOS</span>
          <span className="text-neutral-400 text-sm">· Sistema de pedidos para heladerías</span>
        </div>
        <p className="text-neutral-400 text-xs">Desarrollado por <a href="https://qpcia.com" className="hover:text-neutral-600 transition-colors">QP C&IA</a></p>
      </footer>

    </div>
  )
}
