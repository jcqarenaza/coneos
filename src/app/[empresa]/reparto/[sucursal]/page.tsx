'use client'
// ═══════════════════════════════════════════════════════════════
// 🛵 REPARTO V1 — PUERTA DEL CADETE (brief CTO 28/09)
// /[empresa]/reparto/[sucursal] — independiente de Caja y App Pública.
// Login nombre+PIN (colaborador rol cadete) → token en localStorage
// (el server valida SIEMPRE) → mis entregas → navegar → ENTREGADO.
// Tracking: watchPosition mientras haya reparto activo; el server
// rechaza sin reparto y borra la posición al entregar el último.
// Limitación V1 documentada: la PWA debe estar en pantalla (Wake
// Lock pedido); background con app cerrada = V2/nativa.
// ═══════════════════════════════════════════════════════════════
import { avisar } from '@/components/admin/ConeDialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { marcaDeRuta } from '@/lib/brand'

interface DatosDelivery { nombre: string; telefono: string; direccion: string; entre_calles?: string }
interface PedidoCadete { id: string; numero_pedido: number; estado: string; total: number; metodo_pago: string | null; pagado?: boolean | null; notas: string | null; datos_delivery: DatosDelivery | null; hora_retiro: string | null; created_at: string }

function slugsDesdeURL() {
  // Next 16: params de client pages son Promise → pathname (regla del proyecto)
  const partes = window.location.pathname.split('/').filter(Boolean)
  return { empresa: partes[0] ?? '', sucursal: partes[2] ?? '' }
}
const fmt = (n: number) => `$${Number(n).toLocaleString('es-AR')}`

