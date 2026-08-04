'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, IceCream2 } from 'lucide-react'
import Image from 'next/image'

export default function LoginPage() {
  const params = useParams()
  const slug = params?.empresa as string
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [config, setConfig] = useState<{ primary_color: string; secondary_color: string; logo_url: string | null; nombre: string } | null>(null)

  useEffect(() => {
    // Cargar config de la empresa por slug
    fetch(`/api/empresa/config?slug=${slug}`)
      .then(r => r.json())
      .then(data => { if (!data.error) setConfig(data) })
      .catch(() => {})
  }, [slug])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError || !data.session) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
      return
    }

    // Verificar que el usuario pertenece a esta empresa
    const { data: ua } = await supabase.from('usuarios_admin').select('empresa_id, empresas(slug)').eq('id', data.session.user.id).single()

    const empresaSlug = (ua?.empresas as { slug: string } | null)?.slug
    if (!empresaSlug || empresaSlug !== slug) {
      await supabase.auth.signOut()
      setError('No tenés acceso a esta empresa')
      setLoading(false)
      return
    }

    // Guardar en localStorage para persistencia
    localStorage.setItem('coneos-auth', JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }))

    router.replace(`/${slug}/admin`)
  }

  const primary = config?.primary_color ?? '#1a2744'

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / nombre empresa */}
        <div className="text-center mb-8">
          {config?.logo_url ? (
            <Image src={config.logo_url} alt={config.nombre} width={160} height={64} className="object-contain mx-auto mb-3" />
          ) : (
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: primary }}>
              <IceCream2 className="h-7 w-7 text-white" />
            </div>
          )}
          <h1 className="text-xl font-bold text-neutral-800">{config?.nombre ?? slug}</h1>
          <p className="text-neutral-400 text-sm mt-0.5">Panel de administración</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm border border-neutral-100 p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-neutral-800 text-sm focus:outline-none focus:border-neutral-400 bg-neutral-50"
              placeholder="admin@heladeria.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Contraseña</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 text-neutral-800 text-sm focus:outline-none focus:border-neutral-400 bg-neutral-50"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-white font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: primary }}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Ingresando...</> : 'Ingresar'}
          </button>
        </form>

        <p className="text-center text-neutral-300 text-xs mt-6">ConeOS · Plataforma para heladerías</p>
      </div>
    </div>
  )
}
