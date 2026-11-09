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
interface PresInv { id: string; nombre: string; factor: number; vendibles: number | null }

interface Suc { id: string; nombre: string }
interface InvItem { producto_id: string; nombre: string; codigo: string | null; categoria_id: string | null; categoria: string | null; controla: boolean; cantidad: number | null; minimo: number | null; estado: Est; actualizado: string | null; presentaciones: PresInv[] }
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
  const [tab, setTab] = useState<'inventario' | 'ajuste' | 'movimientos'>('inventario')
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
  const [minEdit, setMinEdit] = useState<Record<string, string>>({})
  const [avisoInv, setAvisoInv] = useState<{ ok: boolean; t: string } | null>(null)

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

  // Etapa 1.1: habilitar / quitar control (todo pasa por /api/stock; el servidor decide y pide confirmación si hay existencias)
  async function cambiarControl(i: InvItem, confirmar = false) {
    setAvisoInv(null); setAccionando(i.producto_id)
    try {
      await api({ accion: i.controla ? 'deshabilitar' : 'habilitar', sucursal_id: sucId, producto_id: i.producto_id, confirmar })
      setQuitar(null)
      setAvisoInv({ ok: true, t: i.controla ? `«${i.nombre}» ya no controla stock.` : `«${i.nombre}» ahora controla stock. Cargale las existencias con un Ajuste general.` })
      await cargarInv()
    } catch (e) {
      const er = e as Error & { codigo?: string }
      if (er.codigo === 'CONFIRMAR_QUITAR') setQuitar({ producto_id: i.producto_id, texto: er.message })
      else setAvisoInv({ ok: false, t: er.message })
    } finally { setAccionando('') }
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
      <div className="flex gap-1 border-b border-neutral-200 mb-5"><Tab id="inventario">Inventario</Tab><Tab id="ajuste">Ajuste general</Tab><Tab id="movimientos">Movimientos</Tab></div>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {tab === 'inventario' && (
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative"><Search size={14} className="absolute left-3 top-3 text-neutral-400" /><input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar producto o código" className={`${inputCls} pl-8`} /></div>
            <select value={catF} onChange={e => setCatF(e.target.value)} className={inputCls}><option value="">Todas las categorías</option>{cats.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
            <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer"><input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} />Mostrar todos los productos</label>
          </div>
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
                          <td className="px-4 py-2"><input type="checkbox" checked={i.controla} disabled={!puedeHab || accionando === i.producto_id} onChange={() => cambiarControl(i)} aria-label={`Controlar stock de ${i.nombre}`} title={puedeHab ? (i.controla ? 'Quitar el control de stock' : 'Habilitar el control de stock') : 'Solo un administrador de toda la empresa puede cambiarlo'} /></td>
                          <td className="px-4 py-2 font-medium">{i.nombre}{i.codigo && <span className="ml-2 text-xs font-normal text-neutral-400">{i.codigo}</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{i.cantidad ?? '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-neutral-500">{i.controla && i.cantidad !== null
                            ? <input inputMode="numeric" value={minEdit[i.producto_id] ?? String(i.minimo ?? 0)} onChange={e => setMinEdit(m => ({ ...m, [i.producto_id]: e.target.value }))} onBlur={() => guardarMinimo(i)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} disabled={accionando === i.producto_id} aria-label={`Mínimo de ${i.nombre}`} className="w-16 text-right border border-neutral-200 rounded px-1.5 py-0.5 text-sm bg-white" />
                            : '—'}</td>
                          <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO[i.estado].c}`}>{ESTADO[i.estado].t}</span>
                            {i.controla && i.estado === 'sin_alta' && <button onClick={() => setTab('ajuste')} className="ml-2 text-xs underline text-neutral-600">Cargar stock</button>}</td></tr>
                        {i.presentaciones.map(p => (
                          <tr key={p.id} className="text-xs text-neutral-500"><td></td><td className="px-4 py-0.5 pl-10" colSpan={2}>↳ {p.nombre}{p.factor > 1 && <span className="text-neutral-400"> · descuenta {p.factor}</span>}</td><td className="px-4 py-0.5 text-right tabular-nums" colSpan={2}>{p.vendibles !== null ? `${p.vendibles} vendibles` : ''}</td></tr>))}
                      </Fragment>))}
                  </Fragment>))}
                  {arbol.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">{todos ? 'No hay productos.' : 'No hay productos con control de stock. Marcá «Mostrar todos los productos» para habilitar alguno.'}</td></tr>}</tbody></table>
            </div>
          )}
          <p className="text-xs text-neutral-400 mt-3">Tildá un producto para que controle stock (aplica a todas las sucursales). Un producto «Sin alta» todavía no tiene stock cargado en esta sucursal: se da de alta contándolo en un Ajuste general. Las presentaciones descuentan del stock del producto según su factor.</p>
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
