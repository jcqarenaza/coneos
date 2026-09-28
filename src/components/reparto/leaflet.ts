// Carga Leaflet 1.9.4 desde CDN (unpkg) una sola vez — sin npm, sin API key.
// Tiles: OpenStreetMap con su atribución obligatoria (© OpenStreetMap).
/* eslint-disable @typescript-eslint/no-explicit-any */
let promesa: Promise<any> | null = null
export function cargarLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('solo browser'))
  const w = window as any
  if (w.L) return Promise.resolve(w.L)
  if (promesa) return promesa
  promesa = new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    js.onload = () => resolve(w.L)
    js.onerror = () => { promesa = null; reject(new Error('No se pudo cargar el mapa')) }
    document.head.appendChild(js)
  })
  return promesa
}
export function iconoEmoji(L: any, emoji: string, size = 34) {
  return L.divIcon({
    html: `<div style="font-size:${size}px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))">${emoji}</div>`,
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  })
}
export const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
