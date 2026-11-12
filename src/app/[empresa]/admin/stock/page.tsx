'use client'

// ═══════════════════════════════════════════════════════════════
// STOCK · ETAPA 1 + 1.1 (GO CTO 08/11) — Inventario (árbol, habilitar, mínimo) · Ajuste general · Movimientos.
// Etapa 1.1: ÚNICO lugar donde se habilita/quita el control de stock y se edita el mínimo (el Catálogo solo muestra).
// Todo por /api/stock con Bearer del admin (sesión, rol y sucursal se validan en el servidor).
// La regla (base congelada, diferencia = contado − base, stock final = max(0, actual + diferencia),
// segunda confirmación, idempotencia por lote) vive en SQL: acá solo se muestra y se pide.
// NO toca Arqueos (siguen en Ventas) ni la vidriera (AGOTADO sigue visible).
// ═══════════════════════════════════════════════════════════════

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { MOTIVOS_AJUSTE, MOTIVO_LABEL, type EstadoStock } from '@/lib/stock/ajuste'
import { Loader2, Search, ClipboardList, AlertTriangle, CheckCircle2, Package } from 'lucide-react'

type Est = EstadoStock | 'sin_control'
interface PresInv { id: string; nombre: string; factor: number; vendibles: number | null; saldo?: number | null }

interface Suc { id: string; nombre: string }
interface InvItem { producto_id: string; nombre: string; codigo: string | null; categoria_id: string | null; categoria: string | null; controla: boolean; modelo?: string; cantidad: number | null; minimo: number | null; estado: Est; actualizado: string | null; presentaciones: PresInv[] }
interface Cat { id: string; nombre: string }
interface PrevItem { producto_id: string; nombre: string; base: number; contado: number; actual: number; fila_nueva: boolean; diff_pedida: number; diff_aplicada: number; final: number; recortado: boolean; importante: boolean }
interface Prev { lote_id: string; items: PrevItem[]; huella: string; resumen: { items_n: number; total_abs: number; recortes_n: number; importantes_n: number; requiere_confirmacion: boolean; motivos_confirmacion: string[] } }
interface Mov { id: string; fecha: string; tipo: string; delta: number; detalle: string | null; producto: string | null; es_articulo: boolean; responsable: string; lote_id: string | null; motivo_tipo: string | null; descripcion: string | null }
interface ConteoItem { producto_id: string; nombre: string; base: number; sin_alta: boolean }
interface Conteo { lote_id: string; iniciado_at: string; items: ConteoItem[] }   // snapshot guardado por el SERVIDOR al iniciar

const ESTADO: Record<Est, { t: string; c: string }> = {
  sin_control: { t: 'Sin control', c: 'bg-neutral-50 text-neutral-400' },
  sin_alta: { t: 'Sin alta', c: 'bg-neutral-100 text-neutral-600' },
  sin_stock: { t: 'Sin stock', c: 'bg-red-100 text-red-700' },
  bajo: { t: 'Stock bajo', c: 'bg-amber-100 text-amber-800' },
  ok: { t: 'OK', c: 'bg-green-100 text-green-700' },
}
const TIPO_MOV: Record<string, string> = { venta: 'Venta', devolucion: 'Devolución', compra: 'Compra', devolucion_compra: 'Devolución de compra', ajuste: 'Ajuste', arqueo: 'Arqueo' }
const MOTIVOS_CONF: Record<string, string> = {
  recorte_a_cero: 'Hay productos que quedarían en 0 porque se vendió más de lo que el conteo esperaba.',
  diferencia_grande: 'Hay diferencias grandes (20% o más de la base y al menos 5 unidades, o 50 unidades o más).',
  lote_grande: 'El ajuste mueve 100 unidades o más en total.',
}
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const sg = (n: number) => (n > 0 ? `+${n}` : String(n))

