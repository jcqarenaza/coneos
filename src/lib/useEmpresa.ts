'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export interface EmpresaContext {
  empresaId: string
  empresaSlug: string
  userId: string
}

export function useEmpresa() {
  const [ctx, setCtx] = useState<EmpresaContext | null>(null)
  const [loading, setLoading] = useState(true)
  const params = useParams()
  const router = useRouter()
  const slugFromUrl = params?.empresa as string | undefined

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      // Restaurar sesión desde localStorage si no hay session activa
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        const stored = localStorage.getItem('coneos-auth')
        if (!stored) {
          if (slugFromUrl) router.replace(`/${slugFromUrl}/login`)
          setLoading(false)
          return
        }
        try {
          const parsed = JSON.parse(stored)
          await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token })
        } catch {
          if (slugFromUrl) router.replace(`/${slugFromUrl}/login`)
          setLoading(false)
          return
        }
      }

      const { data: { session: finalSession } } = await supabase.auth.getSession()
      if (!finalSession) {
        if (slugFromUrl) router.replace(`/${slugFromUrl}/login`)
        setLoading(false)
        return
      }

      const { data: ua } = await supabase
        .from('usuarios_admin')
        .select('empresa_id')
        .eq('id', finalSession.user.id)
        .single()

      if (!ua?.empresa_id) { setLoading(false); return }

      const { data: empresa } = await supabase
        .from('empresas')
        .select('id, slug')
        .eq('id', ua.empresa_id)
        .single()

      if (!empresa) { setLoading(false); return }

      // Si hay slug en la URL, verificar que coincide con la empresa del usuario
      if (slugFromUrl && empresa.slug !== slugFromUrl) {
        router.replace(`/${empresa.slug}/admin`)
        return
      }

      setCtx({ empresaId: empresa.id, empresaSlug: empresa.slug, userId: finalSession.user.id })
      setLoading(false)
    }
    load()
  }, [slugFromUrl])

  return { ctx, loading }
}
