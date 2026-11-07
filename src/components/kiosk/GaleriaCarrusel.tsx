'use client'

// MULTI-FOTOS — visor a pantalla completa con carrusel (kiosk, delivery, mesa, take away).
// Sin librerías: scroll-snap horizontal (deslizar con el dedo) + flechas + teclado.
import { useEffect, useRef, useState, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

interface Props { fotos: string[]; titulo: string; inicial?: number; onCerrar: () => void }

export default function GaleriaCarrusel({ fotos, titulo, inicial = 0, onCerrar }: Props) {
  const pista = useRef<HTMLDivElement>(null)
  const [idx, setIdx] = useState(inicial)

  const irA = useCallback((i: number) => {
    const el = pista.current
    if (!el) return
    const n = Math.max(0, Math.min(fotos.length - 1, i))
    el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' })
  }, [fotos.length])

  useEffect(() => {
    const el = pista.current
    if (el) el.scrollLeft = inicial * el.clientWidth
  }, [inicial])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
      else if (e.key === 'ArrowRight') irA(idx + 1)
      else if (e.key === 'ArrowLeft') irA(idx - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, irA, onCerrar])

  if (fotos.length === 0) return null
  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex flex-col" role="dialog" aria-modal="true" aria-label={`Fotos de ${titulo}`}
      onClick={onCerrar}>
      <div className="flex items-center justify-between px-4 py-3 text-white" onClick={e => e.stopPropagation()}>
        <p className="font-semibold truncate pr-3">{titulo}</p>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-sm text-white/70">{idx + 1} / {fotos.length}</span>
          <button onClick={onCerrar} aria-label="Cerrar" className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0" onClick={e => e.stopPropagation()}>
        <div ref={pista}
          onScroll={e => { const el = e.currentTarget; setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))) }}
          className="h-full flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {fotos.map((src, i) => (
            <div key={src + i} className="w-full h-full flex-shrink-0 snap-center flex items-center justify-center p-4" onClick={onCerrar}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`${titulo} (${i + 1} de ${fotos.length})`} className="max-w-full max-h-full object-contain rounded-xl bg-white"
                onClick={e => e.stopPropagation()} loading={i === inicial ? 'eager' : 'lazy'} />
            </div>
          ))}
        </div>
        {fotos.length > 1 && idx > 0 && (
          <button onClick={() => irA(idx - 1)} aria-label="Foto anterior"
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/20 hover:bg-white/35 text-white items-center justify-center">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {fotos.length > 1 && idx < fotos.length - 1 && (
          <button onClick={() => irA(idx + 1)} aria-label="Foto siguiente"
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/20 hover:bg-white/35 text-white items-center justify-center">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
      {fotos.length > 1 && (
        <div className="flex items-center justify-center gap-2 py-4" onClick={e => e.stopPropagation()}>
          {fotos.map((_, i) => (
            <button key={i} onClick={() => irA(i)} aria-label={`Ir a la foto ${i + 1}`}
              className={`h-2 rounded-full transition-all ${i === idx ? 'w-6 bg-white' : 'w-2 bg-white/40'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
