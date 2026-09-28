'use client'
// ═══ REPARTO V1 — mapa del CLIENTE (D1-D5) ═══
// Aparece SOLO con delivery + READY + cadete + módulo reparto ON.
// 🛵 posición del cadete: el server la distribuye (cliente_posicion).
// 📍 posición del cliente: SU GPS, obtenida acá y usada acá — JAMÁS
// viaja al servidor ni se guarda (D2/D3). Permiso denegado → moto
// sola, sin error técnico (D4).
import { useEffect, useRef, useState } from 'react'
import { cargarLeaflet, iconoEmoji, OSM_TILES, OSM_ATTR } from '@/components/reparto/leaflet'

interface Props { empresaId: string; numeroPedido: number; nombreCadete: string | null; color: string }

export default function MapaCliente({ empresaId, numeroPedido, nombreCadete, color }: Props) {
  const divRef = useRef<HTMLDivElement>(null)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mapRef = useRef<any>(null)
  const motoRef = useRef<any>(null)
  const yoRef = useRef<any>(null)
  const [sinPosicion, setSinPosicion] = useState(false)

  useEffect(() => {
    let vivo = true
    let intervalo: ReturnType<typeof setInterval> | null = null
    let watchId: number | null = null

    cargarLeaflet().then(L => {
      if (!vivo || !divRef.current || mapRef.current) return
      const map = L.map(divRef.current, { zoomControl: false, attributionControl: true }).setView([-35.66, -63.75], 14)
      L.tileLayer(OSM_TILES, { attribution: OSM_ATTR, maxZoom: 19 }).addTo(map)
      mapRef.current = map

      const encuadrar = () => {
        const puntos = [motoRef.current?.getLatLng(), yoRef.current?.getLatLng()].filter(Boolean)
        if (puntos.length === 2) map.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 17 })
        else if (puntos.length === 1) map.setView(puntos[0], 16)
      }

      // 🛵 la moto: polling al server cada 10s
      const traerMoto = async () => {
        try {
          const res = await fetch('/api/reparto', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accion: 'cliente_posicion', empresa_id: empresaId, numero_pedido: numeroPedido }),
          })
          const d = await res.json()
          if (!vivo) return
          if (d?.activo && d.lat && d.lng) {
            setSinPosicion(false)
            if (!motoRef.current) { motoRef.current = L.marker([d.lat, d.lng], { icon: iconoEmoji(L, '🛵', 38) }).addTo(map); encuadrar() }
            else motoRef.current.setLatLng([d.lat, d.lng])
          } else setSinPosicion(true)
        } catch { /* siguiente polling */ }
      }
      traerMoto()
      intervalo = setInterval(traerMoto, 10000)

      // 📍 el cliente: GPS LOCAL — jamás al server
      if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
          pos => {
            if (!vivo) return
            const ll: [number, number] = [pos.coords.latitude, pos.coords.longitude]
            if (!yoRef.current) { yoRef.current = L.marker(ll, { icon: iconoEmoji(L, '📍', 32) }).addTo(map); encuadrar() }
            else yoRef.current.setLatLng(ll)
          },
          () => { /* permiso denegado: moto sola, sin error (D4) */ },
          { enableHighAccuracy: true, maximumAge: 15000 }
        )
      }
    }).catch(() => setSinPosicion(true))

    return () => {
      vivo = false
      if (intervalo) clearInterval(intervalo)
      if (watchId !== null) navigator.geolocation?.clearWatch(watchId)
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; motoRef.current = null; yoRef.current = null }
    }
  }, [empresaId, numeroPedido])

  return (
    <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-neutral-50 flex items-center justify-between">
        <p className="font-bold text-neutral-700 text-sm">🛵 {nombreCadete ? `${nombreCadete} va en camino` : 'En camino'}</p>
        <span className="text-[10px] text-neutral-300">en vivo</span>
      </div>
      <div ref={divRef} style={{ height: 260, width: '100%' }} />
      {sinPosicion && <p className="text-xs text-neutral-400 text-center py-2" style={{ color }}>El repartidor está en camino — la posición aparece apenas comparta ubicación.</p>}
    </div>
  )
}
