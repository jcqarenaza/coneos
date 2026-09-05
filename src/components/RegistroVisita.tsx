'use client'

import { useEffect } from 'react'

// Registro de visita de cliente final — soltar en delivery y mesa:
//   <RegistroVisita empresaId={...} sucursalId={...} canal="DELIVERY" />
// Un ping por carga; id anónimo persistente por navegador; dedupe de 10 min
// por sesión para no inflar hits con re-renders. No renderiza nada.
export default function RegistroVisita({ empresaId, sucursalId, canal }: {
  empresaId: string; sucursalId?: string | null; canal: 'DELIVERY' | 'MESA'
}) {
  useEffect(() => {
    if (!empresaId) return
    try {
      const clave = `coneos_visita_${canal}_${empresaId}`
      const ultima = Number(sessionStorage.getItem(clave) ?? 0)
      if (Date.now() - ultima < 600000) return
      sessionStorage.setItem(clave, String(Date.now()))
    } catch {}
    let vid = ''
    try {
      vid = localStorage.getItem('coneos_visitante_id') ?? ''
      if (!vid) {
        vid = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36)
        localStorage.setItem('coneos_visitante_id', vid)
      }
    } catch { vid = 'v_mem_' + Math.random().toString(36).substring(2) }
    fetch('/api/visitas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitante_id: vid, empresa_id: empresaId, sucursal_id: sucursalId ?? null, canal }),
    }).catch(() => {})
  }, [empresaId, sucursalId, canal])
  return null
}
