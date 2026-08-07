'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import type { EmpresaConfig, DispositivoKiosk } from '@/app/[empresa]/kiosk/[sucursal]/page'

interface Categoria { id: string; nombre: string; icono_url: string | null }
interface Producto { id: string; nombre: string; imagen_url: string | null; categoria_id: string }

interface Props {
  config: EmpresaConfig
  dispositivo: DispositivoKiosk
  onComenzar: (categoriaId?: string) => void
}

const CATEGORIA_EMOJI: Record<string, string> = {
  'helado': '🍦', 'kilo': '🍦', 'balde': '🧊',
  'bombon': '🍫', 'envasa': '🍫', 'torta': '🎂',
  'palito': '🍡', 'copa': '🍨', 'cono': '🍦', 'bocha': '🍦',
}

function getEmoji(nombre: string): string {
  const n = nombre.toLowerCase()
  for (const [key, val] of Object.entries(CATEGORIA_EMOJI)) {
    if (n.includes(key)) return val
  }
  return '🍨'
}

// Collage de fotos de productos de la categoría
function CategoriaFotos({ fotos, emoji }: { fotos: string[]; emoji: string }) {
  if (fotos.length === 0) return <span className="text-6xl">{emoji}</span>

  if (fotos.length === 1) return (
    <div className="w-full h-full rounded-xl overflow-hidden">
      <Image src={fotos[0]} alt="" width={200} height={200} className="object-cover w-full h-full" />
    </div>
  )

  const grid = fotos.slice(0, 4)
  return (
    <div className={`w-full h-full grid gap-0.5 rounded-xl overflow-hidden ${grid.length >= 4 ? 'grid-cols-2 grid-rows-2' : grid.length === 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2'}`}>
      {grid.map((url, i) => (
        <div key={i} className={`overflow-hidden ${grid.length === 3 && i === 0 ? 'row-span-2' : ''}`}>
          <Image src={url} alt="" width={100} height={100} className="object-cover w-full h-full" />
        </div>
      ))}
    </div>
  )
}

export default function KioskInicio({ config, dispositivo, onComenzar }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [hora, setHora] = useState('')

  useEffect(() => {
    fetch(`/api/kiosk/catalogo?empresa_id=${dispositivo.empresa_id}&sucursal_id=${dispositivo.sucursal_id}`)
      .then(r => r.json())
      .then(data => {
        setCategorias(data.categorias ?? [])
        setProductos(data.productos ?? [])
      })
    const tick = () => setHora(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [dispositivo])

  function getFotosCat(catId: string): string[] {
    return productos
      .filter(p => p.categoria_id === catId && p.imagen_url)
      .map(p => p.imagen_url!)
      .slice(0, 4)
  }

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
          {categorias.map(cat => {
            const fotos = getFotosCat(cat.id)
            const tieneIcono = !!cat.icono_url
            const tieneFotos = fotos.length > 0

            return (
              <button
                key={cat.id}
                onClick={() => onComenzar(cat.id)}
                className="group relative flex flex-col rounded-3xl bg-white border border-neutral-100 shadow-sm hover:shadow-lg active:scale-95 transition-all duration-200 overflow-hidden min-h-[200px]">

                {/* Imagen o collage o emoji */}
                <div className="flex-1 w-full p-3">
                  {tieneIcono ? (
                    <div className="w-full h-full rounded-xl overflow-hidden">
                      <Image src={cat.icono_url!} alt={cat.nombre} width={200} height={200} className="object-cover w-full h-full" />
                    </div>
                  ) : tieneFotos ? (
                    <CategoriaFotos fotos={fotos} emoji={getEmoji(cat.nombre)} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-6xl group-hover:scale-110 transition-transform duration-200">{getEmoji(cat.nombre)}</span>
                    </div>
                  )}
                </div>

                {/* Nombre */}
                <div className="px-4 pb-4 pt-1 text-center">
                  <span className="text-base font-bold text-neutral-700">{cat.nombre}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4">
        <p className="text-neutral-300 text-xs tracking-wide">ConeOS · Sistema de pedidos</p>
      </div>
    </div>
  )
}
