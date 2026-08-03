'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Delete } from 'lucide-react'

interface Dispositivo {
  id: string
  empresa_id: string
  sucursal_id: string
  sucursales: { nombre: string }
  empresas: { nombre: string }
}

interface Operador {
  id: string
  nombre: string
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

interface Props {
  dispositivo: Dispositivo
  onLogin: (sesion: SesionOperador) => void
}

export default function SeleccionOperador({ dispositivo, onLogin }: Props) {
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [seleccionado, setSeleccionado] = useState<Operador | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingOps, setLoadingOps] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('operadores')
      .select('id, nombre')
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('activo', true)
      .or(`sucursal_id.eq.${dispositivo.sucursal_id},sucursal_id.is.null`)
      .order('nombre')
      .then(({ data }) => {
        setOperadores((data ?? []) as Operador[])
        setLoadingOps(false)
      })
  }, [dispositivo])

  function handlePin(digit: string) {
    if (pin.length >= 4) return
    setPin(p => p + digit)
    setError('')
  }

  function handleDelete() {
    setPin(p => p.slice(0, -1))
    setError('')
  }

  async function handleLogin() {
    if (!seleccionado || pin.length !== 4) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/operador/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operador_id: seleccionado.id,
        pin,
        dispositivo_id: dispositivo.id,
        sucursal_id: dispositivo.sucursal_id,
        empresa_id: dispositivo.empresa_id,
      }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'PIN incorrecto')
      setPin('')
      return
    }

    onLogin(data)
  }

  // Auto-submit cuando PIN tiene 4 dígitos
  useEffect(() => {
    if (pin.length === 4 && seleccionado) {
      handleLogin()
    }
  }, [pin])

  const digits = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-neutral-400 text-sm">{dispositivo.empresas?.nombre}</p>
          <h1 className="text-white text-2xl font-medium mt-1">{dispositivo.sucursales?.nombre}</h1>
        </div>

        {!seleccionado ? (
          /* Lista de operadores */
          <div>
            <p className="text-neutral-400 text-sm text-center mb-4">Seleccioná tu usuario</p>
            {loadingOps ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
              </div>
            ) : (
              <div className="space-y-2">
                {operadores.map(op => (
                  <button
                    key={op.id}
                    onClick={() => setSeleccionado(op)}
                    className="w-full py-4 px-5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-xl text-white text-lg font-medium text-left transition-colors"
                  >
                    {op.nombre}
                  </button>
                ))}
                {operadores.length === 0 && (
                  <p className="text-center text-neutral-500 py-8">No hay operadores configurados para esta sucursal</p>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Teclado PIN */
          <div>
            <div className="text-center mb-6">
              <button
                onClick={() => { setSeleccionado(null); setPin(''); setError('') }}
                className="text-neutral-400 text-sm hover:text-white transition-colors mb-2"
              >
                ← Volver
              </button>
              <p className="text-white text-xl font-medium">{seleccionado.nombre}</p>
              <p className="text-neutral-400 text-sm mt-1">Ingresá tu PIN</p>
            </div>

            {/* Indicador PIN */}
            <div className="flex justify-center gap-3 mb-6">
              {[0,1,2,3].map(i => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-colors ${
                    i < pin.length
                      ? 'bg-white border-white'
                      : 'bg-transparent border-neutral-600'
                  }`}
                />
              ))}
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center mb-4">{error}</p>
            )}

            {/* Teclado numérico */}
            <div className="grid grid-cols-3 gap-3">
              {digits.map((d, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (d === '⌫') handleDelete()
                    else if (d !== '') handlePin(d)
                  }}
                  disabled={loading || d === ''}
                  className={`py-5 rounded-xl text-xl font-medium transition-colors ${
                    d === ''
                      ? 'invisible'
                      : d === '⌫'
                      ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 active:bg-neutral-600'
                      : 'bg-neutral-800 text-white hover:bg-neutral-700 active:bg-neutral-600'
                  } disabled:opacity-50`}
                >
                  {loading && d === '0' ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : d === '⌫' ? <Delete className="h-5 w-5 mx-auto" /> : d}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
