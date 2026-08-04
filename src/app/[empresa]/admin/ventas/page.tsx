'use client'

import { ConePageHeader } from '@/components/admin/ConeComponents'
import { BarChart3 } from 'lucide-react'

export default function VentasPage() {
  return (
    <div>
      <ConePageHeader title="Ventas" description="Reportes y estadísticas de ventas" />
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-neutral-100">
        <div className="w-14 h-14 bg-neutral-100 rounded-2xl flex items-center justify-center mb-4">
          <BarChart3 className="h-7 w-7 text-neutral-400" />
        </div>
        <p className="text-neutral-700 font-bold text-lg mb-1">Reportes próximamente</p>
        <p className="text-neutral-400 text-sm">El módulo de ventas estará disponible en la próxima versión.</p>
      </div>
    </div>
  )
}
