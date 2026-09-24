'use client'

import { useEffect } from 'react'

// Registro de visita de cliente final — soltar en las puertas públicas:
//   <RegistroVisita empresaId={...} sucursalId={...} canal="DELIVERY" />
// Un ping por carga; id anónimo persistente por navegador; dedupe de 10 min
// por sesión para no inflar hits con re-renders. No renderiza nada.
//
// ══ TRÁFICO V1 (GO CTO 24/09) ══
// · Unión de canales completa: DELIVERY | MESA | TAKEAWAY | APP.
// · Adquisición: viaja document.referrer (solo si es EXTERNO — la navegación
//   interna no es un origen) + utm_source/medium/campaign de la URL. El
//   server los guarda con regla first-known: jamás pisa un origen ya sabido.
// · Sin IP, sin UA, sin geo, sin fingerprinting (regla 21 del ciclo).
export default function RegistroVisita({ empresaId, sucursalId, canal }: {
  empresaId: string; sucursalId?: string | null; canal: 'DELIVERY' | 'MESA' | 'TAKEAWAY' | 'APP'
}) {
  useEffect(() => {
    if (!empresaId) return
    // Adquisición se detecta ANTES del dedupe: un ping que trae origen no se
    // puede tirar (fix T2: el dedupe se comía la campaña si hubo entrada
    // limpia primero). Perfora una sola vez por sesión.
    let hayOrigen = false
    try {
      const sp0 = new URLSearchParams(window.location.search)
      const refExt = document.referrer && !document.referrer.startsWith(window.location.origin)
      hayOrigen = refExt || !!(sp0.get('utm_source') || sp0.get('utm_medium') || sp0.get('utm_campaign'))
    } catch {}
    try {
      const clave = `coneos_visita_${canal}_${empresaId}`
      const claveOrigen = clave + '_origen'
      const ultima = Number(sessionStorage.getItem(clave) ?? 0)
      const origenYaEnviado = sessionStorage.getItem(claveOrigen) === '1'
      if (Date.now() - ultima < 600000 && (!hayOrigen || origenYaEnviado)) return
      sessionStorage.setItem(clave, String(Date.now()))
      if (hayOrigen) sessionStorage.setItem(claveOrigen, '1')
    } catch {}
    let vid = ''
    try {
      vid = localStorage.getItem('coneos_visitante_id') ?? ''
      if (!vid) {
        vid = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36)
        localStorage.setItem('coneos_visitante_id', vid)
      }
    } catch { vid = 'v_mem_' + Math.random().toString(36).substring(2) }

    // Adquisición (best-effort): referrer externo + UTM de la URL actual
    let referrer: string | null = null
    let utm: Record<string, string> | null = null
    try {
      const ref = document.referrer
      if (ref && !ref.startsWith(window.location.origin)) referrer = ref.slice(0, 300)
      const sp = new URLSearchParams(window.location.search)
      const u: Record<string, string> = {}
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
        const v = sp.get(k)
        if (v) u[k.replace('utm_', '')] = v.slice(0, 80)
      }
      if (Object.keys(u).length) utm = u
    } catch {}

    fetch('/api/visitas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitante_id: vid, empresa_id: empresaId, sucursal_id: sucursalId ?? null, canal, referrer, utm }),
    }).catch(() => {})
  }, [empresaId, sucursalId, canal])
  return null
}
