'use client'

import { useState } from 'react'
import { ConePageHeader } from '@/components/admin/ConeComponents'
import OperadoresTab from './tabs/OperadoresTab'
import DispositivosTab from './tabs/DispositivosTab'

const TABS = [
  { id: 'operadores',  label: 'Operadores' },
  { id: 'dispositivos', label: 'Dispositivos' },
]

export default function OperacionPage() {
  const [tab, setTab] = useState('operadores')

  return (
    <div>
      <ConePageHeader
        title="Operación"
        description="Operadores, dispositivos y acceso al sistema"
      />

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

      {tab === 'operadores'   && <OperadoresTab />}
      {tab === 'dispositivos' && <DispositivosTab />}
    </div>
  )
}
