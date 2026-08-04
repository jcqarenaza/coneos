import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { ShoppingBag, Store, Users, Layers, TrendingUp, Clock } from 'lucide-react'

async function getSupabaseWithCookie() {
  const cookieStore = await cookies()
  const tokenCookie = cookieStore.get('sb-wpiwjpvjqshsgrxxwsld-auth-token')
  if (!tokenCookie) return null
  try {
    const raw = tokenCookie.value
    const jsonStr = raw.startsWith('base64-') ? Buffer.from(raw.replace('base64-', ''), 'base64').toString('utf-8') : raw
    const parsed = JSON.parse(jsonStr)
    if (!parsed.access_token) return null
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${parsed.access_token}` } }, auth: { persistSession: false } }
    )
  } catch { return null }
}

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }

export default async function AdminDashboard() {
  const supabase = await getSupabaseWithCookie()
  if (!supabase) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-neutral-400">Cargando...</p>
    </div>
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: ua } = await supabase.from('usuarios_admin').select('empresa_id, nombre').eq('id', user.id).single()
  const empresaId = ua?.empresa_id
  if (!empresaId) return null

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  const [
    { count: sucursales },
    { count: productos },
    { count: operadores },
    { data: pedidosHoy },
    { data: pedidosAyer },
    { data: pedidosActivos },
  ] = await Promise.all([
    supabase.from('sucursales').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
    supabase.from('productos').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
    supabase.from('operadores').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
    supabase.from('pedidos').select('total, estado').eq('empresa_id', empresaId).eq('fecha_pedido', hoy),
    supabase.from('pedidos').select('total').eq('empresa_id', empresaId).eq('fecha_pedido', ayer),
    supabase.from('pedidos').select('id, numero_pedido, estado, total, created_at').eq('empresa_id', empresaId).eq('fecha_pedido', hoy).in('estado', ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY']).order('numero_pedido', { ascending: false }).limit(5),
  ])

  const totalHoy = (pedidosHoy ?? []).reduce((acc, p) => acc + Number(p.total), 0)
  const totalAyer = (pedidosAyer ?? []).reduce((acc, p) => acc + Number(p.total), 0)
  const cantidadHoy = pedidosHoy?.length ?? 0
  const ticketPromedio = cantidadHoy > 0 ? totalHoy / cantidadHoy : 0

  const ESTADO_COLOR: Record<string, string> = {
    PENDING_PAYMENT: 'bg-red-100 text-red-700',
    PAID: 'bg-blue-100 text-blue-700',
    PREPARING: 'bg-amber-100 text-amber-700',
    READY: 'bg-green-100 text-green-700',
    DELIVERED: 'bg-neutral-100 text-neutral-500',
  }
  const ESTADO_LABEL: Record<string, string> = {
    PENDING_PAYMENT: 'Pendiente', PAID: 'Pagado', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado'
  }

  function tiempoRelativo(ts: string) {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (diff < 1) return 'Ahora'
    if (diff < 60) return `Hace ${diff} min`
    return `Hace ${Math.floor(diff / 60)}h`
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-neutral-400 text-sm">Buen día, {ua?.nombre ?? 'Admin'}</p>
        <h1 className="text-2xl font-bold text-neutral-900 mt-0.5">Dashboard</h1>
      </div>

      {/* Stats principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Ventas hoy</p>
            <div className="w-8 h-8 bg-green-50 rounded-xl flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-green-600" />
            </div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{formatPrecio(totalHoy)}</p>
          {totalAyer > 0 && (
            <p className={`text-xs mt-1 font-medium ${totalHoy >= totalAyer ? 'text-green-500' : 'text-red-400'}`}>
              {totalHoy >= totalAyer ? '↑' : '↓'} {formatPrecio(Math.abs(totalHoy - totalAyer))} vs ayer
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Pedidos hoy</p>
            <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
              <ShoppingBag className="h-4 w-4 text-blue-600" />
            </div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{cantidadHoy}</p>
          <p className="text-xs mt-1 text-neutral-400">Ticket promedio: {formatPrecio(ticketPromedio)}</p>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Sucursales</p>
            <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center">
              <Store className="h-4 w-4 text-purple-600" />
            </div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{sucursales ?? 0}</p>
          <p className="text-xs mt-1 text-neutral-400">{operadores ?? 0} operadores activos</p>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Catálogo</p>
            <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center">
              <Layers className="h-4 w-4 text-amber-600" />
            </div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{productos ?? 0}</p>
          <p className="text-xs mt-1 text-neutral-400">Productos activos</p>
        </div>
      </div>

      {/* Pedidos activos */}
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-neutral-400" />
            <h2 className="font-bold text-neutral-700">Pedidos activos hoy</h2>
          </div>
          <span className="text-xs text-neutral-400">{pedidosActivos?.length ?? 0} pedidos</span>
        </div>
        {!pedidosActivos || pedidosActivos.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <ShoppingBag className="h-8 w-8 text-neutral-200 mx-auto mb-2" />
            <p className="text-neutral-400 text-sm">Sin pedidos activos</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-50">
            {pedidosActivos.map((p: { id: string; numero_pedido: number; estado: string; total: number; created_at: string }) => (
              <div key={p.id} className="px-6 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-black text-neutral-800 text-base">#{p.numero_pedido}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${ESTADO_COLOR[p.estado]}`}>
                    {ESTADO_LABEL[p.estado]}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-neutral-400 text-xs">{tiempoRelativo(p.created_at)}</span>
                  <span className="text-neutral-700 font-bold text-sm">{formatPrecio(p.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