export default function RepartoPage() {
  const [fase, setFase] = useState<'cargando' | 'apagado' | 'login' | 'panel'>('cargando')
  const [motivo, setMotivo] = useState('')  // diagnóstico visible del rechazo
  const [empresaId, setEmpresaId] = useState('')
  const [sucursalId, setSucursalId] = useState('')
  const [marca, setMarca] = useState<{ nombre: string; color: string; logo: string | null; sucursal: string }>({ nombre: '', color: '#1E3A5F', logo: null, sucursal: '' })
  const [cadetes, setCadetes] = useState<{ id: string; nombre: string; emoji?: string }[]>([])
  const [cadeteSel, setCadeteSel] = useState<{ id: string; nombre: string; emoji?: string } | null>(null)
  const [pin, setPin] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [cadete, setCadete] = useState<{ id: string; nombre: string; emoji?: string } | null>(null)
  const [pedidos, setPedidos] = useState<PedidoCadete[]>([])
  const [entregando, setEntregando] = useState<string | null>(null)
  const [dirCopiada, setDirCopiada] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)  // confirmación amigable, sin confirm() del browser
  const [modoRegreso, setModoRegreso] = useState(false)  // D4 re-sellada: visible en caja hasta "Llegué" (o 30 min)
  const [gps, setGps] = useState<'ok' | 'off' | 'pedir'>('pedir')
  const tokenRef = useRef<string | null>(null)
  const ultimaPosRef = useRef(0)

  const api = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/reparto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token: tokenRef.current }),
    })
    const crudo = await res.text().catch(() => '')
    let d: Record<string, unknown> | null = null
    try { d = JSON.parse(crudo) } catch { d = null }
    if (res.status === 401) { tokenRef.current = null; localStorage.removeItem(`reparto_token_${empresaId}`); setFase('login') }
    // Diagnóstico (02/10): el error sin cuerpo JSON muestra status + crudo
    if (!res.ok) throw new Error((d as { error?: string })?.error ?? `Error ${res.status}${crudo ? ' · ' + crudo.slice(0, 120) : ' (respuesta vacía)'}`)
    return d
  }, [empresaId])

  // ── Arranque: UNA llamada a la API resuelve TODO (cero Supabase anon
  // desde el browser — lección R2: en la PC "andaba" por la sesión de admin) ──
  useEffect(() => {
    const { empresa, sucursal } = slugsDesdeURL()
    if (!empresa || !sucursal) { setMotivo('R1: URL sin empresa/sucursal'); setFase('apagado'); return }
    ;(async () => {
      try {
        const rc = await fetch('/api/reparto', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'contexto', empresa_slug: empresa, sucursal }),
        })
        const dc = await rc.json().catch(() => null)
        if (!dc?.habilitado) { setMotivo(`R3: ${dc?.motivo ?? dc?.error ?? `contexto ${rc.status}`}`); setFase('apagado'); return }
        setSucursalId(dc.sucursal_id)
        setEmpresaId(dc.empresa_id)
        setMarca({ nombre: dc.empresa_nombre, color: dc.color || '#1E3A5F', logo: dc.logo ?? null, sucursal: dc.sucursal_nombre ?? '' })
        setCadetes(dc.cadetes ?? [])
        const guardado = localStorage.getItem(`reparto_token_${dc.empresa_id}`)
        if (guardado) { tokenRef.current = guardado; setFase('panel') } else setFase('login')
      } catch { setMotivo('R4: sin conexión con la API'); setFase('apagado') }
    })()
  }, [])

  // ── Panel: polling de mis pedidos (10s) ──
  useEffect(() => {
    if (fase !== 'panel' || !empresaId) return
    let vivo = true
    const traer = async () => {
      try {
        const d = await api({ accion: 'mis_pedidos' })
        if (!vivo) return
        setCadete(d.cadete)
        setPedidos(d.pedidos ?? [])
      } catch { /* 401 ya redirige; resto: siguiente polling */ }
    }
    traer()
    const i = setInterval(traer, 10000)
    // DESPERTADOR (JC 29/09): iOS congela el JS en segundo plano — al volver
    // al frente la pantalla quedaba vieja hasta el próximo timer o un toque.
    // visibilitychange + pageshow + focus refrescan AL INSTANTE al volver.
    const despertar = () => { if (document.visibilityState === 'visible') traer() }
    document.addEventListener('visibilitychange', despertar)
    window.addEventListener('pageshow', despertar)
    window.addEventListener('focus', despertar)
    return () => {
      vivo = false; clearInterval(i)
      document.removeEventListener('visibilitychange', despertar)
      window.removeEventListener('pageshow', despertar)
      window.removeEventListener('focus', despertar)
    }
  }, [fase, empresaId, api])

  // ── Tracking: watchPosition con reparto activo O en modo regreso
  // (D4 re-sellada JC 29/09: la caja ve al cadete volver al local) ──
  useEffect(() => {
    if (fase !== 'panel' || (pedidos.length === 0 && !modoRegreso)) return
    if (!navigator.geolocation) { setGps('off'); return }
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setGps('ok')
        const ahora = Date.now()
        if (ahora - ultimaPosRef.current < 9000) return  // throttle cliente (el server re-throttlea)
        ultimaPosRef.current = ahora
        api({ accion: 'posicion', lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {})
      },
      () => setGps('off'),
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    // Wake Lock: que la pantalla no se apague mientras reparte
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let wakeLock: any = null
    ;(navigator as any).wakeLock?.request?.('screen').then((wl: any) => { wakeLock = wl }).catch(() => {})
    return () => { navigator.geolocation.clearWatch(watchId); wakeLock?.release?.().catch(() => {}) }
  }, [fase, pedidos.length, modoRegreso, api])

  async function ingresar() {
    if (!cadeteSel || pin.length !== 4) { setErrorMsg('Elegí tu nombre y poné el PIN de 4 dígitos'); return }
    setEnviando(true); setErrorMsg(null)
    try {
      const res = await fetch('/api/reparto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'login', empresa_id: empresaId, sucursal_id: sucursalId, colaborador_id: cadeteSel.id, pin }),
      })
      const d = await res.json()
      if (!res.ok) { setErrorMsg(d?.error ?? 'No se pudo ingresar'); return }
      tokenRef.current = d.token
      localStorage.setItem(`reparto_token_${empresaId}`, d.token)
      setCadete(d.cadete); setPin(''); setFase('panel')
    } catch { setErrorMsg('Sin conexión — probá de nuevo') } finally { setEnviando(false) }
  }

  async function entregar(p: PedidoCadete) {
    setEntregando(p.id)
    try {
      const d = await api({ accion: 'entregar', pedido_id: p.id })
      setPedidos(prev => prev.filter(x => x.id !== p.id))
      if (d?.modo_regreso) setModoRegreso(true)
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo marcar') } finally { setEntregando(null); setConfirmando(null) }
  }

  function salir() {
    tokenRef.current = null
    localStorage.removeItem(`reparto_token_${empresaId}`)
    setCadete(null); setPedidos([]); setFase('login')
  }

  if (fase === 'cargando') return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#faf8f5' }}>
      <Loader2 className="h-8 w-8 animate-spin text-neutral-300" />
    </div>
  )
  if (fase === 'apagado') return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-3" style={{ backgroundColor: '#faf8f5' }}>
      <p className="text-5xl">🛵</p>
      <p className="font-bold text-neutral-700">Reparto no disponible</p>
      <p className="text-neutral-400 text-sm text-center">Este link no está habilitado. Consultá con el local.</p>
      {motivo && <p className="text-[10px] text-neutral-300 text-center">{motivo}</p>}
      <p className="text-[10px] text-neutral-300">v1.2 · {typeof window !== 'undefined' ? window.location.pathname : ''}</p>
    </div>
  )

  if (fase === 'login') return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: '#faf8f5' }}>
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <p className="text-5xl mb-2">🛵</p>
          <h1 className="text-2xl font-black text-neutral-800">REPARTO</h1>
          <p className="text-neutral-400 text-sm mt-1">{marca.nombre}{marca.sucursal ? ` · ${marca.sucursal}` : ''}</p>
        </div>
        {!cadeteSel ? (
          <>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wide mb-2 text-center">¿Quién sos?</label>
            <div className="space-y-2">
              {cadetes.map(c => (
                <button key={c.id} onClick={() => { setCadeteSel(c); setPin(''); setErrorMsg(null) }}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-neutral-200 bg-white text-left hover:border-neutral-400 transition-colors">
                  <span className="text-2xl">{c.emoji ?? '🛵'}</span>
                  <span className="font-bold text-lg text-neutral-800">{c.nombre}</span>
                </button>
              ))}
              {cadetes.length === 0 && <p className="text-center text-neutral-400 text-sm py-6">No hay cadetes cargados para esta sucursal.<br />Se cargan en Admin → Equipo → Colaboradores.</p>}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => { setCadeteSel(null); setPin('') }} className="text-xs text-neutral-400 font-semibold mb-3">← Cambiar</button>
            <p className="text-center font-bold text-xl text-neutral-800 mb-4">🛵 {cadeteSel.nombre}</p>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wide mb-1 text-center">Tu PIN</label>
            <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="• • • •"
              type="password" inputMode="numeric" autoComplete="off" autoFocus
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-2xl font-black tracking-[0.5em] text-center mb-4" />
            {errorMsg && <p className="text-sm font-semibold text-red-500 text-center mb-3">{errorMsg}</p>}
            <button onClick={ingresar} disabled={enviando || pin.length !== 4}
              className="w-full py-4 rounded-xl text-white font-black text-lg shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: marca.color }}>
              {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : 'INGRESAR'}
            </button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#faf8f5' }}>
      <div className="bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <p className="font-black text-neutral-800">🛵 Mis entregas</p>
          <p className="text-xs text-neutral-400">Hola {cadete?.emoji ?? '🛵'} {cadete?.nombre ?? ''} · {marca.sucursal || marca.nombre}</p>
        </div>
        <div className="flex items-center gap-2">
          {pedidos.length > 0 && (
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${gps === 'ok' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {gps === 'ok' ? '📡 Compartiendo ubicación' : '⚠️ Activá el GPS'}
            </span>
          )}
          <button onClick={salir} className="text-xs font-semibold text-neutral-400 border border-neutral-200 rounded-lg px-2.5 py-1.5">Salir</button>
        </div>
      </div>

      <div className="px-4 py-4 max-w-sm mx-auto space-y-3">
        {pedidos.length === 0 && modoRegreso && (
          <div className="mt-6 p-5 rounded-2xl bg-white border border-neutral-100 shadow-sm text-center">
            <span className="text-4xl">🏠</span>
            <p className="font-bold text-neutral-700 mt-2">Volviendo al local</p>
            <p className="text-neutral-400 text-sm mt-1 mb-4">Todo entregado. La caja te sigue viendo en el mapa hasta que llegues — por tu seguridad.</p>
            <button onClick={async () => { try { await api({ accion: 'llegue' }) } catch {} setModoRegreso(false) }}
              className="w-full py-4 rounded-xl text-white font-black text-lg shadow-sm"
              style={{ backgroundColor: marca.color }}>
              🏠 LLEGUÉ AL LOCAL
            </button>
          </div>
        )}
        {pedidos.length === 0 && !modoRegreso && (
          <div className="text-center py-16">
            <p className="text-4xl mb-2">😴</p>
            <p className="font-bold text-neutral-600">Sin entregas asignadas</p>
            <p className="text-neutral-400 text-sm mt-1">Cuando la caja te asigne un pedido, aparece acá solo.</p>
          </div>
        )}
        {pedidos.map(p => {
          const listo = p.estado === 'READY'
          const dd = p.datos_delivery
          const cobra = p.metodo_pago === 'efectivo' && p.pagado !== true
          return (
            <div key={p.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${listo ? 'border-green-200' : 'border-neutral-100'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-black text-xl text-neutral-800">#{p.numero_pedido}</span>
                {listo
                  ? <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-50 text-green-700">✅ LISTO PARA SALIR</span>
                  : <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700">👨‍🍳 PREPARANDO</span>}
              </div>
              {dd && (
                <div className="space-y-1 mb-3">
                  <p className="text-sm font-semibold text-neutral-800">{dd.nombre}</p>
                  <p className="text-sm text-neutral-600">📍 {dd.direccion}{dd.entre_calles ? ` (entre ${dd.entre_calles})` : ''}</p>
                  <a href={`tel:${dd.telefono}`} className="text-sm text-neutral-500 underline block">📞 {dd.telefono}</a>
                </div>
              )}
              {p.notas && <p className="text-xs text-neutral-500 bg-neutral-50 rounded-lg px-3 py-2 mb-3">📝 {p.notas}</p>}
              <p className={`text-sm font-bold mb-3 ${cobra ? 'text-red-600' : 'text-neutral-500'}`}>
                {cobra ? `💵 COBRAR ${fmt(p.total)} EN EFECTIVO` : `✔️ Pagado · ${fmt(p.total)}`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {/* Sin link de navegación (decisión JC 28/09: el intent de
                    Android fuerza la app de Maps) — copiar y pegar donde quiera */}
                <button onClick={async () => {
                    try { await navigator.clipboard.writeText(`${dd?.direccion ?? ''}${dd?.entre_calles ? ` entre ${dd.entre_calles}` : ''}`) } catch { return }
                    setDirCopiada(p.id); setTimeout(() => setDirCopiada(null), 1800)
                  }}
                  className="py-3 rounded-xl border-2 border-neutral-200 text-neutral-700 font-bold text-sm text-center">
                  {dirCopiada === p.id ? '✓ COPIADA' : '📋 COPIAR DIRECCIÓN'}
                </button>
                <button onClick={() => setConfirmando(p.id)} disabled={!listo || entregando === p.id}
                  title={listo ? '' : 'Se habilita cuando el local lo marque LISTO'}
                  className="py-3 rounded-xl text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-1"
                  style={{ backgroundColor: listo ? '#16a34a' : '#9ca3af' }}>
                  ✅ ENTREGADO
                </button>
              </div>
              {confirmando === p.id && (
                <div className="mt-2 p-3 rounded-xl bg-green-50 border border-green-200">
                  <p className="text-sm font-bold text-green-800 text-center mb-2">¿Le entregaste el pedido a {dd?.nombre?.split(' ')[0] ?? 'el cliente'}?</p>
                  {cobra && <p className="text-xs font-bold text-red-600 text-center mb-2">Acordate: cobraste {fmt(p.total)} en efectivo 💵</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setConfirmando(null)} disabled={entregando === p.id}
                      className="py-3 rounded-xl border-2 border-neutral-200 bg-white text-neutral-600 font-bold text-sm">
                      ← Todavía no
                    </button>
                    <button onClick={() => entregar(p)} disabled={entregando === p.id}
                      className="py-3 rounded-xl bg-green-600 text-white font-black text-sm flex items-center justify-center gap-1">
                      {entregando === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '✔️ SÍ, ENTREGADO'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <p className="text-center text-[10px] text-neutral-300 pt-2">Mantené la pantalla prendida mientras repartís para compartir tu ubicación · {marcaDeRuta()}</p>
      </div>
    </div>
  )
}
