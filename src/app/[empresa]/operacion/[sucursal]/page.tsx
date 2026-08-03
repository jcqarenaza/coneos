'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'
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
  const params = useParams()
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
    // Determinar vista inicial según permisos
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
    <div className="min-h-screen bg-neutral-900 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-white" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-neutral-900 flex items-center justify-center">
      <div className="text-center">
        <p className="text-white text-lg font-medium mb-2">Error de dispositivo</p>
        <p className="text-neutral-400 text-sm">{error}</p>
      </div>
    </div>
  )

  if (!dispositivo) return null

  // Pantalla de selección de operador
  if (!sesion) return (
    <SeleccionOperador
      dispositivo={dispositivo}
      onLogin={handleLogin}
    />
  )

  const { puede_cobrar, puede_preparar } = sesion.operador
  const tieneAmbos = puede_cobrar && puede_preparar

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col">
      {/* Header */}
      <header className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-white text-sm font-medium">{dispositivo.sucursales?.nombre}</p>
            <p className="text-neutral-400 text-xs">{dispositivo.nombre}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Tabs si tiene ambos permisos */}
          {tieneAmbos && (
            <div className="flex bg-neutral-800 rounded-lg p-1">
              <button
                onClick={() => setVistaActiva('caja')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  vistaActiva === 'caja'
                    ? 'bg-white text-neutral-900'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Caja
              </button>
              <button
                onClick={() => setVistaActiva('preparacion')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  vistaActiva === 'preparacion'
                    ? 'bg-white text-neutral-900'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Preparación
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-neutral-400 text-sm">{sesion.operador.nombre}</span>
            <button
              onClick={handleLogout}
              className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 overflow-hidden">
        {vistaActiva === 'caja' && puede_cobrar && (
          <VistaCaja
            dispositivo={dispositivo}
            sesion={sesion}
          />
        )}
        {vistaActiva === 'preparacion' && puede_preparar && (
          <VistaPreparacion
            dispositivo={dispositivo}
            sesion={sesion}
          />
        )}
      </main>
    </div>
  )
}
