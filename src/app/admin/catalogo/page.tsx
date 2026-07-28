'use client'

import { useState } from 'react'
import { ConePageHeader } from '@/components/admin/ConeComponents'
import CategoriasTab from './tabs/CategoriasTab'
import ProductosTab from './tabs/ProductosTab'
import PresentacionesTab from './tabs/PresentacionesTab'
import SaboresTab from './tabs/SaboresTab'
import DisponibilidadTab from './tabs/DisponibilidadTab'

const TABS = [
  { id: 'categorias',    label: 'Categorías' },
  { id: 'productos',     label: 'Productos' },
  { id: 'presentaciones',label: 'Presentaciones' },
  { id: 'sabores',       label: 'Sabores' },
  { id: 'disponibilidad',label: 'Disponibilidad' },
]

export default function CatalogoPage() {
  const [tab, setTab] = useState('categorias')

  return (
    <div>
      <ConePageHeader
        title="Catálogo"
        description="Categorías, productos, presentaciones y sabores"
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-200 mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {tab === 'categorias'     && <CategoriasTab />}
      {tab === 'productos'      && <ProductosTab />}
      {tab === 'presentaciones' && <PresentacionesTab />}
      {tab === 'sabores'        && <SaboresTab />}
      {tab === 'disponibilidad' && <DisponibilidadTab />}
    </div>
  )
}
