'use client'

// ═══════════════════════════════════════════════════════════════════
// TAB EQUIPO — Operadores + Colaboradores UNIFICADOS (decisión JC)
// Mudados de la ex-página Operación a la Casa "Configuración del negocio".
// Los componentes son los de siempre (misma lógica, mismas fuentes:
// operadores con PIN y permisos · colaboradores cadetes/otros) — acá
// solo se apilan bajo un mismo tab con sus títulos de sección.
// ═══════════════════════════════════════════════════════════════════

import OperadoresTab from '@/components/admin/OperadoresTab'
import ColaboradoresTab from '@/components/admin/ColaboradoresTab'

export default function EquipoTab() {
  return (
    <div className="space-y-8">
      <div>
        <div className="mb-1">
          <h3 className="font-bold text-neutral-800">🧑‍💼 Operadores</h3>
          <p className="text-xs text-neutral-400">Atienden caja y preparación — entran con su PIN en los dispositivos.</p>
        </div>
        <OperadoresTab />
      </div>
      <div className="pt-6 border-t border-neutral-100">
        <div className="mb-1">
          <h3 className="font-bold text-neutral-800">🛵 Colaboradores</h3>
          <p className="text-xs text-neutral-400">Cadetes y otros roles — sin acceso al sistema, para asignar en pedidos.</p>
        </div>
        <ColaboradoresTab />
      </div>
    </div>
  )
}
