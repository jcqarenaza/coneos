'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AdminSidebar from './AdminSidebar'

export default function AdminSidebarWrapper() {
  const params = useParams()
  const slug = params?.empresa as string
  const router = useRouter()
  const [usuarioNombre, setUsuarioNombre] = useState('')
  const [empresaNombre, setEmpresaNombre] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function init() {
      const supabase = createClient()

      const stored = localStorage.getItem('coneos-auth')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token })
        } catch { /* ignorar */ }
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace(`/${slug}/login`); return }

      const { data: ua } = await supabase
        .from('usuarios_admin')
        .select('nombre, empresa_id, empresas(nombre, slug)')
        .eq('id', session.user.id)
        .single()

      if (!ua) { router.replace(`/${slug}/login`); return }

      const empresaSlug = (ua.empresas as { nombre: string; slug: string } | null)?.slug
      if (empresaSlug && empresaSlug !== slug) {
        router.replace(`/${empresaSlug}/admin`)
        return
      }

      if (ua.nombre) setUsuarioNombre(ua.nombre)
      const empNombre = (ua.empresas as { nombre: string; slug: string } | null)?.nombre
      if (empNombre) setEmpresaNombre(empNombre)
      setReady(true)
    }
    init()
  }, [slug, router])

  if (!ready) return (
    <div className="w-56 bg-white border-r border-neutral-100 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-neutral-200 border-t-neutral-400 rounded-full animate-spin" />
    </div>
  )

  return <AdminSidebar usuarioNombre={usuarioNombre} empresaNombre={empresaNombre} slug={slug} />
}
