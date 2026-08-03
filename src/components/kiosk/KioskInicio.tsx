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

function emojiCategoria(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.includes('helado') || n.includes('kilo')) return '🍦'
  if (n.includes('balde')) return '🪣'
  if (n.includes('cono') || n.includes('bocha')) return '🍦'
  if (n.includes('bombon') || n.includes('envasa')) return '🍫'
  if (n.includes('torta')) return '🎂'
  if (n.includes('palito')) return '🍡'
  if (n.includes('copa')) return '🍨'
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
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#fdf8f4' }}>
      {/* Header */}
      <div className="w-full py-4 px-8 flex items-center justify-between" style={{ backgroundColor: config.primary_color }}>
        <div className="w-24" />
        <div className="flex items-center justify-center">
          {config.logo_url ? (
            <div className="bg-white rounded-xl px-5 py-2 flex items-center justify-center" style={{ minWidth: 160, maxWidth: 220 }}>
              <Image
                src={config.logo_url}
                alt={dispositivo.empresas?.nombre ?? 'Logo'}
                width={180}
                height={65}
                className="object-contain w-auto"
                style={{ maxHeight: 56 }}
              />
            </div>
          ) : (
            <span className="text-white text-2xl font-bold">{dispositivo.empresas?.nombre}</span>
          )}
        </div>
        <div className="text-right w-24">
          <p className="text-white/60 text-sm">{dispositivo.sucursales?.nombre}</p>
          <p className="text-white text-lg font-medium">{hora}</p>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10">
        <h1 className="text-4xl font-bold text-neutral-800 mb-2 text-center">¿Qué querés pedir?</h1>
        <p className="text-neutral-400 mb-10 text-center">Tocá una categoría para comenzar</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl mb-12">
          {categorias.map(cat => (
            <button
              key={cat.id}
              onClick={() => onComenzar(cat.id)}
              className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl shadow-sm border border-neutral-100 hover:shadow-md active:scale-95 transition-all gap-3 min-h-[140px]"
            >
              {cat.icono_url ? (
                <Image src={cat.icono_url} alt={cat.nombre} width={64} height={64} className="object-contain" />
              ) : (
                <span className="text-5xl">{emojiCategoria(cat.nombre)}</span>
              )}
              <span className="text-neutral-700 font-medium text-sm text-center">{cat.nombre}</span>
            </button>
          ))}
        </div>


      </div>

      <div className="py-4 text-center">
        <p className="text-neutral-300 text-xs">ConeOS · Sistema de pedidos</p>
      </div>
    </div>
  )
}
