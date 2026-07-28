import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShoppingBag, Store, Users, Layers } from 'lucide-react'
import type { Database } from '@/types/database.types'

async function getSupabaseWithCookie() {
  const cookieStore = await cookies()
  const tokenCookie = cookieStore.get('sb-wpiwjpvjqshsgrxxwsld-auth-token')
  if (!tokenCookie) return null

  const raw = tokenCookie.value
  const jsonStr = raw.startsWith('base64-')
    ? Buffer.from(raw.replace('base64-', ''), 'base64').toString('utf-8')
    : raw
  const parsed = JSON.parse(jsonStr)
  const accessToken = parsed.access_token

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    }
  )
}

export default async function AdminDashboard() {
  const supabase = await getSupabaseWithCookie()
  if (!supabase) return null

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: usuarioAdmin } = await supabase
    .from('usuarios_admin')
    .select('empresa_id')
    .eq('id', user.id)
    .single()

  const empresaId = usuarioAdmin?.empresa_id
  if (!empresaId) return null

  const [
    { count: sucursales },
    { count: productos },
    { count: operadores },
    { count: pedidosHoy }
  ] = await Promise.all([
    supabase.from('sucursales').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
    supabase.from('productos').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
    supabase.from('operadores').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
    supabase.from('pedidos').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('fecha_pedido', new Date().toISOString().split('T')[0]),
  ])

  const stats = [
    { label: 'Sucursales', value: sucursales ?? 0, icon: Store },
    { label: 'Productos activos', value: productos ?? 0, icon: Layers },
    { label: 'Operadores', value: operadores ?? 0, icon: Users },
    { label: 'Pedidos hoy', value: pedidosHoy ?? 0, icon: ShoppingBag },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-medium text-neutral-900">Dashboard</h1>
        <p className="text-sm text-neutral-500 mt-1">Resumen de tu operación</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-neutral-500">{label}</CardTitle>
              <Icon className="h-4 w-4 text-neutral-400" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-medium text-neutral-900">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 p-6 bg-white rounded-xl border border-neutral-200">
        <p className="text-sm text-neutral-500 font-medium mb-1">Sprint 2 en curso</p>
        <p className="text-sm text-neutral-400">Catálogo, sucursales y configuración disponibles en el menú lateral.</p>
      </div>
    </div>
  )
}
