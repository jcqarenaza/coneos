'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AdminSidebar from './AdminSidebar'

export default function AdminSidebarWrapper() {
  const router = useRouter()
  const [usuarioNombre, setUsuarioNombre] = useState('')
  const [empresaNombre, setEmpresaNombre] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function init() {
      const supabase = createClient()

      // Intentar restaurar sesión desde localStorage
      const stored = localStorage.getItem('coneos-auth')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          await supabase.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
          })
        } catch { /* ignorar */ }
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/login'); return }

      const { data: ua } = await supabase
        .from('usuarios_admin')
        .select('nombre, empresa_id')
        .eq('id', session.user.id)
        .single()

      if (ua?.nombre) setUsuarioNombre(ua.nombre)
      if (ua?.empresa_id) {
        const { data: emp } = await supabase
          .from('empresas')
          .select('nombre')
          .eq('id', ua.empresa_id)
          .single()
        if (emp?.nombre) setEmpresaNombre(emp.nombre)
      }
      setReady(true)
    }
    init()
  }, [router])

  if (!ready) return (
    <div className="w-56 bg-white border-r border-neutral-100 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-neutral-200 border-t-neutral-400 rounded-full animate-spin" />
    </div>
  )

  return <AdminSidebar usuarioNombre={usuarioNombre} empresaNombre={empresaNombre} />
}
