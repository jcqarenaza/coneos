'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, LogOut, IceCream2 } from 'lucide-react'
import SeleccionOperador from '@/components/operacion/SeleccionOperador'
import VistaCaja from '@/components/operacion/VistaCaja'
import VistaPreparacion from '@/components/operacion/VistaPreparacion'

interface Dispositivo {
  id: string
  nombre: string
  tipo: string
  empresa_id: string
  sucursal_id: string
  sucursales: { nombre: string; slug: string }
  empresas: { nombre: string; slug: string }
}

interface SesionOperador {
  session_id: string
  operador: {
    id: string
    nombre: string
    puede_cobrar: boolean
    puede_preparar: boolean
  }
}

type Vista = 'caja' | 'preparacion'

export default function OperacionPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [dispositivo, setDispositivo] = useState<Dispositivo | null>(null)
  const [sesion, setSesion] = useState<SesionOperador | null>(null)
  const [vistaActiva, setVistaActiva] = useState<Vista>('caja')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setError('Token de dispositivo no encontrado'); setLoading(false); return }

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
      .catch(() => setError('Error al verificar dispositivo'))
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
      <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <div className="text-center">
        <IceCream2 className="h-10 w-10 text-neutral-300 mx-auto mb-3" />
        <p className="text-neutral-600 font-medium mb-1">Error de dispositivo</p>
        <p className="text-neutral-400 text-sm">{error}</p>
      </div>
    </div>
  )

  if (!dispositivo) return null

  if (!sesion) return (
    <SeleccionOperador dispositivo={dispositivo} onLogin={handleLogin} />
  )

  const { puede_cobrar, puede_preparar } = sesion.operador
  const tieneAmbos = puede_cobrar && puede_preparar

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-5 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <IceCream2 className="h-5 w-5 text-neutral-400" />
          <div>
            <p className="text-neutral-800 text-sm font-semibold">{dispositivo.sucursales?.nombre}</p>
            <p className="text-neutral-400 text-xs">{dispositivo.nombre}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {tieneAmbos && (
            <div className="flex bg-neutral-100 rounded-lg p-1">
              <button
                onClick={() => setVistaActiva('caja')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  vistaActiva === 'caja'
                    ? 'bg-white text-neutral-900 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Caja
              </button>
              <button
                onClick={() => setVistaActiva('preparacion')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  vistaActiva === 'preparacion'
                    ? 'bg-white text-neutral-900 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Preparación
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 pl-2 border-l border-neutral-200">
            <div className="w-7 h-7 rounded-full bg-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-600">
              {sesion.operador.nombre[0]}
            </div>
            <span className="text-neutral-600 text-sm font-medium">{sesion.operador.nombre}</span>
            <button
              onClick={handleLogout}
              className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors ml-1"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {vistaActiva === 'caja' && puede_cobrar && (
          <VistaCaja dispositivo={dispositivo} sesion={sesion} />
        )}
        {vistaActiva === 'preparacion' && puede_preparar && (
          <VistaPreparacion dispositivo={dispositivo} sesion={sesion} />
        )}
      </main>
    </div>
  )
}
