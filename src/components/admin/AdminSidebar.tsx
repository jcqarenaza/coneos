'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard, Layers, Store, Users, Monitor, Settings, LogOut, IceCream2
} from 'lucide-react'

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/catalogo', label: 'Catálogo', icon: Layers },
  { href: '/admin/sucursales', label: 'Sucursales', icon: Store },
  { href: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { href: '/admin/dispositivos', label: 'Dispositivos', icon: Monitor },
  { href: '/admin/config', label: 'Configuración', icon: Settings },
]

interface Props {
  usuarioNombre: string
  empresaNombre: string
}

export default function AdminSidebar({ usuarioNombre, empresaNombre }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-neutral-200 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <IceCream2 className="h-5 w-5 text-neutral-700" />
          <span className="font-medium text-neutral-900">ConeOS</span>
        </div>
        <p className="text-xs text-neutral-400 mt-1 truncate">{empresaNombre}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive(href, exact)
                ? 'bg-neutral-100 text-neutral-900 font-medium'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
            }`}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Usuario */}
      <div className="p-4 border-t border-neutral-100">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 truncate">{usuarioNombre}</p>
            <p className="text-xs text-neutral-400">Administrador</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
            title="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
