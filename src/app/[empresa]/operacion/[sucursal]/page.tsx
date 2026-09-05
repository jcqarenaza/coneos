'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, LogOut, Store, Coffee } from 'lucide-react'
import SeleccionOperador from '@/components/operacion/SeleccionOperador'
import VistaCaja from '@/components/operacion/VistaCaja'
import VistaPreparacion from '@/components/operacion/VistaPreparacion'
import LatidoDispositivo from '@/components/LatidoDispositivo'

interface Dispositivo {
  id: string; nombre: string; tipo: string; empresa_id: string; sucursal_id: string
  sucursales: { nombre: string; slug: string }
  empresas: { nombre: string; slug: string }
}

interface SesionOperador {
  session_id: string
  operador: { id: string; nombre: string; puede_cobrar: boolean; puede_preparar: boolean; sucursal_id: string | null }
}

export default function OperacionPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [dispositivo, setDispositivo] = useState<Dispositivo | null>(null)
  const [sesion, setSesion] = useState<SesionOperador | null>(null)
  const [vistaActiva, setVistaActiva] = useState<'caja' | 'preparacion'>('caja')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hora, setHora] = useState('')

  useEffect(() => {
    const tick = () => setHora(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!token) { setError('Dispositivo no configurado'); setLoading(false); return }
    fetch('/api/device/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_token: token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setDispositivo(data.dispositivo)
      })
      .catch(() => setError('Error de conexión'))
      .finally(() => setLoading(false))
  }, [token])

  const handleLogin = useCallback((s: SesionOperador) => {
    setSesion(s)
    if (s.operador.puede_cobrar) setVistaActiva('caja')
    else if (s.operador.puede_preparar) setVistaActiva('preparacion')
  }, [])

  const handleLogout = useCallback(async () => {
    if (!sesion) return
    await fetch('/api/operador/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sesion.session_id }),
    })
    setSesion(null)
  }, [sesion])

  if (loading) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-neutral-300" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <div className="text-center bg-white rounded-2xl p-8 shadow-sm">
        <Store className="h-10 w-10 text-neutral-200 mx-auto mb-3" />
        <p className="text-neutral-600 font-medium">{error}</p>
      </div>
    </div>
  )

  if (!dispositivo) return null

  if (!sesion) return (
    <>
      <LatidoDispositivo empresaId={dispositivo.empresa_id} sucursalId={dispositivo.sucursal_id} dispositivoId={dispositivo.id} tipo={dispositivo.tipo} />
      <SeleccionOperador dispositivo={dispositivo} onLogin={handleLogin} />
    </>
  )

  const { puede_cobrar, puede_preparar } = sesion.operador
  const tieneAmbos = puede_cobrar && puede_preparar

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <LatidoDispositivo empresaId={dispositivo.empresa_id} sucursalId={dispositivo.sucursal_id} dispositivoId={dispositivo.id} tipo={dispositivo.tipo} />
      {/* Header */}
      <header className="bg-white border-b border-neutral-100 px-5 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
            <Coffee className="h-4 w-4 text-neutral-500" />
          </div>
          <div>
            <p className="text-neutral-800 text-sm font-bold">{dispositivo.sucursales?.nombre}</p>
            <p className="text-neutral-400 text-xs">{dispositivo.nombre}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Tabs vista */}
          {tieneAmbos && (
            <div className="flex bg-neutral-100 rounded-xl p-1">
              <button onClick={() => setVistaActiva('caja')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${vistaActiva === 'caja' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
                Caja
              </button>
              <button onClick={() => setVistaActiva('preparacion')}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${vistaActiva === 'preparacion' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}>
                Preparación
              </button>
            </div>
          )}

          <span className="text-neutral-300 text-sm">{hora}</span>

          {/* Operador */}
          <div className="flex items-center gap-2 pl-3 border-l border-neutral-100">
            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-white">
              {sesion.operador.nombre[0].toUpperCase()}
            </div>
            <span className="text-neutral-600 text-sm font-medium hidden md:block">{sesion.operador.nombre}</span>
            <button onClick={handleLogout} className="p-1.5 text-neutral-300 hover:text-neutral-600 hover:bg-neutral-50 rounded-lg transition-colors ml-1" title="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {vistaActiva === 'caja' && puede_cobrar && <VistaCaja dispositivo={dispositivo} sesion={sesion} />}
        {vistaActiva === 'preparacion' && puede_preparar && <VistaPreparacion dispositivo={dispositivo} sesion={sesion} />}
      </main>
    </div>
  )
}
