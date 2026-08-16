'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Delete } from 'lucide-react'

interface Dispositivo { id: string; empresa_id: string; sucursal_id: string; sucursales: { nombre: string }; empresas: { nombre: string } }
interface Operador { id: string; nombre: string }
interface SesionOperador { session_id: string; operador: { id: string; nombre: string; puede_cobrar: boolean; puede_preparar: boolean; sucursal_id: string | null } }
interface Props { dispositivo: Dispositivo; onLogin: (sesion: SesionOperador) => void }

export default function SeleccionOperador({ dispositivo, onLogin }: Props) {
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [seleccionado, setSeleccionado] = useState<Operador | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingOps, setLoadingOps] = useState(true)

  useEffect(() => {
    if (!seleccionado) return
    function onKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') handlePin(e.key)
      else if (e.key === 'Backspace') handleDelete()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seleccionado, pin])

  useEffect(() => {
    const supabase = createClient()
    supabase.from('operadores').select('id, nombre')
      .eq('empresa_id', dispositivo.empresa_id)
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => { setOperadores((data ?? []) as Operador[]); setLoadingOps(false) })
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
    const res = await fetch('/api/operador/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operador_id: seleccionado.id, pin: pinValue,
        dispositivo_id: dispositivo.id, sucursal_id: dispositivo.sucursal_id,
        empresa_id: dispositivo.empresa_id,
      }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError('PIN incorrecto'); setPin(''); return }
    onLogin(data)
  }

  const digits = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 bg-neutral-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl">🍦</span>
          </div>
          <h1 className="text-neutral-800 text-xl font-bold">{dispositivo.empresas?.nombre}</h1>
          <p className="text-neutral-400 text-sm mt-1">{dispositivo.sucursales?.nombre}</p>
        </div>

        {!seleccionado ? (
          <div>
            <p className="text-neutral-500 text-sm text-center mb-4 font-medium">¿Quién sos?</p>
            {loadingOps ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-neutral-300" /></div>
            ) : (
              <div className="space-y-2">
                {operadores.map(op => (
                  <button key={op.id} onClick={() => setSeleccionado(op)}
                    className="w-full py-4 px-5 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-2xl text-neutral-800 text-base font-semibold text-left transition-colors shadow-sm active:scale-98">
                    {op.nombre}
                  </button>
                ))}
                {operadores.length === 0 && <p className="text-center text-neutral-400 py-8 text-sm">No hay operadores configurados</p>}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-center mb-8">
              <button onClick={() => { setSeleccionado(null); setPin(''); setError('') }}
                className="text-neutral-400 text-sm hover:text-neutral-600 mb-4 transition-colors">
                ← Cambiar usuario
              </button>
              <div className="w-14 h-14 rounded-2xl bg-neutral-800 flex items-center justify-center text-2xl font-bold text-white mx-auto mb-3">
                {seleccionado.nombre[0].toUpperCase()}
              </div>
              <p className="text-neutral-800 text-xl font-bold">{seleccionado.nombre}</p>
              <p className="text-neutral-400 text-sm mt-1">Ingresá tu PIN</p>
            </div>

            {/* Dots */}
            <div className="flex justify-center gap-4 mb-3">
              {[0,1,2,3].map(i => (
                <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${i < pin.length ? 'bg-neutral-800 border-neutral-800 scale-110' : 'bg-transparent border-neutral-300'}`} />
              ))}
            </div>

            {error && <p className="text-red-500 text-sm text-center mb-4">{error}</p>}
            {!error && <div className="h-6 mb-4" />}

            {/* Teclado */}
            <div className="grid grid-cols-3 gap-3">
              {digits.map((d, i) => (
                <button key={i}
                  onClick={() => { if (d === '⌫') handleDelete(); else if (d !== '') handlePin(d) }}
                  disabled={loading || d === ''}
                  className={`py-5 rounded-2xl text-xl font-bold transition-all active:scale-95 ${
                    d === '' ? 'invisible' :
                    d === '⌫' ? 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200' :
                    'bg-white border border-neutral-200 text-neutral-800 hover:bg-neutral-50 shadow-sm'
                  } disabled:opacity-50`}>
                  {loading && d === '0'
                    ? <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    : d === '⌫' ? <Delete className="h-5 w-5 mx-auto" /> : d}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
