'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, BookOpen, Store, Users, Monitor, Settings, IceCream2, BarChart3 } from 'lucide-react'

interface Props { usuarioNombre: string; empresaNombre: string }

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/catalogo', label: 'Catálogo', icon: BookOpen },
  { href: '/admin/sucursales', label: 'Sucursales', icon: Store },
  { href: '/admin/operacion', label: 'Equipo', icon: Users },
  { href: '/admin/ventas', label: 'Ventas', icon: BarChart3 },
  { href: '/admin/config', label: 'Configuración', icon: Settings },
]

export default function AdminSidebar({ usuarioNombre, empresaNombre }: Props) {
  const pathname = usePathname()

  return (
    <aside className="w-56 bg-white border-r border-neutral-100 flex flex-col min-h-screen shadow-sm">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-neutral-100">
        <div className="flex items-center gap-2.5 mb-0.5">
          <div className="w-7 h-7 bg-neutral-800 rounded-lg flex items-center justify-center">
            <IceCream2 className="h-4 w-4 text-white" />
          </div>
          <span className="font-black text-neutral-800">ConeOS</span>
        </div>
        <p className="text-xs text-neutral-400 ml-9">{empresaNombre}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(item => {
          const active = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                active ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50'
              }`}>
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Usuario */}
      <div className="px-4 py-4 border-t border-neutral-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center text-white text-xs font-bold">
            {usuarioNombre?.[0]?.toUpperCase() ?? 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-neutral-700 truncate">{usuarioNombre}</p>
            <p className="text-xs text-neutral-400">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
