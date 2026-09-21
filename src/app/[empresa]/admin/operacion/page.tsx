'use client'

import { useState } from 'react'
import { ConePageHeader } from '@/components/admin/ConeComponents'
import OperadoresTab from './tabs/OperadoresTab'
import ColaboradoresTab from './tabs/ColaboradoresTab'

// CICLO CASA OPERATIVA: la tab Dispositivos se mudó a Servicios y horarios
// (crear dispositivo → horarios → mensajes → QR). Operación = PERSONAS.
const TABS = [
  { id: 'operadores',    label: 'Operadores' },
  { id: 'colaboradores', label: 'Colaboradores' },
]

export default function OperacionPage() {
  const [tab, setTab] = useState('operadores')
  return (
    <div>
      <ConePageHeader title="Operación" description="Las personas del equipo: operadores y colaboradores" />
      <div className="mb-4 p-3 bg-neutral-50 rounded-xl border border-neutral-100">
        <p className="text-xs text-neutral-500">🔧 Los <b>dispositivos</b> (kiosk, caja, delivery y su vinculación por QR) ahora viven en <b>Servicios y horarios</b> → tab Dispositivos.</p>
      </div>
      <div className="flex gap-1 border-b border-neutral-200 mb-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t.id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'operadores'    && <OperadoresTab />}
      {tab === 'colaboradores' && <ColaboradoresTab />}
    </div>
  )
}
