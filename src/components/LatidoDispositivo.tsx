'use client'

import { useEffect } from 'react'

// Latido de instancia — soltar en cualquier pantalla operativa:
//   <LatidoDispositivo empresaId={...} sucursalId={...} dispositivoId={...} tipo="KIOSK" />
// Cada navegador físico se inventa un id una sola vez (localStorage) y reporta
// cada 2 minutos. Así el panel QP ve cuántas pantallas reales usa cada cliente,
// aunque compartan el mismo alta de dispositivo. No renderiza nada.
export default function LatidoDispositivo({ empresaId, sucursalId, dispositivoId, tipo }: {
  empresaId: string; sucursalId?: string | null; dispositivoId?: string | null; tipo: string
}) {
  useEffect(() => {
    if (!empresaId) return
    let instancia = ''
    try {
      instancia = localStorage.getItem('coneos_instancia_id') ?? ''
      if (!instancia) {
        instancia = 'ins_' + Math.random().toString(36).substring(2) + Date.now().toString(36)
        localStorage.setItem('coneos_instancia_id', instancia)
      }
    } catch { instancia = 'ins_mem_' + Math.random().toString(36).substring(2) }

    function latir() {
      fetch('/api/dispositivos/latido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instancia_id: instancia, empresa_id: empresaId, sucursal_id: sucursalId ?? null, dispositivo_id: dispositivoId ?? null, tipo }),
      }).catch(() => {})
    }
    latir()
    const int = setInterval(latir, 120000)
    return () => clearInterval(int)
  }, [empresaId, sucursalId, dispositivoId, tipo])

  return null
}
