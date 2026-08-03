'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Delete, IceCream2 } from 'lucide-react'

interface Dispositivo {
  id: string
  empresa_id: string
  sucursal_id: string
  sucursales: { nombre: string }
  empresas: { nombre: string }
}

interface Operador { id: string; nombre: string }

interface SesionOperador {
  session_id: string
  operador: { id: string; nombre: string; puede_cobrar: boolean; puede_preparar: boolean }
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
    const nuevo = pin + digit
    setPin(nuevo)
    setError('')
    if (nuevo.length === 4) submitPin(nuevo)
  }

  function handleDelete() { setPin(p => p.slice(0, -1)); setError('') }

  async function submitPin(pinValue: string) {
    if (!seleccionado) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/operador/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operador_id: seleccionado.id,
        pin: pinValue,
        dispositivo_id: dispositivo.id,
        sucursal_id: dispositivo.sucursal_id,
        empresa_id: dispositivo.empresa_id,
      }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError('PIN incorrecto')
      setPin('')
      return
    }

    onLogin(data)
  }

  const digits = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <IceCream2 className="h-6 w-6 text-neutral-400" />
            <span className="text-neutral-500 text-sm font-medium">{dispositivo.empresas?.nombre}</span>
          </div>
          <h1 className="text-neutral-800 text-2xl font-bold">{dispositivo.sucursales?.nombre}</h1>
        </div>

        {!seleccionado ? (
          <div>
            <p className="text-neutral-500 text-sm text-center mb-4 font-medium">Seleccioná tu usuario</p>
            {loadingOps ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-neutral-300" />
              </div>
            ) : (
              <div className="space-y-2">
                {operadores.map(op => (
                  <button
                    key={op.id}
                    onClick={() => setSeleccionado(op)}
                    className="w-full py-4 px-5 bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-300 rounded-xl text-neutral-800 text-lg font-medium text-left transition-colors shadow-sm"
                  >
                    {op.nombre}
                  </button>
                ))}
                {operadores.length === 0 && (
                  <p className="text-center text-neutral-400 py-8 text-sm">No hay operadores configurados</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <button
                onClick={() => { setSeleccionado(null); setPin(''); setError('') }}
                className="text-neutral-400 text-sm hover:text-neutral-600 transition-colors mb-3"
              >
                ← Volver
              </button>
              <div className="w-12 h-12 rounded-full bg-neutral-200 flex items-center justify-center text-xl font-bold text-neutral-600 mx-auto mb-2">
                {seleccionado.nombre[0]}
              </div>
              <p className="text-neutral-800 text-xl font-semibold">{seleccionado.nombre}</p>
              <p className="text-neutral-400 text-sm mt-1">Ingresá tu PIN</p>
            </div>

            {/* Indicador PIN */}
            <div className="flex justify-center gap-3 mb-4">
              {[0,1,2,3].map(i => (
                <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                  i < pin.length ? 'bg-neutral-800 border-neutral-800' : 'bg-transparent border-neutral-300'
                }`} />
              ))}
            </div>

            {error && <p className="text-red-500 text-sm text-center mb-3">{error}</p>}

            {/* Teclado */}
            <div className="grid grid-cols-3 gap-3">
              {digits.map((d, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (d === '⌫') handleDelete()
                    else if (d !== '') handlePin(d)
                  }}
                  disabled={loading || d === ''}
                  className={`py-4 rounded-xl text-xl font-semibold transition-colors ${
                    d === '' ? 'invisible' :
                    d === '⌫' ? 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 active:bg-neutral-300' :
                    'bg-white border border-neutral-200 text-neutral-800 hover:bg-neutral-50 active:bg-neutral-100 shadow-sm'
                  } disabled:opacity-50`}
                >
                  {loading && d === '0'
                    ? <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    : d === '⌫'
                    ? <Delete className="h-5 w-5 mx-auto" />
                    : d}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
