'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LayoutDashboard, BookOpen, Store, Users, BarChart3, Settings, IceCream2, LogOut, Truck, Lock, X } from 'lucide-react'

interface Props { usuarioNombre: string; empresaNombre: string; slug: string; modulos: Record<string, boolean> }

export default function AdminSidebar({ usuarioNombre, empresaNombre, slug, modulos }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [modalDelivery, setModalDelivery] = useState(false)

  const NAV = [
    { href: `/${slug}/admin`, label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: `/${slug}/admin/catalogo`, label: 'Catálogo', icon: BookOpen },
    { href: `/${slug}/admin/sucursales`, label: 'Sucursales', icon: Store },
    { href: `/${slug}/admin/operacion`, label: 'Equipo', icon: Users },
    { href: `/${slug}/admin/ventas`, label: 'Ventas', icon: BarChart3 },
    { href: `/${slug}/admin/config`, label: 'Configuración', icon: Settings },
  ]

  const deliveryActivo = modulos.delivery === true

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    localStorage.removeItem('coneos-auth')
    router.replace(`/${slug}/login`)
  }

  return (
    <>
      <aside className="w-56 bg-white border-r border-neutral-100 flex flex-col min-h-screen shadow-sm">
        <div className="px-5 py-5 border-b border-neutral-100">
          <div className="flex items-center gap-2.5 mb-0.5">
            <div className="w-7 h-7 bg-neutral-800 rounded-lg flex items-center justify-center">
              <IceCream2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-black text-neutral-800">ConeOS</span>
          </div>
          <p className="text-xs text-neutral-400 ml-9 truncate">{empresaNombre}</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(item => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${active ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50'}`}>
                <item.icon className="h-4 w-4 flex-shrink-0" />
                {item.label}
              </Link>
            )
          })}

          {/* Módulo Delivery */}
          {deliveryActivo ? (
            <Link href={`/${slug}/admin/delivery`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${pathname.startsWith(`/${slug}/admin/delivery`) ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50'}`}>
              <Truck className="h-4 w-4 flex-shrink-0" />
              Delivery
            </Link>
          ) : (
            <button onClick={() => setModalDelivery(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-neutral-300 hover:bg-neutral-50 transition-all">
              <Truck className="h-4 w-4 flex-shrink-0" />
              Delivery
              <Lock className="h-3 w-3 ml-auto" />
            </button>
          )}
        </nav>

        <div className="px-4 py-4 border-t border-neutral-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center text-white text-xs font-bold">
              {usuarioNombre?.[0]?.toUpperCase() ?? 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-neutral-700 truncate">{usuarioNombre}</p>
              <p className="text-xs text-neutral-400">Admin</p>
            </div>
            <button onClick={handleLogout} className="p-1.5 text-neutral-300 hover:text-neutral-600 hover:bg-neutral-100 rounded-lg transition-colors" title="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Modal delivery bloqueado */}
      {modalDelivery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setModalDelivery(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <button onClick={() => setModalDelivery(false)} className="absolute top-4 right-4 p-1 text-neutral-400 hover:text-neutral-600">
              <X className="h-5 w-5" />
            </button>
            <div className="w-12 h-12 bg-neutral-100 rounded-2xl flex items-center justify-center mb-4">
              <Truck className="h-6 w-6 text-neutral-400" />
            </div>
            <h3 className="font-black text-neutral-900 text-lg mb-2">Módulo Delivery</h3>
            <p className="text-neutral-500 text-sm mb-5">El módulo de delivery no está incluido en tu plan actual. Incluye gestión de pedidos a domicilio, cadetes, comandas y seguimiento en tiempo real.</p>
            <a href="https://wa.me/542302456497?text=Hola%20Juan%20Cruz%2C%20quiero%20activar%20el%20m%C3%B3dulo%20de%20Delivery%20en%20ConeOS"
              target="_blank" rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-colors text-sm">
              💬 Contactar para activar
            </a>
          </div>
        </div>
      )}
    </>
  )
}
