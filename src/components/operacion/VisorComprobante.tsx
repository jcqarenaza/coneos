'use client'
// Visor del comprobante de transferencia en Caja (pieza de presentación; la firma y la renovación las maneja ComprobanteCaptura en VistaCaja).
// Imágenes (JPEG, PNG, WebP…): el mismo visor de siempre. PDF: un enlace explícito que abre la URL firmada en otra pestaña
// (un <img> no puede mostrar un PDF). No recibe ni muestra la URL guardada en la base: solo la URL firmada de 10 minutos.
import type { MouseEventHandler, ReactEventHandler } from 'react'
import type { TipoVisorCaptura } from '@/lib/comprobante-visor'

export const TEXTO_ABRIR_PDF = 'Abrir comprobante (PDF)'
export const TEXTO_ENLACE_PDF_DURA = 'El enlace dura 10 minutos; si venció, se renueva solo al tocarlo.'

export default function VisorComprobante({ url, tipo, onImagenError, onAbrirPdf }: {
  url: string
  tipo: TipoVisorCaptura
  onImagenError?: ReactEventHandler<HTMLImageElement>
  onAbrirPdf?: MouseEventHandler<HTMLAnchorElement>
}) {
  if (tipo === 'pdf') {
    return (
      <div className="text-center py-3">
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={onAbrirPdf}
          className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 bg-white border border-blue-200 rounded-xl px-4 py-2.5 hover:bg-blue-100">
          📄 {TEXTO_ABRIR_PDF}
        </a>
        <p className="text-[11px] text-neutral-400 mt-2">{TEXTO_ENLACE_PDF_DURA}</p>
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="Comprobante" onError={onImagenError}
        className="w-full max-h-64 object-contain rounded-xl border border-blue-100 bg-white cursor-zoom-in" />
    </a>
  )
}
