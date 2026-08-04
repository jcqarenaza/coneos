'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

export default function LoginRoot() {
  const router = useRouter()
  useEffect(() => {
    async function check() {
      const supabase = createClient()
      const stored = localStorage.getItem('coneos-auth')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token })
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            const { data: ua } = await supabase.from('usuarios_admin').select('empresas(slug)').eq('id', session.user.id).single()
            const slug = (ua?.empresas as { slug: string } | null)?.slug
            if (slug) { router.replace(`/${slug}/admin`); return }
          }
        } catch { /* ignorar */ }
      }
      router.replace('/404')
    }
    check()
  }, [router])
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-neutral-300" />
    </div>
  )
}
