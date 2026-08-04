'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import type { EmpresaConfig, DispositivoKiosk } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Categoria { id: string; nombre: string; icono_url: string | null }

interface Props {
  config: EmpresaConfig
  dispositivo: DispositivoKiosk
  onComenzar: (categoriaId?: string) => void
}

const CATEGORIA_GRADIENTS: Record<string, string> = {
  'helado': 'from-rose-50 to-pink-100',
  'kilo': 'from-rose-50 to-pink-100',
  'balde': 'from-blue-50 to-cyan-100',
  'bombon': 'from-amber-50 to-orange-100',
  'envasa': 'from-amber-50 to-orange-100',
  'torta': 'from-purple-50 to-violet-100',
  'palito': 'from-emerald-50 to-teal-100',
  'copa': 'from-yellow-50 to-amber-100',
}

const CATEGORIA_EMOJI: Record<string, string> = {
  'helado': '🍦', 'kilo': '🍦', 'balde': '🧊',
  'bombon': '🍫', 'envasa': '🍫', 'torta': '🎂',
  'palito': '🍡', 'copa': '🍨',
}

function getGradient(nombre: string): string {
  const n = nombre.toLowerCase()
  for (const [key, val] of Object.entries(CATEGORIA_GRADIENTS)) {
    if (n.includes(key)) return val
  }
  return 'from-neutral-50 to-neutral-100'
}

function getEmoji(nombre: string): string {
  const n = nombre.toLowerCase()
  for (const [key, val] of Object.entries(CATEGORIA_EMOJI)) {
    if (n.includes(key)) return val
  }
  return '🍨'
}

export default function KioskInicio({ config, dispositivo, onComenzar }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [hora, setHora] = useState('')

  useEffect(() => {
    fetch(`/api/kiosk/catalogo?empresa_id=${dispositivo.empresa_id}&sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json())
      .then(data => setCategorias(data.categorias ?? []))
    const tick = () => setHora(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [dispositivo])

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5">
        <div className="w-20 text-left">
          <span className="text-neutral-300 text-sm">{hora}</span>
        </div>
        <div className="flex-1 flex justify-center">
          {config.logo_url ? (
            <Image src={config.logo_url} alt="Logo" width={200} height={80} className="object-contain" style={{ maxHeight: 72 }} />
          ) : (
            <span className="text-2xl font-bold" style={{ color: config.primary_color }}>{dispositivo.empresas?.nombre}</span>
          )}
        </div>
        <div className="w-20" />
      </div>

      {/* Hero */}
      <div className="text-center px-8 pt-2 pb-10">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="h-px w-8 rounded" style={{ backgroundColor: config.secondary_color }} />
          <span className="text-sm font-medium tracking-widest uppercase" style={{ color: config.secondary_color }}>Bienvenido</span>
          <div className="h-px w-8 rounded" style={{ backgroundColor: config.secondary_color }} />
        </div>
        <h1 className="text-5xl font-bold mb-3" style={{ color: config.primary_color }}>
          ¿Qué querés<br />disfrutar hoy?
        </h1>
        <p className="text-neutral-400 text-lg">Tocá una categoría para comenzar</p>
      </div>

      {/* Categorías */}
      <div className="flex-1 px-6 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {categorias.map(cat => (
            <button
              key={cat.id}
              onClick={() => onComenzar(cat.id)}
              className={`group relative flex flex-col items-center justify-end p-5 rounded-3xl bg-gradient-to-br ${getGradient(cat.nombre)} border border-white/80 shadow-sm hover:shadow-lg active:scale-95 transition-all duration-200 min-h-[180px] overflow-hidden`}
            >
              {/* Emoji grande de fondo */}
              <span className="absolute top-4 left-1/2 -translate-x-1/2 text-7xl opacity-90 group-hover:scale-110 transition-transform duration-200 pointer-events-none select-none">
                {cat.icono_url ? '' : getEmoji(cat.nombre)}
              </span>
              {cat.icono_url && (
                <Image src={cat.icono_url} alt={cat.nombre} width={80} height={80} className="absolute top-4 object-contain opacity-90" />
              )}
              {/* Nombre */}
              <div className="relative z-10 text-center mt-auto pt-14">
                <span className="text-base font-bold text-neutral-700">{cat.nombre}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4">
        <p className="text-neutral-300 text-xs tracking-wide">ConeOS · Sistema de pedidos</p>
      </div>
    </div>
  )
}