export default function StockPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [tab, setTab] = useState<'inventario' | 'sabores' | 'ajuste' | 'movimientos'>('inventario')
  const [sucs, setSucs] = useState<Suc[]>([])
  const [sucId, setSucId] = useState('')
  const [inv, setInv] = useState<InvItem[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [busca, setBusca] = useState('')
  const [catF, setCatF] = useState('')
  const [todos, setTodos] = useState(false)          // Etapa 1.1: mostrar también los productos sin control de stock
  const [puedeHab, setPuedeHab] = useState(false)    // habilitar/quitar control = administrador de toda la empresa
  const [quitar, setQuitar] = useState<{ producto_id: string; texto: string } | null>(null)
  const [accionando, setAccionando] = useState('')
  const [pendientes, setPendientes] = useState<Set<string>>(new Set())   // checkboxes en vuelo (no bloquean a los demás)
  const [loteConfirmar, setLoteConfirmar] = useState(false)
  const [loteTrabajando, setLoteTrabajando] = useState(false)
  const [minEdit, setMinEdit] = useState<Record<string, string>>({})
  const [avisoInv, setAvisoInv] = useState<{ ok: boolean; t: string } | null>(null)
  // E2-b: ajuste directo de la hoja de una presentación (productos con stock por rama)
  const [ajR, setAjR] = useState<Record<string, { valor: string; motivo: string }>>({})
  const [ajRTrab, setAjRTrab] = useState('')
  async function ajustarHoja(p: PresInv) {
    const f = ajR[p.id]; const nuevo = Number(f?.valor)
    if (!f || f.valor.trim() === '' || !Number.isInteger(nuevo) || nuevo < 0) { setAvisoInv({ ok: false, t: 'El nuevo saldo debe ser un entero de 0 en adelante.' }); return }
    if ((f.motivo ?? '').trim().length < 3) { setAvisoInv({ ok: false, t: 'Indicá el motivo del ajuste.' }); return }
    setAjRTrab(p.id); setAvisoInv(null)
    try {
      await api({ accion: 'ajustar_rama', sucursal_id: sucId, presentacion_id: p.id, modo: 'set', cantidad: nuevo, motivo: f.motivo.trim(), operacion_id: crypto.randomUUID() })
      setAjR(a => { const n = { ...a }; delete n[p.id]; return n })
      setAvisoInv({ ok: true, t: `Saldo de ${p.nombre} ajustado a ${nuevo}.` }); await cargarInvRef.current()
    } catch (e) { setAvisoInv({ ok: false, t: (e as Error).message }) } finally { setAjRTrab('') }
  }
  const cargarInvRef = { current: async () => {} } as { current: () => Promise<void> }

  // Alta de "stock por presentación": el administrador carga cuántas unidades hay de cada presentación, en cada sucursal
  type RamaInfo = { producto: { id: string; nombre: string }; sucursales: { id: string; nombre: string; saldo: number }[]; presentaciones: { id: string; nombre: string }[]; bloqueos: string[] }
  const [ramaP, setRamaP] = useState<{ id: string; nombre: string } | null>(null)
  const [ramaInfo, setRamaInfo] = useState<RamaInfo | null>(null)
  const [ramaCant, setRamaCant] = useState<Record<string, string>>({})
  const [ramaMotivo, setRamaMotivo] = useState('Alta de stock por presentación')
  const [ramaOp, setRamaOp] = useState('')
  const [ramaTrab, setRamaTrab] = useState(false)
  const [ramaErr, setRamaErr] = useState('')
  async function abrirRama(i: InvItem) {
    setRamaP({ id: i.producto_id, nombre: i.nombre }); setRamaInfo(null); setRamaErr(''); setRamaCant({}); setRamaMotivo('Alta de stock por presentación'); setRamaOp(crypto.randomUUID())
    try {
      const j = await api({ accion: 'rama_info', sucursal_id: sucId, producto_id: i.producto_id }) as RamaInfo
      const c: Record<string, string> = {}
      for (const s of j.sucursales) for (const x of j.presentaciones) c[`${s.id}:${x.id}`] = '0'
      setRamaCant(c); setRamaInfo(j)
    } catch (e) { setRamaErr((e as Error).message) }
  }
  async function confirmarRama() {
    if (!ramaInfo || !ramaP) return
    const conteos: { sucursal_id: string; presentacion_id: string; cantidad: number }[] = []
    for (const s of ramaInfo.sucursales) for (const x of ramaInfo.presentaciones) {
      const v = (ramaCant[`${s.id}:${x.id}`] ?? '').trim()
      if (!/^\d+$/.test(v)) { setRamaErr('Las cantidades deben ser números enteros de 0 en adelante.'); return }
      conteos.push({ sucursal_id: s.id, presentacion_id: x.id, cantidad: parseInt(v, 10) })
    }
    setRamaTrab(true); setRamaErr('')
    try {
      await api({ accion: 'habilitar_rama', sucursal_id: sucId, producto_id: ramaP.id, operacion_id: ramaOp, motivo: ramaMotivo, conteos })
      setAvisoInv({ ok: true, t: `«${ramaP.nombre}» ahora lleva stock por presentación.` })
      setRamaP(null); await cargarInvRef.current()
    } catch (e) { setRamaErr((e as Error).message) } finally { setRamaTrab(false) }
  }

  const api = useCallback(async (body: Record<string, unknown>) => {
    const { data: { session } } = await createClient().auth.getSession()
    if (!session) throw Object.assign(new Error('Sesión vencida. Volvé a ingresar.'), { status: 401 })
    const r = await fetch('/api/stock', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j.error ?? 'Error'), { status: r.status, codigo: j.codigo })
    return j
  }, [])

  useEffect(() => {
    if (!ctx) return
    api({ accion: 'sucursales' }).then(j => { setSucs(j.sucursales); setPuedeHab(j.puede_habilitar === true); if (j.sucursales[0]) setSucId(j.sucursales[0].id) }).catch(e => setError(e.message))
  }, [ctx, api])

  const cargarInv = useCallback(async () => {
    if (!sucId) return
    setCargando(true); setError('')
    try { const j = await api({ accion: 'inventario', sucursal_id: sucId, todos }); setInv(j.items); setCats(j.categorias); setMinEdit({}) }
    catch (e) { setError((e as Error).message) } finally { setCargando(false) }
  }, [sucId, todos, api])
  useEffect(() => { cargarInv() }, [cargarInv])
  cargarInvRef.current = cargarInv

  // ── Sabores (helado por kilo): kilos de cada sabor por sucursal ──
  type PresKg = { id: string; producto: string; nombre: string; kg: number | null }
  type SabItem = { id: string; nombre: string; grupo: string; kg: number | null }
  const [sab, setSab] = useState<{ puede: boolean; pres: PresKg[]; sabores: SabItem[] } | null>(null)
  const [sabIn, setSabIn] = useState<Record<string, string>>({})
  const [kgPresIn, setKgPresIn] = useState<Record<string, string>>({})
  const [sabMotivo, setSabMotivo] = useState('Conteo de kilos')
  const [sabTrab, setSabTrab] = useState(false)
  const [sabMsg, setSabMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const cargarSab = useCallback(async () => {
    if (!sucId) return
    setSabMsg(null)
    try {
      const j = await api({ accion: 'sabores', sucursal_id: sucId })
      setSab({ puede: j.puede_configurar === true, pres: j.presentaciones, sabores: j.sabores }); setSabIn({}); setKgPresIn({})
    } catch (e) { setSab(null); setSabMsg({ ok: false, t: (e as Error).message }) }
  }, [sucId, api])
  useEffect(() => { if (tab === 'sabores') cargarSab() }, [tab, cargarSab])
  const kgOk = (v: string) => /^\d+([.,]\d{1,3})?$/.test(v.trim())
  const kgNum = (v: string) => Number(v.trim().replace(',', '.'))
  const fmtKg = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })
  async function guardarSabores() {
    const filas = Object.entries(sabIn).filter(([, v]) => v.trim() !== '')
    if (filas.length === 0) { setSabMsg({ ok: false, t: 'Cargá los kilos de al menos un sabor.' }); return }
    if (filas.some(([, v]) => !kgOk(v))) { setSabMsg({ ok: false, t: 'Los kilos son un número de 0 en adelante (hasta 3 decimales).' }); return }
    if (sabMotivo.trim().length < 3) { setSabMsg({ ok: false, t: 'Indicá el motivo.' }); return }
    setSabTrab(true); setSabMsg(null)
    let hechos = 0
    try {
      for (const [id, v] of filas) {
        await api({ accion: 'ajustar_sabor', sucursal_id: sucId, opcion_id: id, modo: 'set', kg: kgNum(v), motivo: sabMotivo.trim(), operacion_id: crypto.randomUUID() })
        hechos++
      }
      await cargarSab(); setSabMsg({ ok: true, t: `Kilos guardados en ${hechos} sabor${hechos === 1 ? '' : 'es'}.` })
    } catch (e) { await cargarSab(); setSabMsg({ ok: false, t: `${(e as Error).message}${hechos ? ` (se guardaron ${hechos} antes del error)` : ''}` }) }
    finally { setSabTrab(false) }
  }
  async function guardarKgPres(p: PresKg) {
    const v = (kgPresIn[p.id] ?? '').trim()
    if (v !== '' && (!kgOk(v) || kgNum(v) <= 0)) { setSabMsg({ ok: false, t: 'Los kilos de la presentación son un número mayor a 0.' }); return }
    setSabTrab(true); setSabMsg(null)
    try { await api({ accion: 'kg_presentacion', sucursal_id: sucId, presentacion_id: p.id, kg: v === '' ? null : kgNum(v) }); await cargarSab(); setSabMsg({ ok: true, t: `${p.producto} · ${p.nombre}: ${v === '' ? 'sin kilos (no descuenta)' : `${v} kg`}.` }) }
    catch (e) { setSabMsg({ ok: false, t: (e as Error).message }) } finally { setSabTrab(false) }
  }

  // Etapa 1.1: habilitar / quitar control (todo pasa por /api/stock; el servidor decide y pide confirmación si hay existencias)
  async function cambiarControl(i: InvItem, confirmar = false) {
    setAvisoInv(null)
    // HABILITAR: actualización inmediata en pantalla (sin recargar todo el inventario). El servidor sigue decidiendo: si falla, se revierte.
    if (!i.controla) {
      setPendientes(s => new Set(s).add(i.producto_id))
      setInv(l => l.map(x => x.producto_id === i.producto_id ? { ...x, controla: true, estado: 'sin_alta' } : x))
      try {
        await api({ accion: 'habilitar', sucursal_id: sucId, producto_id: i.producto_id })
      } catch (e) {
        setInv(l => l.map(x => x.producto_id === i.producto_id ? i : x))
        setAvisoInv({ ok: false, t: (e as Error).message })
      } finally { setPendientes(s => { const n = new Set(s); n.delete(i.producto_id); return n }) }
      return
    }
    // QUITAR: con confirmación si hay existencias (flujo de siempre)
    setAccionando(i.producto_id)
    try {
      await api({ accion: 'deshabilitar', sucursal_id: sucId, producto_id: i.producto_id, confirmar })
      setQuitar(null)
      setAvisoInv({ ok: true, t: `«${i.nombre}» ya no controla stock.` })
      await cargarInv()
    } catch (e) {
      const er = e as Error & { codigo?: string }
      if (er.codigo === 'CONFIRMAR_QUITAR') setQuitar({ producto_id: i.producto_id, texto: er.message })
      else setAvisoInv({ ok: false, t: er.message })
    } finally { setAccionando('') }
  }
  // Alta inicial: habilita de una vez todos los productos visibles (respeta búsqueda y categoría) que todavía no controlan stock
  async function habilitarLote() {
    const ids = filtrados.filter(i => !i.controla).map(i => i.producto_id)
    if (ids.length === 0) return
    setLoteTrabajando(true); setAvisoInv(null)
    try {
      const j = await api({ accion: 'habilitar_lote', sucursal_id: sucId, producto_ids: ids })
      const set = new Set(ids)
      setInv(l => l.map(x => set.has(x.producto_id) ? { ...x, controla: true, estado: 'sin_alta' } : x))
      setAvisoInv({ ok: true, t: `${j.habilitados} producto${j.habilitados === 1 ? '' : 's'} con control de stock. Cargales las existencias con un Ajuste general.` })
      setLoteConfirmar(false)
    } catch (e) { setAvisoInv({ ok: false, t: (e as Error).message }); setLoteConfirmar(false) }
    finally { setLoteTrabajando(false) }
  }
  async function guardarMinimo(i: InvItem) {
    const v = (minEdit[i.producto_id] ?? '').trim()
    if (v === '' || v === String(i.minimo)) { setMinEdit(m => { const n = { ...m }; delete n[i.producto_id]; return n }); return }
    if (!/^\d+$/.test(v)) { setAvisoInv({ ok: false, t: 'El mínimo debe ser un número entero de 0 en adelante.' }); return }
    setAvisoInv(null); setAccionando(i.producto_id)
    try { await api({ accion: 'minimo', sucursal_id: sucId, producto_id: i.producto_id, minimo: parseInt(v, 10) }); await cargarInv() }
    catch (e) { setAvisoInv({ ok: false, t: (e as Error).message }) } finally { setAccionando('') }
  }

  // ── Ajuste general ──
  const [conteo, setConteo] = useState<Conteo | null>(null)
  const [contado, setContado] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState('')
  const [desc, setDesc] = useState('')
  const [prev, setPrev] = useState<Prev | null>(null)
  const [entendido, setEntendido] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  const invalidar = () => { setPrev(null); setEntendido(false) }

  async function iniciarConteo() {
    setMsg(null); setTrabajando(true)
    try {
      const j = await api({ accion: 'iniciar', sucursal_id: sucId })   // el servidor congela y guarda la base
      setConteo({ lote_id: j.lote_id, iniciado_at: j.iniciado_at, items: j.items }); setContado({}); setMotivo(''); setDesc(''); invalidar()
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }) } finally { setTrabajando(false) }
  }
  function cancelarConteo() { setConteo(null); setContado({}); invalidar(); setMsg(null) }

  const itemsConteo = useMemo(() => {
    if (!conteo) return []
    return Object.entries(contado).filter(([, v]) => v.trim() !== '' && /^\d+$/.test(v.trim()))
      .map(([producto_id, v]) => ({ producto_id, contado: parseInt(v, 10) }))   // solo producto y contado: la base la tiene el servidor
  }, [contado, conteo])
  const hayInvalidos = Object.values(contado).some(v => v.trim() !== '' && !/^\d+$/.test(v.trim()))
  const cuerpoAjuste = () => ({ sucursal_id: sucId, lote_id: conteo!.lote_id, motivo_tipo: motivo, descripcion: desc.trim() || null, items: itemsConteo })
  const motivoOk = !!motivo && (motivo !== 'otro' || desc.trim().length >= 3)

  async function revisar() {
    if (!conteo) return
    setMsg(null); setTrabajando(true); invalidar()
    try { setPrev(await api({ accion: 'previsualizar', ...cuerpoAjuste() })) }
    catch (e) { setMsg({ ok: false, t: (e as Error).message }) } finally { setTrabajando(false) }
  }
  async function aplicar() {
    if (!conteo || !prev) return
    setMsg(null); setTrabajando(true)
    try {
      const j = await api({ accion: 'aplicar', ...cuerpoAjuste(), huella_confirmada: prev.resumen.requiere_confirmacion ? prev.huella : null })
      const n = (j.items as unknown[]).length
      setMsg({ ok: true, t: j.estado === 'ya_aplicado' ? `Este ajuste ya estaba aplicado (${n} productos). No se repitió.` : `Ajuste aplicado: ${n} producto${n === 1 ? '' : 's'}.` })
      setConteo(null); setContado({}); invalidar(); cargarInv()
    } catch (e) {
      const er = e as Error & { codigo?: string }
      if (er.codigo === 'CONFIRMACION_INVALIDA') { setMsg({ ok: false, t: er.message }); setEntendido(false); try { setPrev(await api({ accion: 'previsualizar', ...cuerpoAjuste() })) } catch { /* se muestra el mensaje */ } }
      else setMsg({ ok: false, t: er.message })
    } finally { setTrabajando(false) }
  }

  // ── Movimientos ──
  const [movs, setMovs] = useState<Mov[]>([])
  const [movPag, setMovPag] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [movTipo, setMovTipo] = useState('')
  const [movCargando, setMovCargando] = useState(false)
  const cargarMovs = useCallback(async (pagina: number) => {
    if (!sucId) return
    setMovCargando(true); setError('')
    try {
      const j = await api({ accion: 'movimientos', sucursal_id: sucId, pagina, limite: 50, motivo: movTipo || undefined })
      setMovs(prevM => pagina === 0 ? j.items : [...prevM, ...j.items]); setHayMas(j.hay_mas); setMovPag(pagina)
    } catch (e) { setError((e as Error).message) } finally { setMovCargando(false) }
  }, [sucId, movTipo, api])
  useEffect(() => { if (tab === 'movimientos') cargarMovs(0) }, [tab, cargarMovs])
  useEffect(() => { setConteo(null); setContado({}); invalidar(); setMsg(null) }, [sucId])

  const filtrados = useMemo(() => inv.filter(i => (!catF || i.categoria_id === catF) && (!busca || i.nombre.toLowerCase().includes(busca.toLowerCase()) || (i.codigo ?? '').toLowerCase().includes(busca.toLowerCase()))), [inv, busca, catF])
  const sinControlVisibles = useMemo(() => filtrados.filter(i => !i.controla).length, [filtrados])
  // Árbol: categoría → producto → presentaciones (en el orden de las categorías del catálogo)
  const arbol = useMemo(() => {
    const orden = new Map(cats.map((c, k) => [c.id, k]))
    const g = new Map<string, { nombre: string; items: InvItem[] }>()
    for (const i of filtrados) { const k = i.categoria_id ?? '—'; const e = g.get(k) ?? { nombre: i.categoria ?? 'Sin categoría', items: [] }; e.items.push(i); g.set(k, e) }
    return [...g.entries()].sort((a, b) => (orden.get(a[0]) ?? 999) - (orden.get(b[0]) ?? 999)).map(([id, v]) => ({ id, ...v }))
  }, [filtrados, cats])

  if (ctxLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>
  if (error && sucs.length === 0) return <div className="p-6 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>

  const Tab = ({ id, children }: { id: typeof tab; children: React.ReactNode }) => (
    <button onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}>{children}</button>
  )
  const inputCls = 'border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white'

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><h1 className="text-2xl font-semibold text-neutral-900">Stock</h1><p className="text-sm text-neutral-500">Inventario, ajustes y movimientos por sucursal.</p></div>
        <div className="flex items-center gap-3">
          <Link href={`/${ctx?.empresaSlug ?? ''}/admin/compras`} className="text-sm text-neutral-700 underline inline-flex items-center gap-1"><Package size={14} />Ir a Compras</Link>
          {sucs.length > 1
            ? <select value={sucId} onChange={e => setSucId(e.target.value)} className={inputCls}>{sucs.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
            : <span className="text-sm font-medium text-neutral-700">{sucs[0]?.nombre}</span>}
        </div>
      </div>
      <div className="flex gap-1 border-b border-neutral-200 mb-5"><Tab id="inventario">Inventario</Tab><Tab id="sabores">Sabores (kg)</Tab><Tab id="ajuste">Ajuste general</Tab><Tab id="movimientos">Movimientos</Tab></div>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {tab === 'inventario' && (
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative"><Search size={14} className="absolute left-3 top-3 text-neutral-400" /><input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar producto o código" className={`${inputCls} pl-8`} /></div>
            <select value={catF} onChange={e => setCatF(e.target.value)} className={inputCls}><option value="">Todas las categorías</option>{cats.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
            <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer"><input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} />Mostrar todos los productos</label>
            {puedeHab && todos && sinControlVisibles > 0 && !loteConfirmar && (
              <button onClick={() => setLoteConfirmar(true)} className="px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white hover:bg-neutral-50">Habilitar control a {sinControlVisibles === 1 ? 'el' : 'los'} {sinControlVisibles} visible{sinControlVisibles === 1 ? '' : 's'}</button>)}
          </div>
          {loteConfirmar && (
            <div className="mb-3 p-3 rounded-lg bg-neutral-50 border border-neutral-200 text-sm text-neutral-800">
              <p className="mb-2">Vas a habilitar el control de stock de <b>{sinControlVisibles}</b> producto{sinControlVisibles === 1 ? '' : 's'}{catF || busca ? ' (los que ves con el filtro actual)' : ''}. Aplica a todas las sucursales y no carga existencias: después se dan de alta con un Ajuste general.</p>
              <div className="flex gap-2">
                <button onClick={habilitarLote} disabled={loteTrabajando} className="px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-50">{loteTrabajando ? 'Habilitando…' : 'Sí, habilitar'}</button>
                <button onClick={() => setLoteConfirmar(false)} disabled={loteTrabajando} className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm bg-white">Cancelar</button>
              </div>
            </div>)}
          {avisoInv && <div className={`mb-3 p-3 rounded-lg text-sm flex gap-2 ${avisoInv.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{avisoInv.ok ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}{avisoInv.t}</div>}
          {quitar && (
            <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
              <div className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle size={16} />Quitar el control de stock</div>
              <p className="mb-2">{quitar.texto}</p>
              <div className="flex gap-2">
                <button onClick={() => { const i = inv.find(x => x.producto_id === quitar.producto_id); if (i) cambiarControl(i, true) }} disabled={!!accionando} className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-sm font-medium disabled:opacity-50">Quitar el control</button>
                <button onClick={() => setQuitar(null)} className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm bg-white">Cancelar</button>
              </div>
            </div>)}
          {cargando ? <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div> : (
            <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm"><thead className="bg-neutral-50 text-neutral-500 text-left"><tr><th className="px-4 py-2 w-10" title="Controlar stock">Ctrl.</th><th className="px-4 py-2">Producto</th><th className="px-4 py-2 text-right">Existencias</th><th className="px-4 py-2 text-right">Mínimo</th><th className="px-4 py-2">Estado</th></tr></thead>
                <tbody>{arbol.map(g => (
                  <Fragment key={g.id}>
                    <tr className="bg-neutral-50 border-t border-neutral-200"><td colSpan={5} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{g.nombre}</td></tr>
                    {g.items.map(i => (
                      <Fragment key={i.producto_id}>
                        <tr className={`border-t border-neutral-100 ${i.controla ? '' : 'text-neutral-400'}`}>
                          <td className="px-4 py-2"><input type="checkbox" checked={i.controla} disabled={!puedeHab || accionando === i.producto_id || pendientes.has(i.producto_id)} onChange={() => cambiarControl(i)} aria-label={`Controlar stock de ${i.nombre}`} title={puedeHab ? (i.controla ? 'Quitar el control de stock' : 'Habilitar el control de stock') : 'Solo un administrador de toda la empresa puede cambiarlo'} /></td>
                          <td className="px-4 py-2 font-medium">{i.nombre}{i.codigo && <span className="ml-2 text-xs font-normal text-neutral-400">{i.codigo}</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{i.cantidad ?? '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{i.controla && i.cantidad !== null
                            ? <input inputMode="numeric" value={minEdit[i.producto_id] ?? String(i.minimo ?? 0)} onChange={e => setMinEdit(m => ({ ...m, [i.producto_id]: e.target.value }))} onBlur={() => guardarMinimo(i)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} disabled={accionando === i.producto_id} aria-label={`Mínimo de ${i.nombre}`} className="w-16 text-right border border-neutral-200 rounded px-1.5 py-0.5 text-sm bg-white" />
                            : '—'}</td>
                          <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO[i.estado].c}`}>{ESTADO[i.estado].t}</span>
                            {i.controla && i.estado === 'sin_alta' && i.modelo !== 'rama' && <button onClick={() => setTab('ajuste')} className="ml-2 text-xs underline text-neutral-600">Cargar stock</button>}
                            {puedeHab && i.modelo !== 'rama' && i.presentaciones.length > 0 && <button onClick={() => abrirRama(i)} className="ml-2 text-xs font-medium underline text-blue-700">Stock por presentación</button>}</td></tr>
                        {i.presentaciones.map(p => (
                          i.modelo === 'rama'
                            ? <tr key={p.id} className="text-xs text-neutral-600"><td></td><td className="px-4 py-1 pl-10">↳ {p.nombre}</td><td className="px-4 py-1 text-right tabular-nums font-medium">{p.saldo ?? '—'}</td>
                                <td className="px-4 py-1" colSpan={2}>{p.saldo !== null && p.saldo !== undefined && (
                                  <span className="flex gap-1 items-center">
                                    <input inputMode="numeric" placeholder="nuevo saldo" value={ajR[p.id]?.valor ?? ''} onChange={e => setAjR(a => ({ ...a, [p.id]: { valor: e.target.value, motivo: a[p.id]?.motivo ?? '' } }))} aria-label={`Nuevo saldo de ${p.nombre}`} className="w-20 text-right border border-neutral-200 rounded px-1.5 py-0.5 bg-white" />
                                    <input placeholder="motivo" value={ajR[p.id]?.motivo ?? ''} onChange={e => setAjR(a => ({ ...a, [p.id]: { valor: a[p.id]?.valor ?? '', motivo: e.target.value } }))} aria-label={`Motivo del ajuste de ${p.nombre}`} className="w-32 border border-neutral-200 rounded px-1.5 py-0.5 bg-white" />
                                    <button onClick={() => ajustarHoja(p)} disabled={ajRTrab === p.id} className="underline text-neutral-700 disabled:opacity-40">Ajustar</button>
                                  </span>)}</td></tr>
                            : <tr key={p.id} className="text-xs text-neutral-500"><td></td><td className="px-4 py-0.5 pl-10" colSpan={2}>↳ {p.nombre}{p.factor > 1 && <span className="text-neutral-400"> · descuenta {p.factor}</span>}</td><td className="px-4 py-0.5 text-right tabular-nums" colSpan={2}>{p.vendibles !== null ? `${p.vendibles} vendibles` : ''}</td></tr>))}
                      </Fragment>))}
                  </Fragment>))}
                  {arbol.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">{todos ? 'No hay productos.' : 'No hay productos con control de stock. Marcá «Mostrar todos los productos» para habilitar alguno.'}</td></tr>}</tbody></table>
            </div>
          )}
          {ramaP && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-auto p-5">
                <h2 className="text-lg font-semibold mb-1">Stock por presentación · {ramaP.nombre}</h2>
                {!ramaInfo && !ramaErr && <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>}
                {ramaInfo && ramaInfo.bloqueos.length > 0 && (
                  <div className="my-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
                    <p className="font-semibold mb-1">Este producto todavía no se puede pasar a stock por presentación:</p>
                    <ul className="list-disc pl-5 space-y-1">{ramaInfo.bloqueos.map(t => <li key={t}>{t}</li>)}</ul>
                  </div>)}
                {ramaInfo && ramaInfo.bloqueos.length > 0 && (() => {
                  const it = inv.find(x => x.producto_id === ramaP.id)
                  if (!it || !puedeHab) return null
                  return (
                    <div className="mb-3 p-3 rounded-lg bg-neutral-50 border border-neutral-200 text-sm">
                      <p className="mb-2 text-neutral-700">Para baldes y productos que se venden por unidad: controlá el stock del producto y cargalo en el Ajuste general.</p>
                      <button onClick={async () => { setRamaP(null); if (!it.controla) await cambiarControl(it); setTab('ajuste') }} className="px-3 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium">{it.controla ? 'Ir a cargar stock' : 'Controlar stock y cargarlo'}</button>
                    </div>)
                })()}
                {ramaInfo && ramaInfo.bloqueos.length === 0 && (
                  <>
                    <p className="text-sm text-neutral-600 mb-3">Cargá cuántas unidades hay de cada presentación en cada sucursal. Cada presentación lleva su propio stock y se descuenta sola cuando se vende.</p>
                    <div className="overflow-x-auto border border-neutral-200 rounded-xl mb-3">
                      <table className="w-full text-sm"><thead className="bg-neutral-50 text-neutral-500 text-left"><tr><th className="px-3 py-2">Sucursal</th>{ramaInfo.presentaciones.map(x => <th key={x.id} className="px-3 py-2 text-right">{x.nombre}</th>)}</tr></thead>
                        <tbody>{ramaInfo.sucursales.map(sc => (
                          <tr key={sc.id} className="border-t border-neutral-100"><td className="px-3 py-2 font-medium">{sc.nombre}{sc.saldo > 0 && <span className="block text-xs font-normal text-amber-700">Tenía {sc.saldo} en el stock anterior del producto</span>}</td>
                            {ramaInfo.presentaciones.map(x => (
                              <td key={x.id} className="px-3 py-2 text-right"><input inputMode="numeric" value={ramaCant[`${sc.id}:${x.id}`] ?? ''} onChange={e => setRamaCant(c => ({ ...c, [`${sc.id}:${x.id}`]: e.target.value }))} aria-label={`${x.nombre} en ${sc.nombre}`} className="w-20 text-right border border-neutral-200 rounded px-2 py-1 bg-white" /></td>))}</tr>))}</tbody></table>
                    </div>
                    <label className="text-sm font-medium block mb-1">Motivo</label>
                    <input value={ramaMotivo} onChange={e => setRamaMotivo(e.target.value)} className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white mb-3" />
                  </>)}
                {ramaErr && <div className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm flex gap-2"><AlertTriangle size={16} className="mt-0.5" />{ramaErr}</div>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setRamaP(null)} disabled={ramaTrab} className="px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white">Cancelar</button>
                  {ramaInfo && ramaInfo.bloqueos.length === 0 && <button onClick={confirmarRama} disabled={ramaTrab} className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-50">{ramaTrab ? 'Guardando…' : 'Guardar stock'}</button>}
                </div>
              </div>
            </div>)}
          <p className="text-xs text-neutral-400 mt-3">Tildá un producto para que controle stock (aplica a todas las sucursales). Un producto «Sin alta» todavía no tiene stock cargado en esta sucursal: se da de alta contándolo en un Ajuste general. Las presentaciones descuentan del stock del producto según su factor.</p>
        </div>
      )}

      {tab === 'sabores' && (
        <div className="space-y-5">
          <div className="p-3 rounded-lg bg-blue-50 text-blue-900 text-sm">Para el <b>helado por kilo</b>: cargá los <b>kilos que hay de cada sabor</b>. Al vender 1/4, 1/2 o 1 kg se descuentan de los sabores elegidos, en partes iguales. Los sabores que dejes sin cargar no se controlan. Si un sabor no alcanza, la venta sale igual y la caja avisa.</div>
          {sabMsg && <div className={`p-3 rounded-lg text-sm flex gap-2 ${sabMsg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{sabMsg.ok ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}{sabMsg.t}</div>}
          {sab && (
            <>
              <div className="bg-white border border-neutral-200 rounded-xl p-4">
                <h2 className="font-semibold mb-1">Kilos de cada presentación</h2>
                <p className="text-sm text-neutral-500 mb-3">Cuántos kilos descuenta cada presentación al venderse (1 Kg = 1, 1/2 Kg = 0,5, 1/4 Kg = 0,25). Dejala vacía para que no descuente.</p>
                {sab.pres.length === 0 ? <p className="text-sm text-neutral-400">No hay presentaciones con sabores.</p> : (
                  <div className="divide-y divide-neutral-100">{sab.pres.map(p => (
                    <div key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="flex-1 min-w-40 font-medium">{p.producto} <span className="font-normal text-neutral-500">· {p.nombre}</span></span>
                      <input inputMode="decimal" disabled={!sab.puede || sabTrab} placeholder="sin kilos" value={kgPresIn[p.id] ?? (p.kg === null ? '' : String(p.kg).replace('.', ','))} onChange={e => setKgPresIn(k => ({ ...k, [p.id]: e.target.value }))} aria-label={`Kilos de ${p.producto} ${p.nombre}`} className={`${inputCls} w-24 text-right`} />
                      <span className="text-neutral-500">kg</span>
                      {sab.puede && <button onClick={() => guardarKgPres(p)} disabled={sabTrab || kgPresIn[p.id] === undefined} className="underline text-neutral-700 disabled:opacity-40">Guardar</button>}
                    </div>))}</div>)}
              </div>
              <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm"><thead className="bg-neutral-50 text-neutral-500 text-left"><tr><th className="px-4 py-2">Sabor</th><th className="px-4 py-2 text-right">Kilos hoy</th><th className="px-4 py-2 text-right w-40">Kilos contados</th></tr></thead>
                  <tbody>{sab.sabores.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-neutral-400">Todavía no hay sabores: configurá los kilos de al menos una presentación arriba.</td></tr>}
                    {sab.sabores.map((x, idx) => (
                      <Fragment key={x.id}>
                        {(idx === 0 || sab.sabores[idx - 1].grupo !== x.grupo) && <tr className="bg-neutral-50 border-t border-neutral-200"><td colSpan={3} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{x.grupo}</td></tr>}
                        <tr className="border-t border-neutral-100"><td className="px-4 py-2 font-medium">{x.nombre}</td>
                          <td className={`px-4 py-2 text-right tabular-nums ${x.kg === null ? 'text-neutral-400' : x.kg === 0 ? 'text-red-600 font-medium' : ''}`}>{x.kg === null ? 'Sin cargar' : x.kg === 0 ? 'Sin kilos' : `${fmtKg(x.kg)} kg`}</td>
                          <td className="px-4 py-2 text-right"><input inputMode="decimal" value={sabIn[x.id] ?? ''} onChange={e => setSabIn(k => ({ ...k, [x.id]: e.target.value }))} aria-label={`Kilos contados de ${x.nombre}`} className={`${inputCls} w-28 text-right ${sabIn[x.id] && !kgOk(sabIn[x.id]) ? 'border-red-400' : ''}`} /></td></tr>
                      </Fragment>))}</tbody></table>
              </div>
              <div className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-48"><label className="text-sm font-medium block mb-1">Motivo</label><input value={sabMotivo} onChange={e => setSabMotivo(e.target.value)} className={`${inputCls} w-full`} /></div>
                <button onClick={guardarSabores} disabled={sabTrab || Object.values(sabIn).every(v => v.trim() === '')} className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-50">{sabTrab ? 'Guardando…' : 'Guardar kilos'}</button>
              </div>
            </>)}
        </div>
      )}

      {tab === 'ajuste' && (
        <div>
          {msg && <div className={`mb-4 p-3 rounded-lg text-sm flex gap-2 ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.ok ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}{msg.t}</div>}
          {!conteo ? (
            <div className="bg-white border border-neutral-200 rounded-xl p-6">
              <h2 className="font-semibold mb-1 flex items-center gap-2"><ClipboardList size={18} />Ajuste general por conteo</h2>
              <p className="text-sm text-neutral-600 mb-4">Al iniciar el conteo se congela el stock que figura hoy en el sistema. Contás lo que hay en el estante y el sistema aplica <b>solo la diferencia</b> (contado − stock inicial): las ventas que entren mientras contás no se pierden.</p>
              <button onClick={iniciarConteo} disabled={trabajando || !sucId} className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-50">{trabajando ? 'Iniciando…' : 'Iniciar conteo'}</button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="p-3 rounded-lg bg-blue-50 text-blue-900 text-sm">Conteo iniciado a las {fmt(conteo.iniciado_at)}. Cargá solo los productos que contaste; los que dejes vacíos no se tocan.</div>
              <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm"><thead className="bg-neutral-50 text-neutral-500 text-left"><tr><th className="px-4 py-2">Producto</th><th className="px-4 py-2 text-right">Stock al iniciar</th><th className="px-4 py-2 text-right w-36">Contado</th><th className="px-4 py-2 text-right">Diferencia</th></tr></thead>
                  <tbody>{conteo.items.map(i => {
                    const v = contado[i.producto_id] ?? ''; const ok = /^\d+$/.test(v.trim()); const base = i.base
                    return (<tr key={i.producto_id} className="border-t border-neutral-100"><td className="px-4 py-2 font-medium">{i.nombre}{i.sin_alta && <span className="ml-2 text-xs text-neutral-400">sin alta</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{base}</td>
                      <td className="px-4 py-2 text-right"><input inputMode="numeric" value={v} onChange={e => { setContado(c => ({ ...c, [i.producto_id]: e.target.value })); invalidar() }} className={`${inputCls} w-24 text-right ${v && !ok ? 'border-red-400' : ''}`} /></td>
                      <td className={`px-4 py-2 text-right tabular-nums ${ok && parseInt(v, 10) - base < 0 ? 'text-red-600' : 'text-green-700'}`}>{ok ? sg(parseInt(v, 10) - base) : ''}</td></tr>)
                  })}</tbody></table>
              </div>
              {hayInvalidos && <p className="text-sm text-red-600">Las cantidades deben ser números enteros de 0 en adelante.</p>}

              <div className="bg-white border border-neutral-200 rounded-xl p-5 grid gap-3 sm:grid-cols-2">
                <div><label className="text-sm font-medium block mb-1">Motivo del ajuste *</label>
                  <select value={motivo} onChange={e => { setMotivo(e.target.value); invalidar() }} className={`${inputCls} w-full`}><option value="">Elegí un motivo</option>{MOTIVOS_AJUSTE.map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}</select></div>
                <div><label className="text-sm font-medium block mb-1">Descripción {motivo === 'otro' ? '*' : '(opcional)'}</label>
                  <input value={desc} maxLength={300} onChange={e => { setDesc(e.target.value); invalidar() }} className={`${inputCls} w-full`} placeholder={motivo === 'otro' ? 'Obligatoria con «Otro»' : ''} /></div>
              </div>

              {prev && (
                <div className="bg-white border border-neutral-200 rounded-xl p-5">
                  <h3 className="font-semibold mb-2">Resumen antes de aplicar</h3>
                  <p className="text-sm text-neutral-600 mb-3">{prev.resumen.items_n} producto{prev.resumen.items_n === 1 ? '' : 's'} · {prev.resumen.total_abs} unidades de diferencia en total. Es lo que se aplica, no se reemplaza el stock por lo contado.</p>
                  <div className="overflow-x-auto"><table className="w-full text-sm mb-3"><thead className="text-neutral-500 text-left"><tr><th className="py-1">Producto</th><th className="py-1 text-right">Al iniciar</th><th className="py-1 text-right">Hoy</th><th className="py-1 text-right">Contado</th><th className="py-1 text-right">Diferencia</th><th className="py-1 text-right">Queda</th></tr></thead>
                    <tbody>{prev.items.map(it => (
                      <tr key={it.producto_id} className={`border-t border-neutral-100 ${it.recortado ? 'bg-red-50' : it.importante ? 'bg-amber-50' : ''}`}>
                        <td className="py-1.5">{it.nombre}{it.fila_nueva && <span className="ml-2 text-xs text-neutral-500">alta nueva</span>}
                          {it.recortado && <div className="text-xs text-red-700">Quedaría negativo: se ajusta a 0. Pediste {sg(it.diff_pedida)}, se aplica {sg(it.diff_aplicada)}.</div>}</td>
                        <td className="py-1.5 text-right tabular-nums">{it.base}</td><td className="py-1.5 text-right tabular-nums">{it.actual}</td><td className="py-1.5 text-right tabular-nums">{it.contado}</td>
                        <td className="py-1.5 text-right tabular-nums">{sg(it.diff_pedida)}</td><td className="py-1.5 text-right tabular-nums font-semibold">{it.final}</td></tr>))}</tbody></table></div>
                  {prev.resumen.requiere_confirmacion && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 mb-3">
                      <div className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle size={16} />Este ajuste necesita una segunda confirmación</div>
                      <ul className="list-disc pl-5 mb-2">{prev.resumen.motivos_confirmacion.map(m => <li key={m}>{MOTIVOS_CONF[m] ?? m}</li>)}</ul>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={entendido} onChange={e => setEntendido(e.target.checked)} />Revisé el resumen y confirmo este ajuste.</label>
                    </div>)}
                </div>
              )}

              <div className="flex gap-3">
                {!prev
                  ? <button onClick={revisar} disabled={trabajando || itemsConteo.length === 0 || hayInvalidos || !motivoOk} className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-40">{trabajando ? 'Calculando…' : 'Revisar ajuste'}</button>
                  : <button onClick={aplicar} disabled={trabajando || (prev.resumen.requiere_confirmacion && !entendido)} className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium disabled:opacity-40">{trabajando ? 'Aplicando…' : prev.resumen.requiere_confirmacion ? 'Confirmar y aplicar' : 'Aplicar ajuste'}</button>}
                <button onClick={cancelarConteo} disabled={trabajando} className="px-4 py-2 rounded-lg border border-neutral-300 text-sm">Cancelar conteo</button>
              </div>
              {!motivoOk && itemsConteo.length > 0 && <p className="text-xs text-neutral-500">Elegí el motivo{motivo === 'otro' ? ' y escribí la descripción' : ''} para poder revisar.</p>}
            </div>
          )}
        </div>
      )}

      {tab === 'movimientos' && (
        <div>
          <div className="mb-4"><select value={movTipo} onChange={e => setMovTipo(e.target.value)} className={inputCls}><option value="">Todos los movimientos</option>{Object.entries(TIPO_MOV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="bg-white border border-neutral-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm"><thead className="bg-neutral-50 text-neutral-500 text-left"><tr><th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Producto</th><th className="px-4 py-2 text-right">Cantidad</th><th className="px-4 py-2">Responsable</th><th className="px-4 py-2">Detalle</th></tr></thead>
              <tbody>{movs.map(m => (
                <tr key={m.id} className="border-t border-neutral-100"><td className="px-4 py-2 whitespace-nowrap text-neutral-500">{fmt(m.fecha)}</td>
                  <td className="px-4 py-2">{TIPO_MOV[m.tipo] ?? m.tipo}{m.motivo_tipo && <span className="text-neutral-500"> · {MOTIVO_LABEL[m.motivo_tipo as keyof typeof MOTIVO_LABEL] ?? m.motivo_tipo}</span>}</td>
                  <td className="px-4 py-2">{m.producto ?? '—'}{m.es_articulo && <span className="ml-1 text-xs text-neutral-400">(artículo)</span>}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${m.delta < 0 ? 'text-red-600' : 'text-green-700'}`}>{sg(m.delta)}</td>
                  <td className={`px-4 py-2 ${m.responsable === 'No registrado' ? 'text-neutral-400' : ''}`}>{m.responsable}</td>
                  <td className="px-4 py-2 text-neutral-500 max-w-xs truncate" title={m.descripcion ?? m.detalle ?? ''}>{m.descripcion ?? m.detalle ?? ''}</td></tr>))}
                {!movCargando && movs.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-neutral-400">Sin movimientos.</td></tr>}</tbody></table>
          </div>
          {movCargando && <div className="flex justify-center py-4"><Loader2 className="animate-spin" /></div>}
          {hayMas && !movCargando && <button onClick={() => cargarMovs(movPag + 1)} className="mt-3 px-4 py-2 rounded-lg border border-neutral-300 text-sm">Ver más</button>}
        </div>
      )}
    </div>
  )
}
