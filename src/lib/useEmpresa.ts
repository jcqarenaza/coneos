'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface EmpresaContext {
  empresaId: string
  empresaSlug: string
  userId: string
}

export function useEmpresa() {
  const [ctx, setCtx] = useState<EmpresaContext | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      // Intentar recuperar sesión del storage
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        // Si no hay sesión, intentar recuperar del localStorage manualmente
        const stored = localStorage.getItem('coneos-auth')
        if (!stored) { setLoading(false); return }

        try {
          const parsed = JSON.parse(stored)
          const { data, error } = await supabase.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
          })
          if (error || !data.session) { setLoading(false); return }
        } catch {
          setLoading(false)
          return
        }
      }

      const { data: { session: finalSession } } = await supabase.auth.getSession()
      if (!finalSession) { setLoading(false); return }

      const { data } = await supabase
        .from('usuarios_admin')
        .select('empresa_id, empresas(slug)')
        .eq('id', finalSession.user.id)
        .single()

      if (data) {
        const empresa = data.empresas as { slug: string } | null
        setCtx({
          empresaId: data.empresa_id!,
          empresaSlug: empresa?.slug ?? '',
          userId: finalSession.user.id,
        })
      }
      setLoading(false)
    }
    load()
  }, [])

  return { ctx, loading }
}
