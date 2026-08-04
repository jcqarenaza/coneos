import { cookies } from 'next/headers'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import AdminSidebar from '@/components/admin/AdminSidebar'

async function getSession() {
  const cookieStore = await cookies()
  const tokenCookie = cookieStore.get('sb-wpiwjpvjqshsgrxxwsld-auth-token')
  if (!tokenCookie) return null
  try {
    const raw = tokenCookie.value
    const jsonStr = raw.startsWith('base64-')
      ? Buffer.from(raw.replace('base64-', ''), 'base64').toString('utf-8')
      : raw
    const parsed = JSON.parse(jsonStr)
    return parsed.access_token ? parsed : null
  } catch { return null }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  let usuarioNombre = 'Admin'
  let empresaNombre = ''

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${session.access_token}` } }, auth: { persistSession: false } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: ua } = await supabase.from('usuarios_admin').select('nombre, empresa_id').eq('id', user.id).single()
      if (ua?.nombre) usuarioNombre = ua.nombre
      if (ua?.empresa_id) {
        const { data: emp } = await supabase.from('empresas').select('nombre').eq('id', ua.empresa_id).single()
        if (emp?.nombre) empresaNombre = emp.nombre
      }
    }
  } catch { /* continuar con defaults */ }

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <AdminSidebar usuarioNombre={usuarioNombre} empresaNombre={empresaNombre} />
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  )
}
