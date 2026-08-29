'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ShoppingBag, Store, Users, Layers, TrendingUp, Clock, Loader2, Bike } from 'lucide-react'

function formatPrecio(n: number) { return `$${Number(n).toLocaleString('es-AR')}` }
function tiempoRelativo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (diff < 1) return 'Ahora'
  if (diff < 60) return `Hace ${diff} min`
  return `Hace ${Math.floor(diff / 60)}h`
}

const ESTADO_COLOR: Record<string, string> = {
  PENDING_PAYMENT: 'bg-red-100 text-red-700', PAID: 'bg-blue-100 text-blue-700',
  PREPARING: 'bg-amber-100 text-amber-700', READY: 'bg-green-100 text-green-700',
}
const ESTADO_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Pendiente', PAID: 'Pagado', PREPARING: 'Preparando', READY: 'Listo',
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true)
  const [nombre, setNombre] = useState('')
  const [stats, setStats] = useState({ totalHoy: 0, totalAyer: 0, cantidadHoy: 0, sucursales: 0, productos: 0, operadores: 0 })
  const [pedidosActivos, setPedidosActivos] = useState<{ id: string; numero_pedido: number; estado: string; total: number; created_at: string }[]>([])
  const [empresaIdState, setEmpresaIdState] = useState<string | null>(null)
  const [periodoCadetes, setPeriodoCadetes] = useState<'hoy' | 'semana' | 'mes'>('hoy')
  const [cadetes, setCadetes] = useState<{ nombre: string; envios: number; transportado: number; efectivo: number }[]>([])
  const [cadetesLoading, setCadetesLoading] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const stored = localStorage.getItem('coneos-auth')
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token })
        } catch { /* ignorar */ }
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: ua } = await supabase.from('usuarios_admin').select('nombre, empresa_id').eq('id', session.user.id).single()
      if (!ua?.empresa_id) return
      if (ua.nombre) setNombre(ua.nombre)

      const empresaId = ua.empresa_id
      setEmpresaIdState(empresaId)
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
      const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

      const [
        { count: sucursales }, { count: productos }, { count: operadores },
        { data: pedidosHoy }, { data: pedidosAyer }, { data: activos },
      ] = await Promise.all([
        supabase.from('sucursales').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
        supabase.from('productos').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
        supabase.from('operadores').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('activo', true),
        supabase.from('pedidos').select('total').eq('empresa_id', empresaId).eq('fecha_pedido', hoy),
        supabase.from('pedidos').select('total').eq('empresa_id', empresaId).eq('fecha_pedido', ayer),
        supabase.from('pedidos').select('id, numero_pedido, estado, total, created_at').eq('empresa_id', empresaId).eq('fecha_pedido', hoy).in('estado', ['PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY']).order('numero_pedido', { ascending: false }).limit(8),
      ])

      const totalHoy = (pedidosHoy ?? []).reduce((acc, p) => acc + Number(p.total), 0)
      const totalAyer = (pedidosAyer ?? []).reduce((acc, p) => acc + Number(p.total), 0)
      setStats({ totalHoy, totalAyer, cantidadHoy: pedidosHoy?.length ?? 0, sucursales: sucursales ?? 0, productos: productos ?? 0, operadores: operadores ?? 0 })
      setPedidosActivos(activos ?? [])
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (!empresaIdState) return
    async function loadCadetes() {
      setCadetesLoading(true)
      const supabase = createClient()
      const ahora = new Date()
      const hoyStr = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
      let desde = hoyStr
      if (periodoCadetes === 'semana') desde = new Date(ahora.getTime() - 6 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
      if (periodoCadetes === 'mes') desde = new Date(ahora.getTime() - 29 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
      const { data } = await supabase.from('pedidos')
        .select('colaborador_nombre, total, metodo_pago')
        .eq('empresa_id', empresaIdState).eq('tipo_pedido', 'delivery').eq('estado', 'DELIVERED')
        .not('colaborador_nombre', 'is', null)
        .gte('fecha_pedido', desde).lte('fecha_pedido', hoyStr)
      const agg: Record<string, { envios: number; transportado: number; efectivo: number }> = {}
      for (const p of data ?? []) {
        const k = (p.colaborador_nombre ?? '').trim()
        if (!k) continue
        if (!agg[k]) agg[k] = { envios: 0, transportado: 0, efectivo: 0 }
        agg[k].envios++
        agg[k].transportado += Number(p.total)
        if (p.metodo_pago === 'efectivo') agg[k].efectivo += Number(p.total)
      }
      setCadetes(Object.entries(agg).map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.envios - a.envios))
      setCadetesLoading(false)
    }
    loadCadetes()
  }, [empresaIdState, periodoCadetes])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-neutral-300" />
    </div>
  )


  const ticketPromedio = stats.cantidadHoy > 0 ? stats.totalHoy / stats.cantidadHoy : 0

  return (
    <div>
      <div className="mb-8">
        <p className="text-neutral-400 text-sm">Buen día{nombre ? `, ${nombre}` : ''}</p>
        <h1 className="text-2xl font-bold text-neutral-900 mt-0.5">Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Ventas hoy</p>
            <div className="w-8 h-8 bg-green-50 rounded-xl flex items-center justify-center"><TrendingUp className="h-4 w-4 text-green-600" /></div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{formatPrecio(stats.totalHoy)}</p>
          {stats.totalAyer > 0 && (
            <p className={`text-xs mt-1 font-medium ${stats.totalHoy >= stats.totalAyer ? 'text-green-500' : 'text-red-400'}`}>
              {stats.totalHoy >= stats.totalAyer ? '↑' : '↓'} {formatPrecio(Math.abs(stats.totalHoy - stats.totalAyer))} vs ayer
            </p>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Pedidos hoy</p>
            <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center"><ShoppingBag className="h-4 w-4 text-blue-600" /></div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{stats.cantidadHoy}</p>
          <p className="text-xs mt-1 text-neutral-400">Ticket promedio: {formatPrecio(ticketPromedio)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Sucursales</p>
            <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center"><Store className="h-4 w-4 text-purple-600" /></div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{stats.sucursales}</p>
          <p className="text-xs mt-1 text-neutral-400">{stats.operadores} operadores activos</p>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-neutral-400 text-sm font-medium">Catálogo</p>
            <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center"><Layers className="h-4 w-4 text-amber-600" /></div>
          </div>
          <p className="text-2xl font-black text-neutral-800">{stats.productos}</p>
          <p className="text-xs mt-1 text-neutral-400">Productos activos</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-neutral-400" />
            <h2 className="font-bold text-neutral-700">Pedidos activos hoy</h2>
          </div>
          <span className="text-xs text-neutral-400">{pedidosActivos.length} pedidos</span>
        </div>
        {pedidosActivos.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <ShoppingBag className="h-8 w-8 text-neutral-200 mx-auto mb-2" />
            <p className="text-neutral-400 text-sm">Sin pedidos activos hoy</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-50">
            {pedidosActivos.map(p => (
              <div key={p.id} className="px-6 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-black text-neutral-800 text-base">#{p.numero_pedido}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${ESTADO_COLOR[p.estado]}`}>{ESTADO_LABEL[p.estado]}</span>
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

      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden mt-6">
        <div className="px-6 py-4 border-b border-neutral-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bike className="h-4 w-4 text-neutral-400" />
            <h2 className="font-bold text-neutral-700">Envíos por cadete</h2>
          </div>
          <div className="flex gap-1">
            {(['hoy', 'semana', 'mes'] as const).map(p => (
              <button key={p} onClick={() => setPeriodoCadetes(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${periodoCadetes === p ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}>
                {p === 'hoy' ? 'Hoy' : p === 'semana' ? '7 días' : '30 días'}
              </button>
            ))}
          </div>
        </div>
        {cadetesLoading ? (
          <div className="px-6 py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-neutral-200" /></div>
        ) : cadetes.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Bike className="h-8 w-8 text-neutral-200 mx-auto mb-2" />
            <p className="text-neutral-400 text-sm">Sin envíos con cadete asignado en el período</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-50">
            <div className="px-6 py-2.5 grid grid-cols-4 gap-2 text-xs text-neutral-400 font-semibold uppercase tracking-wide">
              <span>Cadete</span><span className="text-right">Envíos</span><span className="text-right">Transportado</span><span className="text-right">En efectivo</span>
            </div>
            {cadetes.map(c => (
              <div key={c.nombre} className="px-6 py-3.5 grid grid-cols-4 gap-2 items-center">
                <span className="font-bold text-neutral-800">{c.nombre}</span>
                <span className="text-right font-black text-neutral-800 text-lg">{c.envios}</span>
                <span className="text-right text-neutral-600 font-semibold text-sm">{formatPrecio(c.transportado)}</span>
                <span className="text-right text-neutral-400 text-sm">{formatPrecio(c.efectivo)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
