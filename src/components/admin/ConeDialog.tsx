'use client'

// ═══════════════════════════════════════════════════════════════════
// DIÁLOGOS PROPIOS — DP1 (GO JC 06/10): adiós a los carteles del
// navegador. Tres llamadas promesa-based, reemplazo 1:1:
//   alert(m)            →  avisar(m)            (se puede awaitear o no)
//   confirm(m)          →  await confirmar(m)   → boolean
//   prompt(m)           →  await pedirTexto(m)  → string | null
// Sin plomería: cada diálogo monta su propio root y se desmonta solo.
// La piel es la de ConeModal (misma casa, fondo blanco, botones Cone).
// ═══════════════════════════════════════════════════════════════════

import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'

type Opciones = { titulo?: string; confirmarLabel?: string; cancelarLabel?: string; peligro?: boolean; placeholder?: string }
type Modo = 'avisar' | 'confirmar' | 'pedirTexto'

function Dialogo({ modo, mensaje, opciones, onResolver }: {
  modo: Modo; mensaje: string; opciones: Opciones; onResolver: (v: boolean | string | null) => void
}) {
  const [texto, setTexto] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const titulo = opciones.titulo ?? (modo === 'avisar' ? 'Aviso' : modo === 'confirmar' ? 'Confirmar' : 'Un dato más')
  const ok = () => onResolver(modo === 'pedirTexto' ? texto : true)
  const cancelar = () => onResolver(modo === 'avisar' ? true : modo === 'pedirTexto' ? null : false)
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      onKeyDown={e => { if (e.key === 'Escape') cancelar(); if (e.key === 'Enter' && modo !== 'avisar') ok() }}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={cancelar} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <h2 className="font-bold text-neutral-900">{titulo}</h2>
          <button onClick={cancelar} className="text-neutral-400 hover:text-neutral-600 transition-colors text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-neutral-700 whitespace-pre-line">{mensaje}</p>
          {modo === 'pedirTexto' && (
            <input ref={inputRef} value={texto} onChange={e => setTexto(e.target.value)}
              placeholder={opciones.placeholder ?? ''} autoFocus
              className="mt-3 w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:border-neutral-400" />
          )}
        </div>
        <div className="px-6 py-4 border-t border-neutral-100 flex justify-end gap-2">
          {modo !== 'avisar' && (
            <button onClick={cancelar}
              className="inline-flex items-center gap-2 font-semibold rounded-xl px-4 py-2.5 text-sm border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition-all">
              {opciones.cancelarLabel ?? 'Cancelar'}</button>
          )}
          <button onClick={ok} autoFocus={modo !== 'pedirTexto'}
            className={`inline-flex items-center gap-2 font-semibold rounded-xl px-4 py-2.5 text-sm text-white shadow-sm transition-all ${opciones.peligro ? 'bg-red-500 hover:bg-red-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}>
            {opciones.confirmarLabel ?? (modo === 'avisar' ? 'Entendido' : 'Confirmar')}</button>
        </div>
      </div>
    </div>
  )
}

function abrir(modo: Modo, mensaje: string, opciones: Opciones = {}): Promise<boolean | string | null> {
  return new Promise(resolver => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const cerrar = (v: boolean | string | null) => {
      root.unmount(); host.remove(); resolver(v)
    }
    root.render(<Dialogo modo={modo} mensaje={mensaje} opciones={opciones} onResolver={cerrar} />)
  })
}

export function avisar(mensaje: string, opciones: Opciones = {}): Promise<void> {
  return abrir('avisar', mensaje, opciones).then(() => undefined)
}
export function confirmar(mensaje: string, opciones: Opciones = {}): Promise<boolean> {
  return abrir('confirmar', mensaje, opciones).then(v => v === true)
}
export function pedirTexto(mensaje: string, opciones: Opciones = {}): Promise<string | null> {
  return abrir('pedirTexto', mensaje, opciones).then(v => (typeof v === 'string' ? v : null))
}
