'use client'

// ══ RETORNO MP — UNA SOLA CASA (JC 25/09) ══
// Antes: tres caminos sueltos en cada vidriera (URL, localStorage, despertar)
// con dos agujeros: (1) el despertar consultaba UNA vez — si el webhook
// todavía no había llegado, nunca más preguntaba; (2) la restauración del
// carrito podía pisar el comprobante cuando la confirmación llegaba antes
// que el contexto. Acá vive TODO el retorno: una función que pregunta
// (memoria local → server por visitante_id) con reintentos, al montar y
// cada vez que la pestaña despierta. Al confirmar: borra pendiente y
// carritos del canal ANTES de avisar, y recuerda el pedido como "visto"
// para no volver a mostrar un comprobante viejo en una compra nueva.

import { useEffect, useRef, useState } from 'react'

type Tipo = 'takeaway' | 'delivery' | 'mesa'
type Confirmado = { numero: number; codigo: string }

const PAGADOS = ['PAID', 'PREPARING', 'READY', 'DELIVERED']
const CLAVE_PEND = 'coneos_mp_pedido'
const CLAVE_VISTOS = 'coneos_mp_vistos'
const VENTANA_MS = 3600000
const INTENTOS = 15
const CADA_MS = 2000

function leerVistos(): string[] {
  try { const v = JSON.parse(localStorage.getItem(CLAVE_VISTOS) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function marcarVisto(id: string) {
  try { const v = leerVistos().filter(x => x !== id); v.push(id); localStorage.setItem(CLAVE_VISTOS, JSON.stringify(v.slice(-20))) } catch {}
}
function limpiarPend() {
  try { localStorage.removeItem(CLAVE_PEND); sessionStorage.removeItem(CLAVE_PEND) } catch {}
}
function leerPend(tipo: Tipo): string | null {
  let pend: { id?: string; ts?: number; tipo?: string } | null = null
  try { pend = JSON.parse(localStorage.getItem(CLAVE_PEND) ?? sessionStorage.getItem(CLAVE_PEND) ?? 'null') } catch {}
  if (!pend?.id) return null
  if (Date.now() - (pend.ts ?? 0) > VENTANA_MS) { limpiarPend(); return null }
  if (pend.tipo && pend.tipo !== tipo) return null // pendiente de otra vidriera
  return pend.id
}

export function useRetornoMp(tipo: Tipo, onConfirmado: (c: Confirmado) => void) {
  const [verificando, setVerificando] = useState(false)
  const cbRef = useRef(onConfirmado)
  cbRef.current = onConfirmado
  const corriendo = useRef(false)

  useEffect(() => {
    let cancelado = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Vacía los ITEMS de los carritos del canal (conserva el resto: la mesa guarda nombre y número)
    const limpiarCarritos = () => {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i)
          if (!k || !k.startsWith(`coneos_carrito_${tipo}_`)) continue
          try {
            const d = JSON.parse(localStorage.getItem(k) ?? 'null')
            if (d && typeof d === 'object') localStorage.setItem(k, JSON.stringify({ ...d, items: [], ts: Date.now() }))
            else localStorage.removeItem(k)
          } catch { localStorage.removeItem(k) }
        }
      } catch {}
    }

    const confirmar = (id: string, numero: number, codigo: string) => {
      if (leerVistos().includes(id)) return
      marcarVisto(id)
      limpiarPend()
      limpiarCarritos() // antes de avisar: la restauración del carrito ya no encuentra nada
      setVerificando(false)
      cbRef.current({ numero, codigo })
    }

    // Una pregunta: 'ok' confirmado · 'esperar' hay MP reciente sin webhook todavía · 'nada'
    const preguntar = async (): Promise<'ok' | 'esperar' | 'nada'> => {
      const pendId = leerPend(tipo)
      if (pendId && !leerVistos().includes(pendId)) {
        try {
          const r = await fetch(`/api/pedidos/estado?pedido_id=${pendId}`, { cache: 'no-store' })
          if (r.ok) {
            const d = await r.json()
            if (PAGADOS.includes(d.estado)) { confirmar(pendId, d.numero_pedido, d.codigo_retiro); return 'ok' }
          }
        } catch {}
      }
      // EL SERVER RECUERDA — visitante_id ancló el pedido (Tráfico B)
      let vid = ''
      try { vid = localStorage.getItem('coneos_visitante_id') ?? '' } catch {}
      if (vid) {
        const p = window.location.pathname.split('/').filter(Boolean)
        try {
          const r = await fetch(`/api/pedidos/pendiente-mp?empresa=${p[0]}&sucursal=${p[2]}&visitante=${encodeURIComponent(vid)}&tipo=${tipo}`, { cache: 'no-store' })
          if (r.ok) {
            const d = await r.json()
            const ped = d?.pedido
            if (ped?.id && !leerVistos().includes(ped.id)) {
              if (PAGADOS.includes(ped.estado)) { confirmar(ped.id, ped.numero_pedido, ped.codigo_retiro); return 'ok' }
              return 'esperar'
            }
          }
        } catch {}
      }
      return pendId ? 'esperar' : 'nada'
    }

    const ciclo = (conPantalla: boolean) => {
      if (corriendo.current || cancelado) return
      corriendo.current = true
      if (conPantalla) setVerificando(true)
      let intentos = 0
      const paso = async () => {
        if (cancelado) { corriendo.current = false; return }
        const r = await preguntar()
        intentos++
        if (r === 'ok' || r === 'nada' || intentos >= INTENTOS) {
          corriendo.current = false
          setVerificando(false)
          if (r === 'esperar') limpiarPend() // sin confirmación en 30s: vuelve el carrito (Caso B)
          return
        }
        timer = setTimeout(paso, CADA_MS)
      }
      paso()
    }

    // Al montar: la URL de vuelta de MP manda; si no, memoria local; si no, el server (en silencio)
    try {
      const url = new URL(window.location.href)
      const extRef = url.searchParams.get('external_reference')
      if (extRef) {
        try { localStorage.setItem(CLAVE_PEND, JSON.stringify({ id: extRef, ts: Date.now(), tipo })) } catch {}
        for (const k of ['collection_id', 'collection_status', 'payment_id', 'status', 'external_reference', 'payment_type', 'merchant_order_id', 'preference_id', 'site_id', 'processing_mode', 'merchant_account_id']) url.searchParams.delete(k)
        window.history.replaceState({}, '', url.toString())
      }
    } catch {}
    ciclo(!!leerPend(tipo))

    // Al despertar (vuelta desde la app de MP, atrás, bfcache)
    const despertar = () => {
      if (document.visibilityState === 'hidden') return
      ciclo(!!leerPend(tipo))
    }
    window.addEventListener('pageshow', despertar)
    document.addEventListener('visibilitychange', despertar)
    return () => {
      cancelado = true
      corriendo.current = false
      if (timer) clearTimeout(timer)
      window.removeEventListener('pageshow', despertar)
      document.removeEventListener('visibilitychange', despertar)
    }
  }, [tipo])

  return { verificando }
}
