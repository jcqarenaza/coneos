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

      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        const stored = localStorage.getItem('coneos-auth')
        if (!stored) { setLoading(false); return }

        try {
          const parsed = JSON.parse(stored)
          const { error } = await supabase.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
          })
          if (error) { setLoading(false); return }
        } catch {
          setLoading(false)
          return
        }
      }

      const { data: { session: finalSession } } = await supabase.auth.getSession()
      if (!finalSession) { setLoading(false); return }

      const { data } = await supabase
        .from('usuarios_admin')
        .select('empresa_id')
        .eq('id', finalSession.user.id)
        .single()

      if (!data?.empresa_id) { setLoading(false); return }

      // Query separada para obtener el slug de la empresa
      const { data: empresa } = await supabase
        .from('empresas')
        .select('slug')
        .eq('id', data.empresa_id)
        .single()

      setCtx({
        empresaId: data.empresa_id,
        empresaSlug: empresa?.slug ?? '',
        userId: finalSession.user.id,
      })
      setLoading(false)
    }
    load()
  }, [])

  return { ctx, loading }
}
