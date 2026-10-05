'use client'

// ═══════════════════════════════════════════════════════════════
// COMPRAS/REMITOS V1 · T2 — Maestros: Proveedores + Artículos
// (GO CTO 29/09). Gate duro por modulos.compras. Todo por API
// server-side (/api/compras) con Bearer del admin — cero
// mutaciones desde el browser. Baja LÓGICA siempre.
// Slug por window.location.pathname (Next 16: params Promise).
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { ConeButton, ConeModal } from '@/components/admin/ConeComponents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Loader2, Pencil, Package, Truck, Boxes, Download, FileText } from 'lucide-react'

interface Proveedor { id: string; nombre: string; razon_social: string | null; cuit: string | null; telefono: string | null; email: string | null; direccion: string | null; observaciones: string | null; activo: boolean }
interface Articulo { id: string; nombre: string; tipo: string; unidad_stock: string; producto_id: string | null; controla_stock: boolean; activo: boolean }
interface Presentacion { id: string; articulo_id: string; nombre: string; factor: number; activo: boolean }
interface ProductoVenta { id: string; nombre: string }
interface Sucursal { id: string; nombre: string }
interface OC { id: string; numero: number; proveedor_id: string; sucursal_id: string | null; estado: string; fecha: string; observaciones: string | null }
interface OCItem { id: string; orden_compra_id: string; articulo_id: string; presentacion_id: string | null; cantidad: number; costo_previsto: number | null }
interface RenglonForm { articulo_id: string; presentacion_id: string; cantidad: string; costo_previsto: string }
interface Remito { id: string; numero: number; numero_proveedor: string | null; proveedor_id: string; sucursal_id: string; orden_compra_id: string | null; tipo: string; fecha: string; estado: string; confirmado_at: string | null; observaciones: string | null }
interface Comprobante { id: string; proveedor_id: string; tipo: string; letra: string | null; numero_proveedor: string; fecha: string; total: number; estado: string; observaciones: string | null; created_at: string }
interface CompRemito { comprobante_id: string; remito_id: string }
interface CcMov { id: string; proveedor_id: string; tipo: 'debe' | 'haber'; monto: number; comprobante_id: string | null; orden_pago_id: string | null; detalle: string | null; created_at: string }
interface Op { id: string; proveedor_id: string; numero: number; fecha: string; total: number; anulada: boolean; observaciones: string | null }
interface OpValor { id: string; orden_pago_id: string; tipo: 'efectivo' | 'transferencia' | 'cheque'; cuenta_banco_id: string | null; cheque_id: string | null; monto: number }
interface OpImp { id: string; orden_pago_id: string; comprobante_id: string; monto: number }
interface ChequeRow { id: string; numero: number | null; tipo: string | null; formato: string | null; estado: string | null }
interface CompItem { id: string; comprobante_id: string; articulo_id: string | null; descripcion: string; cantidad: number; precio_unitario: number }
type RenglonFact = { descripcion: string; articulo_id: string; presentacion_id: string; cantidad: string; precio: string; origen_remito: string | null; ingresa: boolean }
interface RemitoItem { id: string; remito_id: string; articulo_id: string; presentacion_id: string | null; cantidad: number; factor_snap: number; cantidad_operativa: number; costo_unitario: number; cantidad_pedida: number | null }

const TIPOS = [
  { value: 'mercaderia', label: 'Mercadería' },
  { value: 'insumo', label: 'Insumo' },
  { value: 'material', label: 'Material' },
]
const UNIDADES = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro']

export default function ComprasPage() {
  const { ctx, loading: ctxLoading } = useEmpresa()
  const [moduloOn, setModuloOn] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'proveedores' | 'articulos' | 'ordenes' | 'remitos' | 'facturas'>('proveedores')
  const [loading, setLoading] = useState(true)
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [productos, setProductos] = useState<ProductoVenta[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [ocs, setOcs] = useState<OC[]>([])
  const [ocItems, setOcItems] = useState<OCItem[]>([])
  const [remitos, setRemitos] = useState<Remito[]>([])
  const [remitoItems, setRemitoItems] = useState<RemitoItem[]>([])
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [cc, setCc] = useState<CcMov[]>([])
  const [saldos, setSaldos] = useState<{ proveedor_id: string; saldo: number }[]>([])
  const [ops, setOps] = useState<Op[]>([])
  const [opValores, setOpValores] = useState<OpValor[]>([])
  const [opImputaciones, setOpImputaciones] = useState<OpImp[]>([])
  const [chequesAll, setChequesAll] = useState<ChequeRow[]>([])
  const [cuentasBanco, setCuentasBanco] = useState<{ id: string; banco: string; alias: string | null }[]>([])
  const [chequeras, setChequeras] = useState<{ id: string; descripcion: string | null; proximo: number; hasta: number; estado: string }[]>([])
  const [modalPago, setModalPago] = useState(false)
  const [fichaPago, setFichaPago] = useState<string | null>(null)
  const [fPago, setFPago] = useState({ imput: {} as Record<string, string>, valores: [] as { tipo: 'efectivo' | 'transferencia' | 'cheque'; monto: string; cuenta_banco_id: string; chequera_id: string; modalidad: string; formato: string; fecha_cobro: string; fecha_emision: string }[], observaciones: '' })
  const [provAbierto, setProvAbierto] = useState<string | null>(null)
  const [opAbierta, setOpAbierta] = useState<string | null>(null)
  const [compRemitos, setCompRemitos] = useState<CompRemito[]>([])
  const [compItems, setCompItems] = useState<CompItem[]>([])
  const [modalFact, setModalFact] = useState(false)
  const [factAbierta, setFactAbierta] = useState<string | null>(null)
  const [fFact, setFFact] = useState({ tipo: 'factura' as 'factura' | 'nota_credito', recepcionar: false, proveedor_id: '', sucursal_id: '', letra: 'A', numero_proveedor: '', fecha: '', cae: '', fecha_vencimiento: '', iva: '', total: '', observaciones: '', remito_ids: [] as string[], renglones: [] as RenglonFact[] })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const avisar = (tipo: 'ok' | 'error', texto: string) => { setToast({ tipo, texto }); setTimeout(() => setToast(null), 5500) }

  // Modales
  const [modalProv, setModalProv] = useState(false)
  const [provEdit, setProvEdit] = useState<string | null>(null)
  const [fProv, setFProv] = useState({ nombre: '', razon_social: '', cuit: '', telefono: '', email: '', direccion: '', observaciones: '' })
  const [modalArt, setModalArt] = useState(false)
  const [artEdit, setArtEdit] = useState<string | null>(null)
  const [fArt, setFArt] = useState({ nombre: '', tipo: 'insumo', unidad_stock: 'unidad', controla_stock: true, producto_id: '' })
  const [modalRemito, setModalRemito] = useState(false)
  const [remitoAbierto, setRemitoAbierto] = useState<string | null>(null)   // id del remito en pantalla
  const [fRem, setFRem] = useState({ tipo: 'recepcion', proveedor_id: '', sucursal_id: '', orden_compra_id: '', numero_proveedor: '', observaciones: '' })
  const [remRenglones, setRemRenglones] = useState<{ articulo_id: string; presentacion_id: string; cantidad: string; costo_bulto: string }[]>([])
  const [lineaForm, setLineaForm] = useState<{ item_id: string | null; articulo_id: string; presentacion_id: string; cantidad: string; costo_bulto: string } | null>(null)
  const [modalOC, setModalOC] = useState(false)
  const [ocDetalle, setOcDetalle] = useState<OC | null>(null)
  const [fOC, setFOC] = useState<{ proveedor_id: string; sucursal_id: string; observaciones: string; renglones: RenglonForm[] }>({ proveedor_id: '', sucursal_id: '', observaciones: '', renglones: [] })
  const [modalImport, setModalImport] = useState(false)
  const [importSel, setImportSel] = useState<string[]>([])
  const [modalPres, setModalPres] = useState<{ articuloId: string; articuloNombre: string } | null>(null)
  const [presEdit, setPresEdit] = useState<string | null>(null)
  const [fPres, setFPres] = useState({ nombre: '', factor: '' })

  const api = useCallback(async (payload: Record<string, unknown>) => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sesión vencida — recargá la página')
    const res = await fetch('/api/compras', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => null)
    if (!res.ok) throw new Error(d?.error ?? 'Error')
    return d
  }, [])

  // Gate del módulo + carga inicial
  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    supabase.from('empresa_config').select('modulos').eq('empresa_id', ctx.empresaId).maybeSingle()
      .then(async ({ data }) => {
        const on = ((data?.modulos ?? {}) as Record<string, boolean>).compras === true
        setModuloOn(on)
        if (!on) { setLoading(false); return }
        try {
          const d = await api({ accion: 'listar' })
          setProveedores(d.proveedores ?? []); setArticulos(d.articulos ?? [])
          setPresentaciones(d.presentaciones ?? []); setProductos(d.productos ?? [])
          setSucursales(d.sucursales ?? []); setOcs(d.ocs ?? []); setOcItems(d.oc_items ?? [])
          setRemitos(d.remitos ?? []); setRemitoItems(d.remito_items ?? []); setComprobantes(d.comprobantes ?? []); setCompRemitos(d.comp_remitos ?? [])
      setCc(d.cc ?? []); setSaldos(d.saldos ?? []); setOps(d.ops ?? []); setOpValores(d.op_valores ?? []); setOpImputaciones(d.op_imputaciones ?? []); setChequesAll(d.cheques ?? []); setCuentasBanco(d.cuentas_banco ?? []); setChequeras(d.chequeras ?? []); setCompItems(d.comp_items ?? [])
          setCc(d.cc ?? []); setSaldos(d.saldos ?? []); setOps(d.ops ?? []); setOpValores(d.op_valores ?? []); setOpImputaciones(d.op_imputaciones ?? []); setChequesAll(d.cheques ?? []); setCuentasBanco(d.cuentas_banco ?? []); setChequeras(d.chequeras ?? [])
        } catch { /* la página muestra vacío; las acciones reintentarán */ }
        setLoading(false)
      })
  }, [ctx, api])

  async function recargar() {
    try {
      const d = await api({ accion: 'listar' })
      setProveedores(d.proveedores ?? []); setArticulos(d.articulos ?? [])
      setPresentaciones(d.presentaciones ?? []); setProductos(d.productos ?? [])
      setSucursales(d.sucursales ?? []); setOcs(d.ocs ?? []); setOcItems(d.oc_items ?? [])
      setRemitos(d.remitos ?? []); setRemitoItems(d.remito_items ?? []); setComprobantes(d.comprobantes ?? []); setCompRemitos(d.comp_remitos ?? [])
    } catch { /* siguiente acción reintenta */ }
  }

  // ── Acciones ──
  async function guardarProveedor() {
    if (!fProv.nombre.trim()) return
    setSaving(true)
    try {
      await api({ accion: 'proveedor_guardar', id: provEdit, ...fProv })
      setModalProv(false); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function toggleProveedor(p: Proveedor) {
    try { await api({ accion: 'proveedor_toggle', id: p.id, activo: !p.activo }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar') }
  }
  async function guardarArticulo() {
    if (!fArt.nombre.trim()) return
    setSaving(true)
    try {
      await api({ accion: 'articulo_guardar', id: artEdit, ...fArt, producto_id: fArt.producto_id || null })
      setModalArt(false); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function toggleArticulo(a: Articulo) {
    try { await api({ accion: 'articulo_toggle', id: a.id, activo: !a.activo }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar') }
  }
  async function crearOC() {
    setSaving(true)
    try {
      const d = await api({ accion: 'oc_crear', proveedor_id: fOC.proveedor_id, sucursal_id: fOC.sucursal_id || null,
        observaciones: fOC.observaciones, items: fOC.renglones.filter(rCompleto).map(r => ({
          articulo_id: r.articulo_id, presentacion_id: r.presentacion_id || null,
          cantidad: r.cantidad, costo_previsto: r.costo_previsto,
        })) })
      setModalOC(false); await recargar()
      alert(`Orden de compra OC-${String(d.numero).padStart(4, '0')} creada`)
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo crear') } finally { setSaving(false) }
  }
  async function anularOC(id: string) {
    if (!confirm('¿Anular esta orden de compra? No se puede volver a abrir.')) return
    try { await api({ accion: 'oc_anular', id }); setOcDetalle(null); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo anular') }
  }
  async function crearRemito() {
    // JC 02/10: UN ACTO. El confirm cuenta solo lo que mueve stock.
    const esDev = fRem.tipo === 'devolucion'
    const completos = remRenglones.filter(remRenglonCompleto)
    const unidades = completos.filter(r => controla(r.articulo_id)).reduce((a, r) => {
      const f = r.presentacion_id ? Number(presentaciones.find(x => x.id === r.presentacion_id)?.factor ?? 1) : 1
      return a + Number(r.cantidad) * f
    }, 0)
    const sinControl = completos.length - completos.filter(r => controla(r.articulo_id)).length
    const msj = unidades === 0
      ? '¿Confirmar? Este remito solo DOCUMENTA (sus artículos no controlan stock) — no mueve ninguna unidad. No se deshace.'
      : (esDev ? `¿Confirmar la DEVOLUCIÓN? Se restan ${fmtU(unidades)} unidades del stock.` : `¿Confirmar la recepción? Se suman ${fmtU(unidades)} unidades al stock.`)
        + (sinControl > 0 ? ` (${sinControl} línea${sinControl > 1 ? 's' : ''} sin control solo documenta)` : '') + ' Este paso no se deshace.'
    if (!confirm(msj)) return
    setSaving(true)
    try {
      const d = await api({ accion: 'remito_crear', confirmar: true, tipo: fRem.tipo, proveedor_id: fRem.proveedor_id, sucursal_id: fRem.sucursal_id,
        orden_compra_id: fRem.tipo === 'recepcion' ? (fRem.orden_compra_id || null) : null,
        numero_proveedor: fRem.numero_proveedor, observaciones: fRem.observaciones,
        items: completos.map(r => ({
          articulo_id: r.articulo_id, presentacion_id: r.presentacion_id || null,
          cantidad: r.cantidad, costo_bulto: r.costo_bulto || '0',
        })) })
      setModalRemito(false); setRemitoAbierto(null); await recargar()
      alert(`✅ REM-${String(d.numero).padStart(4, '0')} confirmado: ${d.lineas} líneas, ${fmtU(Number(d.unidades ?? 0))} unidades${d.oc_estado ? ` · OC → ${d.oc_estado}` : ''}`)
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo confirmar — nada quedó cargado') } finally { setSaving(false) }
  }
  async function guardarLinea() {
    if (!lineaForm || !remitoAbierto) return
    setSaving(true)
    try {
      await api({ accion: 'remito_item_guardar', remito_id: remitoAbierto, item_id: lineaForm.item_id,
        articulo_id: lineaForm.articulo_id, presentacion_id: lineaForm.presentacion_id || null,
        cantidad: lineaForm.cantidad, costo_bulto: lineaForm.costo_bulto || '0' })
      setLineaForm(null); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function borrarLinea(itemId: string) {
    if (!remitoAbierto) return
    try { await api({ accion: 'remito_item_borrar', remito_id: remitoAbierto, item_id: itemId }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo borrar') }
  }
  function msjConfirmar(id: string) {
    const lineas = itemsDe(id)
    const unidades = unidadesQueMueven(lineas)
    const sinControl = lineas.length - lineas.filter(l => controla(l.articulo_id)).length
    const esDev = remitos.find(x => x.id === id)?.tipo === 'devolucion'
    if (unidades === 0) return '¿Confirmar? Este remito solo DOCUMENTA (sus artículos no controlan stock) — no mueve ninguna unidad. No se deshace.'
    const base = esDev
      ? `¿Confirmar la DEVOLUCIÓN? Se restan ${fmtU(unidades)} unidades del stock.`
      : `¿Confirmar la recepción? Se suman ${fmtU(unidades)} unidades al stock.`
    return base + (sinControl > 0 ? ` (${sinControl} línea${sinControl > 1 ? 's' : ''} sin control de stock solo documenta)` : '') + ' Este paso no se deshace.'
  }
  async function confirmarRemito(id: string, silencioso = false) {
    if (!silencioso && !confirm(msjConfirmar(id))) return
    setSaving(true)
    try {
      const d = await api({ accion: 'remito_confirmar', id })
      await recargar()
      setRemitoAbierto(null)  // JC 02/10: confirmado -> de vuelta a la lista, se ven todos
      alert(`✅ Recepción confirmada: ${d.lineas} líneas, ${d.unidades} unidades al stock${d.oc_estado ? ` · OC → ${d.oc_estado}` : ''}`)
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo confirmar') } finally { setSaving(false) }
  }
  async function descartarRemito(id: string) {
    if (!confirm('¿Descartar este borrador? Se pierde lo cargado.')) return
    try { await api({ accion: 'remito_borrar', id }); setRemitoAbierto(null); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo descartar') }
  }
  async function importarCatalogo() {
    if (!importSel.length) return
    setSaving(true)
    try {
      const d = await api({ accion: 'importar_catalogo', producto_ids: importSel })
      setModalImport(false); setImportSel([]); await recargar()
      if (d.rechazados?.length) alert(`Importados: ${d.creados}. Ya tenían artículo (los importó otro usuario): ${d.rechazados.join(', ')}`)
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo importar') } finally { setSaving(false) }
  }
  async function guardarPresentacion() {
    if (!modalPres || !fPres.nombre.trim()) return
    setSaving(true)
    try {
      await api({ accion: 'presentacion_guardar', id: presEdit, articulo_id: modalPres.articuloId, nombre: fPres.nombre, factor: fPres.factor })
      setPresEdit(null); setFPres({ nombre: '', factor: '' }); await recargar()
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setSaving(false) }
  }
  async function borrarPresentacion(id: string) {
    try { await api({ accion: 'presentacion_borrar', id }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo borrar') }
  }
  async function togglePresentacion(pr: Presentacion) {
    try { await api({ accion: 'presentacion_toggle', id: pr.id, activo: !pr.activo }); await recargar() }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar') }
  }

  const nombreProducto = (id: string | null) => id ? (productos.find(p => p.id === id)?.nombre ?? '—') : null
  const nombreArticulo = (id: string) => articulos.find(a => a.id === id)?.nombre ?? '—'
  const nombrePresentacion = (id: string | null) => id ? (presentaciones.find(p => p.id === id)?.nombre ?? '—') : null
  const factorPresentacion = (id: string | null) => id ? (presentaciones.find(p => p.id === id)?.factor ?? 1) : 1
  const nombreProveedor = (id: string) => proveedores.find(p => p.id === id)?.nombre ?? '—'
  const nombreSucursal = (id: string | null) => id ? (sucursales.find(s => s.id === id)?.nombre ?? '—') : '🏢 Central'
  const ESTADOS_OC: Record<string, { label: string; cls: string }> = {
    abierta: { label: 'Abierta', cls: 'bg-blue-50 text-blue-600' },
    parcial: { label: 'Parcial', cls: 'bg-amber-50 text-amber-600' },
    recibida: { label: 'Recibida', cls: 'bg-green-50 text-green-600' },
    anulada: { label: 'Anulada', cls: 'bg-neutral-100 text-neutral-400' },
  }
  const ESTADOS_REMITO: Record<string, { label: string; cls: string }> = {
    borrador: { label: 'Borrador', cls: 'bg-amber-50 text-amber-600' },
    confirmado: { label: 'Confirmado', cls: 'bg-green-50 text-green-600' },
    anulado: { label: 'Anulado', cls: 'bg-neutral-100 text-neutral-400' },
  }
  const fmtU = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  function pendientesDeOC(ocId: string) {
    const idsConf = remitos.filter(r => r.orden_compra_id === ocId && r.estado === 'confirmado' && r.tipo === 'recepcion').map(r => r.id)
    const recibidos = remitoItems.filter(i => idsConf.includes(i.remito_id))
    return ocItems.filter(i => i.orden_compra_id === ocId).map(oi => {
      const rec = recibidos.filter(ri => ri.articulo_id === oi.articulo_id && (ri.presentacion_id ?? null) === (oi.presentacion_id ?? null))
        .reduce((a, ri) => a + Number(ri.cantidad), 0)
      const pend = Number(oi.cantidad) - rec
      const f = oi.presentacion_id ? Number(presentaciones.find(x => x.id === oi.presentacion_id)?.factor ?? 1) : 1
      return pend > 0 ? {
        articulo_id: oi.articulo_id, presentacion_id: oi.presentacion_id ?? '',
        cantidad: String(pend), costo_bulto: oi.costo_previsto != null ? String(Number(oi.costo_previsto)) : '',
      } : null
    }).filter((x): x is { articulo_id: string; presentacion_id: string; cantidad: string; costo_bulto: string } => x !== null)
  }
  const remRenglonVacio = (r: { articulo_id: string; presentacion_id: string; cantidad: string; costo_bulto: string }) => !r.articulo_id && !r.presentacion_id && !r.cantidad && !r.costo_bulto
  const remRenglonCompleto = (r: { articulo_id: string; presentacion_id: string; cantidad: string; costo_bulto: string }) => !!r.articulo_id && isFinite(Number(r.cantidad)) && Number(r.cantidad) > 0
  const remRenglonIncompleto = (r: { articulo_id: string; presentacion_id: string; cantidad: string; costo_bulto: string }) => !remRenglonVacio(r) && !remRenglonCompleto(r)
  const itemsDe = (remitoId: string) => remitoItems.filter(i => i.remito_id === remitoId)
  const remitosFacturables = (provId: string, tipoRem: string) => remitos.filter(r =>
    r.proveedor_id === provId && r.estado === 'confirmado' && r.tipo === tipoRem
    && !compRemitos.some(cr => cr.remito_id === r.id))
  const renglonesDeRemito = (remitoId: string): RenglonFact[] => itemsDe(remitoId).map(i => {
    const art = articulos.find(a => a.id === i.articulo_id)
    const pres = i.presentacion_id ? presentaciones.find(x => x.id === i.presentacion_id) : null
    return {
      descripcion: `${art?.nombre ?? 'Artículo'}${pres ? ` (${pres.nombre} x${Number(pres.factor)})` : ''}`,
      articulo_id: i.articulo_id, presentacion_id: i.presentacion_id ?? '',
      cantidad: String(Number(i.cantidad)), precio: String(Number(i.costo_unitario) * Number(i.factor_snap ?? 1)),
      origen_remito: remitoId, ingresa: false,
    }
  })
  const netoDe = (rg: RenglonFact[]) => rg.reduce((a, r) => a + (Number(r.cantidad) || 0) * (Number(r.precio) || 0), 0)
  const presDe = (articuloId: string) => presentaciones.filter(pr => pr.articulo_id === articuloId)
  const r2 = (n: number) => Math.round(n * 100) / 100
  // IVA: calculado al 21% — editable; total: neto+IVA — editable. '' = automático.
  const ivaCalc = () => r2(netoDe(fFact.renglones) * 0.21)
  const ivaEf = () => fFact.iva === '' ? ivaCalc() : (Number(fFact.iva) || 0)
  const totalEf = () => fFact.total === '' ? r2(netoDe(fFact.renglones) + ivaEf()) : (Number(fFact.total) || 0)
  const renglonFactCompleto = (r: RenglonFact) => r.descripcion.trim() !== '' && Number(r.cantidad) > 0 && Number(r.precio) >= 0
  const fmtMon = (n: number) => '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const ESTADOS_FACT: Record<string, { label: string; cls: string }> = {
    pendiente: { label: 'Pendiente', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
    parcial: { label: 'Pago parcial', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
    pagada: { label: 'Pagada', cls: 'bg-green-50 text-green-600 border-green-200' },
    anulada: { label: 'Anulada', cls: 'bg-neutral-100 text-neutral-400 border-neutral-200' },
  }
  async function crearFactura() {
    const esNC = fFact.tipo === 'nota_credito'
    const neto = netoDe(fFact.renglones)
    setSaving(true)
    try {
      await api({ accion: esNC ? 'nc_crear' : 'factura_crear', proveedor_id: fFact.proveedor_id, letra: fFact.letra || null,
        numero_proveedor: fFact.numero_proveedor, fecha: fFact.fecha || null,
        neto, iva: ivaEf(), total: totalEf(),
        recepcionar: !esNC && fFact.recepcionar,
        items: fFact.renglones.filter(renglonFactCompleto).map(r => ({
          descripcion: r.descripcion, cantidad: r.cantidad, precio_unitario: r.precio,
          articulo_id: r.articulo_id || null, presentacion_id: r.presentacion_id || null,
          ingresa: r.ingresa })),
        observaciones: fFact.observaciones, remito_ids: fFact.remito_ids,
        sucursal_id: fFact.sucursal_id || null, cae: fFact.cae || null,
        fecha_vencimiento: fFact.fecha_vencimiento || null })
      setModalFact(false); setFactAbierta(null); await recargar()
      avisar('ok', esNC ? 'NC registrada — el crédito ya vive en la cuenta corriente'
        : fFact.recepcionar ? 'Factura registrada — cargo en cuenta corriente y mercadería al stock' : 'Factura registrada — el cargo ya vive en la cuenta corriente')
    } catch (e) { avisar('error', e instanceof Error ? e.message : 'No se pudo registrar') } finally { setSaving(false) }
  }
  const imputadoDe = (comprobanteId: string) => opImputaciones
    .filter(i => i.comprobante_id === comprobanteId && !ops.find(o => o.id === i.orden_pago_id)?.anulada)
    .reduce((a, i) => a + Number(i.monto), 0)
  const pendienteDe = (c: Comprobante) => Math.round((Number(c.total) - imputadoDe(c.id)) * 100) / 100
  const sumaImput = () => Object.values(fPago.imput).reduce((a, v) => a + (Number(v) || 0), 0)
  const sumaValores = () => fPago.valores.reduce((a, v) => a + (Number(v.monto) || 0), 0)
  const aplicarImput = (n: Record<string, string>) => {
    const total = Object.values(n).reduce((a, v) => a + (Number(v) || 0), 0)
    const vs = fPago.valores.length === 1
      ? [{ ...fPago.valores[0], monto: total > 0 ? (Math.round(total * 100) / 100).toFixed(2) : '' }]
      : fPago.valores
    setFPago({ ...fPago, imput: n, valores: vs })
  }
  async function crearPago() {
    if (!provAbierto) return
    setSaving(true)
    try {
      await api({ accion: 'op_crear', proveedor_id: provAbierto, observaciones: fPago.observaciones || null,
        imputaciones: Object.entries(fPago.imput).filter(([, m]) => Number(m) > 0).map(([cid, m]) => ({ comprobante_id: cid, monto: Number(m) })),
        valores: fPago.valores.filter(v => Number(v.monto) > 0).map(v => ({ tipo: v.tipo, monto: Number(v.monto),
          cuenta_banco_id: v.tipo === 'transferencia' ? v.cuenta_banco_id || null : null,
          chequera_id: v.tipo === 'cheque' ? v.chequera_id || null : null,
          modalidad: v.tipo === 'cheque' ? v.modalidad || null : null,
          formato: v.tipo === 'cheque' ? v.formato || null : null,
          fecha_cobro: v.tipo === 'cheque' && v.fecha_cobro ? v.fecha_cobro : null,
          fecha_emision: v.tipo === 'cheque' && v.fecha_emision ? v.fecha_emision : null })) })
      setModalPago(false); await recargar()
      avisar('ok', 'Orden de pago registrada — la cuenta corriente ya la refleja')
    } catch (e) { avisar('error', e instanceof Error ? e.message : 'No se pudo registrar el pago') } finally { setSaving(false) }
  }
  const saldoDe = (proveedorId: string) => Number(saldos.find(sa => sa.proveedor_id === proveedorId)?.saldo ?? 0)
  const controla = (articuloId: string) => articulos.find(a => a.id === articuloId)?.controla_stock !== false
  const unidadesQueMueven = (lineas: { articulo_id: string; cantidad_operativa: number }[]) =>
    lineas.filter(l => controla(l.articulo_id)).reduce((a, l) => a + Number(l.cantidad_operativa), 0)
  const totalRemito = (remitoId: string) => itemsDe(remitoId).reduce((a, i) => a + Number(i.cantidad_operativa) * Number(i.costo_unitario), 0)
  // Validación VIVA del modal OC (JC 30/09): el cartel no espera al Guardar.
  // Vacío total = se ignora; a medias = incompleto (marca roja al instante).
  const rVacio = (r: RenglonForm) => !r.articulo_id && !r.presentacion_id && !r.cantidad && !r.costo_previsto
  const rCompleto = (r: RenglonForm) => !!r.articulo_id && isFinite(Number(r.cantidad)) && Number(r.cantidad) > 0
  const rIncompleto = (r: RenglonForm) => !rVacio(r) && !rCompleto(r)
  const ocLista = fOC.renglones.some(rCompleto) && !fOC.renglones.some(rIncompleto) && !!fOC.proveedor_id
  const totalPrevisto = (ocId: string) => ocItems.filter(i => i.orden_compra_id === ocId)
    .reduce((a, i) => a + (i.costo_previsto ?? 0) * Number(i.cantidad), 0)
  // Importador: SOLO productos sin artículo vinculado (regla 1 del CTO)
  const productosLibres = productos.filter(p => !articulos.some(a => a.producto_id === p.id))
  // El selector excluye productos ya vinculados a OTRO artículo (sello 1↔1)
  const productosDisponibles = productos.filter(p =>
    !articulos.some(a => a.producto_id === p.id && a.id !== artEdit))

  if (ctxLoading || loading) return (
    <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>
  )

  if (moduloOn === false) return (
    <div className="max-w-lg mx-auto text-center py-20">
      <Package className="h-10 w-10 text-neutral-200 mx-auto mb-4" />
      <h2 className="font-black text-neutral-800 text-lg mb-1">Compras no disponible</h2>
      <p className="text-neutral-400 text-sm">Este módulo no está activo para tu empresa.</p>
    </div>
  )

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Compras</h1>
          <p className="text-sm text-neutral-400">Proveedores y artículos de compra</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'remitos' && (
            <ConeButton onClick={() => { setFRem({ tipo: 'recepcion', proveedor_id: '', sucursal_id: '', orden_compra_id: '', numero_proveedor: '', observaciones: '' }); setRemRenglones([{ articulo_id: '', presentacion_id: '', cantidad: '', costo_bulto: '' }]); setRemitoAbierto(null); setModalRemito(true) }} icon={<Plus className="h-4 w-4" />}>
              Nuevo remito
            </ConeButton>
          )}
          {tab === 'facturas' && (
            <ConeButton onClick={() => { setFFact({ tipo: 'factura', recepcionar: false, proveedor_id: '', sucursal_id: '', letra: 'A', numero_proveedor: '', fecha: '', cae: '', fecha_vencimiento: '', iva: '', total: '', observaciones: '', remito_ids: [], renglones: [] }); setFactAbierta(null); setModalFact(true) }} icon={<Plus className="h-4 w-4" />}>
              Nueva factura
            </ConeButton>
          )}
          {tab === 'ordenes' && (
            <ConeButton onClick={() => { setFOC({ proveedor_id: '', sucursal_id: '', observaciones: '', renglones: [{ articulo_id: '', presentacion_id: '', cantidad: '', costo_previsto: '' }] }); setModalOC(true) }} icon={<Plus className="h-4 w-4" />}>
              Nueva orden
            </ConeButton>
          )}
          {tab === 'articulos' && (
            <button onClick={() => { setImportSel([]); setModalImport(true) }}
              className="px-4 py-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 text-sm font-bold hover:border-neutral-400 transition-colors flex items-center gap-2">
              <Download className="h-4 w-4" /> Importar del catálogo
            </button>
          )}
          {(tab === 'proveedores' || tab === 'articulos') && (
            <ConeButton onClick={() => {
              if (tab === 'proveedores') { setFProv({ nombre: '', razon_social: '', cuit: '', telefono: '', email: '', direccion: '', observaciones: '' }); setProvEdit(null); setModalProv(true) }
              else { setFArt({ nombre: '', tipo: 'insumo', unidad_stock: 'unidad', controla_stock: true, producto_id: '' }); setArtEdit(null); setModalArt(true) }
            }} icon={<Plus className="h-4 w-4" />}>
              {tab === 'proveedores' ? 'Nuevo proveedor' : 'Nuevo artículo'}
            </ConeButton>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-neutral-100 rounded-xl p-1 w-fit">
        <button onClick={() => setTab('proveedores')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'proveedores' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Truck className="h-4 w-4" /> Proveedores
        </button>
        <button onClick={() => setTab('articulos')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'articulos' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Boxes className="h-4 w-4" /> Artículos
        </button>
        <button onClick={() => setTab('ordenes')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'ordenes' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Package className="h-4 w-4" /> Órdenes
        </button>
        <button onClick={() => setTab('remitos')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'remitos' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <Truck className="h-4 w-4" /> Remitos
        </button>
        <button onClick={() => setTab('facturas')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${tab === 'facturas' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-400'}`}>
          <FileText className="h-4 w-4" /> Facturas
        </button>
      </div>

      {/* ── PROVEEDORES ── */}
      {tab === 'proveedores' && !provAbierto && (
        <div className="space-y-2">
          {proveedores.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin proveedores. Cargá el primero con el botón de arriba.</div>}
          {proveedores.map(p => (
            <div key={p.id} className={`bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm ${!p.activo ? 'opacity-55 grayscale' : ''}`}>
              <div className="min-w-0 cursor-pointer flex-1" onClick={() => setProvAbierto(p.id)}>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-900 truncate">{p.nombre}</span>
                  {p.cuit && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-600">CUIT {p.cuit}</span>}
                  {saldoDe(p.id) !== 0 && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${saldoDe(p.id) > 0 ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-violet-50 text-violet-600 border border-violet-200'}`}>
                      {saldoDe(p.id) > 0 ? `Debemos ${fmtMon(saldoDe(p.id))}` : `A favor ${fmtMon(-saldoDe(p.id))}`}
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-400 mt-0.5 truncate">
                  {[p.razon_social, p.telefono, p.email, p.direccion].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => toggleProveedor(p)} title={p.activo ? 'Desactivar (baja lógica — el historial queda)' : 'Activar'}
                  className={`relative w-11 h-6 rounded-full transition-colors ${p.activo ? 'bg-green-500' : 'bg-neutral-200'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${p.activo ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <button onClick={() => { setFProv({ nombre: p.nombre, razon_social: p.razon_social ?? '', cuit: p.cuit ?? '', telefono: p.telefono ?? '', email: p.email ?? '', direccion: p.direccion ?? '', observaciones: p.observaciones ?? '' }); setProvEdit(p.id); setModalProv(true) }}
                  className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ARTÍCULOS ── */}
      {tab === 'articulos' && (
        <div className="space-y-2">
          {articulos.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin artículos. Cargá el primero con el botón de arriba.</div>}
          {articulos.map(a => {
            const pres = presentaciones.filter(pr => pr.articulo_id === a.id)
            const vinculo = nombreProducto(a.producto_id)
            return (
              <div key={a.id} className={`bg-white rounded-2xl border border-neutral-100 px-5 py-4 shadow-sm ${!a.activo ? 'opacity-55 grayscale' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-neutral-900">{a.nombre}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-600">{TIPOS.find(t => t.value === a.tipo)?.label ?? a.tipo}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-neutral-100 text-neutral-600">{a.unidad_stock}</span>
                      {!a.controla_stock && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-600">Sin control de stock</span>}
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {vinculo ? <>Ficha del producto de venta: <span className="font-semibold text-neutral-500">{vinculo}</span></> : 'Sin vínculo a producto de venta'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => toggleArticulo(a)} title={a.activo ? 'Desactivar (baja lógica — el historial queda)' : 'Activar'}
                      className={`relative w-11 h-6 rounded-full transition-colors ${a.activo ? 'bg-green-500' : 'bg-neutral-200'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${a.activo ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                    <button onClick={() => { setFArt({ nombre: a.nombre, tipo: a.tipo, unidad_stock: a.unidad_stock, controla_stock: a.controla_stock, producto_id: a.producto_id ?? '' }); setArtEdit(a.id); setModalArt(true) }}
                      className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-xl transition-colors"><Pencil className="h-4 w-4" /></button>
                  </div>
                </div>
                {/* Presentaciones de COMPRA (vocabulario de la casa: jamás "presentación" a secas) */}
                <div className="mt-3 pt-3 border-t border-neutral-50 flex items-center gap-2 flex-wrap">
                  {pres.map(pr => (
                    <button key={pr.id}
                      onClick={() => { setModalPres({ articuloId: a.id, articuloNombre: a.nombre }); setPresEdit(pr.id); setFPres({ nombre: pr.nombre, factor: String(pr.factor) }) }}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition-colors ${pr.activo ? 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:border-neutral-400' : 'bg-white border-neutral-100 text-neutral-300 line-through'}`}
                      title="Editar presentación de compra">
                      {pr.nombre} × {pr.factor}
                    </button>
                  ))}
                  <button onClick={() => { setModalPres({ articuloId: a.id, articuloNombre: a.nombre }); setPresEdit(null); setFPres({ nombre: '', factor: '' }) }}
                    className="text-xs px-2.5 py-1 rounded-full font-semibold border border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors">
                    + Presentación de compra
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── REMITOS (T4-A): el BORRADOR es documento editable — CERO
          stock. ingresar_remito_stock (T4-B) será el único escritor. ── */}
      {tab === 'facturas' && !factAbierta && (
        <div className="space-y-2">
          {comprobantes.length === 0 && (
            <div className="bg-white rounded-2xl border border-neutral-100 p-8 text-center text-sm text-neutral-400">
              Todavía no hay facturas de compra. El papel del proveedor entra por acá y nace el cargo en su cuenta corriente.
            </div>
          )}
          {comprobantes.map(c => {
            const ef = ESTADOS_FACT[c.estado] ?? ESTADOS_FACT.pendiente
            return (
              <button key={c.id} onClick={() => setFactAbierta(c.id)}
                className="w-full text-left bg-white rounded-2xl border border-neutral-100 px-4 py-3 hover:border-neutral-300 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-black text-neutral-900">{c.tipo === 'nota_credito' ? <span className="text-violet-600">NC</span> : 'FC'} {c.letra ?? ''} {c.numero_proveedor}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ef.cls}`}>{ef.label}</span>
                  </div>
                  <span className="font-black text-neutral-900 whitespace-nowrap">{fmtMon(Number(c.total))}</span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {proveedores.find(p => p.id === c.proveedor_id)?.nombre ?? '—'} · {c.fecha}
                  {compRemitos.filter(cr => cr.comprobante_id === c.id).length > 0 && ` · 🚚 ${compRemitos.filter(cr => cr.comprobante_id === c.id).length} remito(s)`}
                </p>
              </button>
            )
          })}
        </div>
      )}

      {tab === 'facturas' && factAbierta && (() => {
        const c = comprobantes.find(x => x.id === factAbierta)
        if (!c) return null
        const ef = ESTADOS_FACT[c.estado] ?? ESTADOS_FACT.pendiente
        const rems = compRemitos.filter(cr => cr.comprobante_id === c.id)
          .map(cr => remitos.find(r => r.id === cr.remito_id)).filter((r): r is Remito => !!r)
        return (
          <div className="bg-white rounded-2xl border border-neutral-100 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setFactAbierta(null)} className="text-neutral-300 hover:text-neutral-600 font-black">←</button>
                <h2 className="font-black text-neutral-900">{c.tipo === 'nota_credito' ? 'NC' : 'Factura'} {c.letra ?? ''} {c.numero_proveedor}</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ef.cls}`}>{ef.label}</span>
              </div>
              <span className="font-black text-lg text-neutral-900">{fmtMon(Number(c.total))}</span>
            </div>
            <p className="text-xs text-neutral-400">{proveedores.find(p => p.id === c.proveedor_id)?.nombre ?? '—'} · {c.fecha}{c.observaciones ? ` · ${c.observaciones}` : ''}</p>
            {compItems.filter(i => i.comprobante_id === c.id).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-neutral-400 uppercase">Renglones del papel</p>
                {compItems.filter(i => i.comprobante_id === c.id).map(i => (
                  <div key={i.id} className="bg-neutral-50 rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-3">
                    <span className="text-neutral-700 min-w-0 truncate">{i.descripcion}</span>
                    <span className="text-xs text-neutral-400 whitespace-nowrap">{Number(i.cantidad).toLocaleString('es-AR')} × {fmtMon(Number(i.precio_unitario))} = <b className="text-neutral-600">{fmtMon(Number(i.cantidad) * Number(i.precio_unitario))}</b></span>
                  </div>
                ))}
              </div>
            )}
            {(c as Comprobante & { neto?: number | null; iva?: number | null }).neto != null && (
              <p className="text-xs text-neutral-500 text-right px-1">Neto {fmtMon(Number((c as Comprobante & { neto?: number | null }).neto))} + IVA {fmtMon(Number((c as Comprobante & { iva?: number | null }).iva ?? 0))} = <b>{fmtMon(Number(c.total))}</b></p>
            )}
            {rems.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-neutral-400 uppercase">Remitos que respaldan este comprobante</p>
                {rems.map(r => (
                  <div key={r.id} className="bg-neutral-50 rounded-xl px-3 py-2 text-sm flex items-center justify-between">
                    <span className="font-bold text-neutral-700">REM-{String(r.numero).padStart(4, '0')}</span>
                    <span className="text-xs text-neutral-400">{r.fecha} · {fmtMon(totalRemito(r.id))}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-xl px-3 py-2">
              🔒 El comprobante no se edita: su cargo vive en la cuenta corriente. Diferencias = Nota de Crédito (próxima tanda).
            </p>
          </div>
        )
      })()}

      {tab === 'remitos' && !remitoAbierto && (
        <div className="space-y-2">
          {remitos.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin remitos. Registrá la primera recepción con el botón de arriba.</div>}
          {remitos.map(r => {
            const est = ESTADOS_REMITO[r.estado] ?? { label: r.estado, cls: 'bg-neutral-100 text-neutral-500' }
            const tot = totalRemito(r.id)
            const oc = r.orden_compra_id ? ocs.find(o => o.id === r.orden_compra_id) : null
            return (
              <button key={r.id} onClick={() => setRemitoAbierto(r.id)}
                className={`w-full text-left bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm hover:border-neutral-300 transition-colors ${r.estado === 'anulado' ? 'opacity-55' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-neutral-900">REM-{String(r.numero).padStart(4, '0')}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${est.cls}`}>{est.label}</span>
                    {r.tipo === 'devolucion' && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-500">↩ Devolución</span>}
                    {oc && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-500">OC-{String(oc.numero).padStart(4, '0')}</span>}
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5 truncate">
                    {nombreProveedor(r.proveedor_id)} · 📍 {nombreSucursal(r.sucursal_id)} · {r.fecha}{r.numero_proveedor ? ` · Nº prov. ${r.numero_proveedor}` : ''}
                  </p>
                </div>
                <span className="font-bold text-neutral-700 text-sm flex-shrink-0">{tot > 0 ? `$${tot.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '—'}</span>
              </button>
            )
          })}
        </div>
      )}

      {tab === 'remitos' && remitoAbierto && (() => {
        const r = remitos.find(x => x.id === remitoAbierto)
        if (!r) return null
        const esBorrador = r.estado === 'borrador'
        const lineas = itemsDe(r.id)
        const est = ESTADOS_REMITO[r.estado] ?? { label: r.estado, cls: '' }
        return (
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setRemitoAbierto(null)} className="text-neutral-300 hover:text-neutral-600 font-bold">←</button>
                  <h2 className="font-black text-lg text-neutral-900">REM-{String(r.numero).padStart(4, '0')}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${est.cls}`}>{est.label}</span>
                  {r.tipo === 'devolucion' && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-500">↩ Devolución</span>}
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {nombreProveedor(r.proveedor_id)} · 📍 {nombreSucursal(r.sucursal_id)} · {r.fecha}{r.numero_proveedor ? ` · Nº prov. ${r.numero_proveedor}` : ''}
                </p>
              </div>
              {/* JC 02/10: el borrador voló de la UI — la ficha es de lectura */}
            </div>

            <div className="space-y-1.5">
              {lineas.length === 0 && <p className="text-sm text-neutral-400 text-center py-4">Sin líneas. Agregá lo que llegó en el camión.</p>}
              {lineas.map(li => (
                <div key={li.id} className="flex items-center justify-between bg-neutral-50 rounded-xl px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-800 truncate">{nombreArticulo(li.articulo_id)}</p>
                    <p className="text-xs text-neutral-400">
                      {fmtU(Number(li.cantidad))} × {nombrePresentacion(li.presentacion_id) ?? 'unidad suelta'} = <span className="font-bold text-neutral-600">{fmtU(Number(li.cantidad_operativa))} u.</span>
                      {Number(li.costo_unitario) > 0 ? ` · $${Number(li.costo_unitario).toLocaleString('es-AR', { maximumFractionDigits: 2 })}/u.` : ''}
                      {li.cantidad_pedida != null ? ` · pedido: ${Number(li.cantidad_pedida)}` : ''}
                    </p>
                  </div>

                </div>
              ))}
            </div>



            {false && lineaForm && (() => {
              const presDeArt = presentaciones.filter(pr => pr.articulo_id === lineaForm.articulo_id && pr.activo)
              const f = lineaForm.presentacion_id ? Number(presentaciones.find(x => x.id === lineaForm.presentacion_id)?.factor ?? 1) : 1
              const q = Number(lineaForm.cantidad)
              const cb = Number(lineaForm.costo_bulto)
              return (
                <div className="bg-neutral-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select value={lineaForm.articulo_id}
                      onChange={e => setLineaForm({ ...lineaForm, articulo_id: e.target.value, presentacion_id: '' })}
                      className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Artículo...</option>
                      {articulos.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                    <button onClick={() => setLineaForm(null)} className="text-neutral-300 hover:text-neutral-500 font-bold px-2">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select value={lineaForm.presentacion_id}
                      onChange={e => setLineaForm({ ...lineaForm, presentacion_id: e.target.value })}
                      className="px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Unidad suelta</option>
                      {presDeArt.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre} ×{pr.factor}</option>)}
                    </select>
                    <Input value={lineaForm.cantidad} placeholder="Bultos"
                      onChange={e => setLineaForm({ ...lineaForm, cantidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} inputMode="decimal" />
                    <Input value={lineaForm.costo_bulto} placeholder="$ por bulto"
                      onChange={e => setLineaForm({ ...lineaForm, costo_bulto: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} inputMode="decimal" />
                  </div>
                  {lineaForm.articulo_id && q > 0 && (
                    <p className="text-[11px] text-neutral-400">
                      = <span className="font-bold">{fmtU(q * f)} unidades</span>{isFinite(cb) && cb > 0 ? ` · $${(cb / f).toLocaleString('es-AR', { maximumFractionDigits: 2 })} por unidad` : ''} — el factor se congela recién al confirmar
                    </p>
                  )}
                  <div className="flex justify-end">
                    <ConeButton onClick={guardarLinea} loading={saving} disabled={!lineaForm.articulo_id || !(q > 0)}>
                      {lineaForm.item_id ? 'Guardar línea' : 'Agregar'}
                    </ConeButton>
                  </div>
                </div>
              )
            })()}

            {totalRemito(r.id) > 0 && (
              <div className="flex justify-between font-black text-neutral-900 px-1">
                <span>Total</span><span>${totalRemito(r.id).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
            )}
            {r.tipo === 'confirmado_nunca' && null}
            {r.estado === 'confirmado' && (
              <p className="text-[11px] text-green-600 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                ✅ Recepción confirmada{r.confirmado_at ? ` el ${new Date(r.confirmado_at).toLocaleString('es-AR')}` : ''} — stock impactado, snapshots congelados. Este documento ya no se edita.
              </p>
            )}
          </div>
        )
      })()}

      {/* ── Modal nuevo remito ── */}
      {tab === 'proveedores' && provAbierto && (() => {
        const p = proveedores.find(x => x.id === provAbierto)
        if (!p) return null
        const movs = cc.filter(m => m.proveedor_id === p.id)
        const saldo = saldoDe(p.id)
        return (
          <div className="bg-white rounded-2xl border border-neutral-100 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setProvAbierto(null)} className="text-neutral-300 hover:text-neutral-600 font-black">←</button>
                <h2 className="font-black text-neutral-900">{p.nombre}</h2>
                {p.cuit && <span className="text-xs text-neutral-400">CUIT {p.cuit}</span>}
              </div>
              <div className="flex items-center gap-3">
              <ConeButton onClick={() => { setFPago({ imput: {}, valores: [{ tipo: 'efectivo', monto: '', cuenta_banco_id: '', chequera_id: '', modalidad: '', formato: '', fecha_cobro: '', fecha_emision: new Date().toISOString().slice(0, 10) }], observaciones: '' }); setModalPago(true) }}>💸 Pagar</ConeButton>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase text-neutral-400">Saldo</p>
                <p className={`font-black text-xl ${saldo > 0 ? 'text-amber-600' : saldo < 0 ? 'text-violet-600' : 'text-green-600'}`}>
                  {saldo === 0 ? 'Al día' : saldo > 0 ? `Le debemos ${fmtMon(saldo)}` : `A nuestro favor ${fmtMon(-saldo)}`}
                </p>
              </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-neutral-400 uppercase">Cuenta corriente — cada línea lleva a su documento</p>
              {movs.length === 0 && <p className="text-sm text-neutral-400 py-6 text-center">Sin movimientos todavía.</p>}
              {movs.map(m => {
                const esCargo = m.tipo === 'debe'
                const doc = m.comprobante_id ? comprobantes.find(c => c.id === m.comprobante_id) : null
                const op = m.orden_pago_id ? ops.find(o => o.id === m.orden_pago_id) : null
                return (
                  <button key={m.id} className="w-full bg-neutral-50 hover:bg-neutral-100 transition-colors rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-3 text-left"
                    onClick={() => { if (doc) { setTab('facturas'); setFactAbierta(doc.id) } else if (op) setOpAbierta(op.id) }}>
                    <span className="min-w-0 truncate text-neutral-700">
                      <span className="text-xs text-neutral-400 mr-2">{new Date(m.created_at).toLocaleDateString('es-AR')}</span>
                      {m.detalle ?? (doc ? `${doc.tipo === 'nota_credito' ? 'NC' : 'Factura'} ${doc.numero_proveedor}` : op ? `OP-${String(op.numero).padStart(4, '0')}` : '—')}
                      {op?.anulada && <span className="ml-2 text-[10px] font-bold text-red-400">ANULADA</span>}
                    </span>
                    <span className={`font-bold whitespace-nowrap ${esCargo ? 'text-neutral-900' : 'text-green-600'}`}>
                      {esCargo ? '+' : '−'}{fmtMon(Number(m.monto))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {modalPago && provAbierto && (() => {
        const pend = comprobantes.filter(c => c.proveedor_id === provAbierto && c.tipo === 'factura' && c.estado !== 'anulada' && pendienteDe(c) > 0)
        const aCuenta = Math.round((sumaValores() - sumaImput()) * 100) / 100
        return (
          <ConeModal open onClose={() => setModalPago(false)} title="Pagar a proveedor" size="lg">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Qué paga — facturas con deuda (vacío = pago a cuenta)</Label>
                {pend.length === 0 && <p className="text-sm text-neutral-400 bg-neutral-50 rounded-xl px-3 py-2">Sin facturas pendientes — lo que cargues queda a cuenta.</p>}
                {pend.map(c => {
                  const marcada = fPago.imput[c.id] !== undefined
                  return (
                    <div key={c.id} className="bg-neutral-50 rounded-xl px-3 py-2 flex items-center gap-3 cursor-pointer" title="Doble click: ver el comprobante"
                      onDoubleClick={() => setFichaPago(c.id)}>
                      <input type="checkbox" checked={marcada}
                        onChange={e => { const n = { ...fPago.imput }; if (e.target.checked) n[c.id] = pendienteDe(c).toFixed(2); else delete n[c.id]; aplicarImput(n) }} />
                      <span className="flex-1 text-sm text-neutral-700">Factura {c.letra ?? ''} {c.numero_proveedor} <span className="text-xs text-neutral-400">· debe {fmtMon(pendienteDe(c))}</span></span>
                      {marcada && (
                        <input type="number" min="0" step="0.01" value={fPago.imput[c.id]} placeholder={pendienteDe(c).toFixed(2)}
                          onChange={e => aplicarImput({ ...fPago.imput, [c.id]: e.target.value })}
                          className="w-32 rounded-lg border border-neutral-200 px-2 py-1 text-sm text-right" />
                      )}
                      {marcada && Number(fPago.imput[c.id]) > pendienteDe(c) && <span className="text-[10px] font-bold text-red-500">⛔ supera lo que debe</span>}
                    </div>
                  )
                })}
              </div>
              <div className="space-y-1.5">
                <Label>Con qué se paga</Label>
                {fPago.valores.map((v, idx) => (
                  <div key={idx} className="bg-neutral-50 rounded-xl px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={v.tipo} onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, tipo: e.target.value as typeof v.tipo } : x) })}
                        className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm bg-white">
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                        <option value="cheque">Cheque</option>
                      </select>
                      {v.tipo === 'transferencia' && (
                        <select value={v.cuenta_banco_id} onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, cuenta_banco_id: e.target.value } : x) })}
                          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm bg-white">
                          <option value="">Cuenta…</option>
                          {cuentasBanco.map(cb => <option key={cb.id} value={cb.id}>{cb.banco}{cb.alias ? ` · ${cb.alias}` : ""}</option>)}
                        </select>
                      )}
                      {v.tipo === 'cheque' && (
                        <select value={v.chequera_id} onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, chequera_id: e.target.value } : x) })}
                          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm bg-white">
                          <option value="">Chequera…</option>
                          {chequeras.filter(ch => ch.estado === 'activa').map(ch => <option key={ch.id} value={ch.id}>{ch.descripcion ?? 'Chequera'} · próximo N° {ch.proximo}</option>)}
                        </select>
                      )}
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={v.monto}
                        onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, monto: e.target.value } : x) })}
                        className="w-32 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm text-right" />
                      <button onClick={() => setFPago({ ...fPago, valores: fPago.valores.filter((_, i2) => i2 !== idx) })} className="text-neutral-300 hover:text-red-500 font-bold">✕</button>
                    </div>
                    {v.tipo === 'cheque' && (
                      <div className="flex items-center gap-2">
                        <select value={v.modalidad} onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, modalidad: e.target.value } : x) })}
                          className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs bg-white">
                          <option value="">Modalidad…</option>
                          <option value="al_dia">Al día</option>
                          <option value="diferido">Diferido</option>
                        </select>
                        <select value={v.formato} onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, formato: e.target.value } : x) })}
                          className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs bg-white">
                          <option value="">Formato…</option>
                          <option value="fisico">Físico</option>
                          <option value="echeq">ECHEQ</option>
                        </select>
                        <div className="flex items-center gap-1"><span className="text-[10px] font-bold text-neutral-400 uppercase">Emisión</span>
                        <input type="date" value={v.fecha_emision} onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, fecha_emision: e.target.value } : x) })}
                          className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs bg-white" title="Vacío = hoy" /></div>
                        <div className="flex items-center gap-1"><span className="text-[10px] font-bold text-neutral-400 uppercase">Cobro</span>
                        <input type="date" value={v.fecha_cobro} onChange={e => setFPago({ ...fPago, valores: fPago.valores.map((x, i2) => i2 === idx ? { ...x, fecha_cobro: e.target.value } : x) })}
                          className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs bg-white" /></div>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={() => { const resto = Math.max(0, Math.round((sumaImput() - sumaValores()) * 100) / 100); setFPago({ ...fPago, valores: [...fPago.valores, { tipo: 'efectivo', monto: resto > 0 ? resto.toFixed(2) : '', cuenta_banco_id: '', chequera_id: '', modalidad: '', formato: '', fecha_cobro: '', fecha_emision: new Date().toISOString().slice(0, 10) }] }) }}
                  className="text-xs font-bold text-neutral-400 border border-neutral-200 rounded-xl px-3 py-1.5 hover:bg-neutral-50">+ Agregar valor</button>
              </div>
              <div className="ml-auto w-80 space-y-1 text-sm">
                <div className="flex justify-between text-neutral-500"><span>Imputado a facturas</span><span className="font-bold text-neutral-700">{fmtMon(sumaImput())}</span></div>
                <div className="flex justify-between border-t border-neutral-200 pt-1.5"><span className="font-black text-neutral-900">TOTAL valores</span><span className="font-black">{fmtMon(sumaValores())}</span></div>
                {aCuenta > 0.009 && <p className="text-[11px] text-amber-600 font-semibold text-right">El excedente de {fmtMon(aCuenta)} queda a cuenta del proveedor</p>}
                {sumaImput() - sumaValores() > 0.009 && <p className="text-[11px] font-bold text-amber-600 text-right">Falta cubrir {fmtMon(Math.round((sumaImput() - sumaValores()) * 100) / 100)} con valores</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Observaciones</Label>
                <input value={fPago.observaciones} onChange={e => setFPago({ ...fPago, observaciones: e.target.value })}
                  placeholder="Opcional" className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <ConeButton variante="fantasma" onClick={() => setModalPago(false)}>Cancelar</ConeButton>
              <ConeButton onClick={crearPago} loading={saving}
                disabled={!(sumaValores() > 0) || sumaImput() - sumaValores() > 0.009 || Object.entries(fPago.imput).some(([cid, m]) => Number(m) > pendienteDe(comprobantes.find(c => c.id === cid)!))}>
                💸 Registrar pago
              </ConeButton>
            </div>
          </ConeModal>
        )
      })()}
      {fichaPago && (() => {
        const c = comprobantes.find(x => x.id === fichaPago)
        if (!c) return null
        const items = compItems.filter(i => i.comprobante_id === c.id)
        const cN = c as Comprobante & { neto?: number | null; iva?: number | null }
        return (
          <ConeModal open onClose={() => setFichaPago(null)} title={`${c.tipo === 'nota_credito' ? 'NC' : 'Factura'} ${c.letra ?? ''} ${c.numero_proveedor}`}>
            <div className="space-y-2">
              <p className="text-xs text-neutral-400">{c.fecha} · {fmtMon(Number(c.total))} · {c.estado}</p>
              {items.map(i => (
                <div key={i.id} className="bg-neutral-50 rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-3">
                  <span className="text-neutral-700 min-w-0 truncate">{i.descripcion}</span>
                  <span className="text-xs text-neutral-500 whitespace-nowrap">{Number(i.cantidad)} × {fmtMon(Number(i.precio_unitario))} = <b className="text-neutral-800">{fmtMon(Number(i.cantidad) * Number(i.precio_unitario))}</b></span>
                </div>
              ))}
              {cN.neto != null && (
                <p className="text-xs text-neutral-500 text-right px-1">Neto {fmtMon(Number(cN.neto))} + IVA {fmtMon(Number(cN.iva ?? 0))} = <b>{fmtMon(Number(c.total))}</b></p>
              )}
              <div className="flex justify-end pt-2"><ConeButton variante="fantasma" onClick={() => setFichaPago(null)}>Volver al pago</ConeButton></div>
            </div>
          </ConeModal>
        )
      })()}
      {opAbierta && (() => {
        const op = ops.find(o => o.id === opAbierta)
        if (!op) return null
        const vals = opValores.filter(v => v.orden_pago_id === op.id)
        const imps = opImputaciones.filter(i => i.orden_pago_id === op.id)
        const etiquetaValor = (v: OpValor) => {
          if (v.tipo === 'efectivo') return 'Efectivo'
          if (v.tipo === 'transferencia') return `Transferencia · ${(() => { const cb = cuentasBanco.find(x => x.id === v.cuenta_banco_id); return cb ? cb.banco + (cb.alias ? ' · ' + cb.alias : '') : 'cuenta' })()}`
          const ch = chequesAll.find(c => c.id === v.cheque_id)
          return `Cheque ${ch?.numero != null ? `N° ${ch.numero}` : ''}${ch?.formato ? ` · ${ch.formato}` : ''}${ch?.estado ? ` · ${ch.estado}` : ''}`
        }
        return (
          <ConeModal open onClose={() => setOpAbierta(null)} title={`Orden de pago OP-${String(op.numero).padStart(4, '0')}`}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-400">{op.fecha}{op.observaciones ? ` · ${op.observaciones}` : ''}
                  {op.anulada && <span className="ml-2 text-[10px] font-bold text-red-500 border border-red-200 bg-red-50 rounded-full px-2 py-0.5">ANULADA</span>}</p>
                <span className="font-black text-lg text-neutral-900">{fmtMon(Number(op.total))}</span>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-neutral-400 uppercase">Con qué se pagó</p>
                {vals.map(v => (
                  <div key={v.id} className="bg-neutral-50 rounded-xl px-3 py-2 text-sm flex items-center justify-between">
                    <span className="text-neutral-700">{etiquetaValor(v)}</span>
                    <span className="font-bold text-neutral-900">{fmtMon(Number(v.monto))}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-neutral-400 uppercase">Qué paga</p>
                {imps.length === 0 && <p className="text-sm text-neutral-500 bg-neutral-50 rounded-xl px-3 py-2">Pago a cuenta — sin imputar a facturas (queda como crédito).</p>}
                {imps.map(i => {
                  const c = comprobantes.find(x => x.id === i.comprobante_id)
                  return (
                    <button key={i.id} onClick={() => { setOpAbierta(null); setTab('facturas'); if (c) setFactAbierta(c.id) }}
                      className="w-full bg-neutral-50 hover:bg-neutral-100 rounded-xl px-3 py-2 text-sm flex items-center justify-between text-left transition-colors">
                      <span className="text-neutral-700">{c ? `${c.tipo === 'nota_credito' ? 'NC' : 'Factura'} ${c.letra ?? ''} ${c.numero_proveedor}` : 'Comprobante'}</span>
                      <span className="font-bold text-neutral-900">{fmtMon(Number(i.monto))}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </ConeModal>
        )
      })()}

      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] rounded-2xl px-5 py-3 text-sm font-bold shadow-xl border ${toast.tipo === 'ok' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-red-50 text-red-600 border-red-200'}`}>
          {toast.tipo === 'ok' ? '✅ ' : '⛔ '}{toast.texto}
        </div>
      )}
      <ConeModal size="xl" open={modalFact} onClose={() => setModalFact(false)} title={fFact.tipo === 'nota_credito' ? 'Nueva nota de crédito' : 'Nueva factura de compra'}
        footer={<>
          <button onClick={() => setModalFact(false)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-neutral-400 hover:text-neutral-600">Cancelar</button>
          <ConeButton onClick={crearFactura} loading={saving}
            disabled={!fFact.proveedor_id || !fFact.numero_proveedor.trim() || !(totalEf() > 0)
              || (fFact.recepcionar && !fFact.sucursal_id)
              || !fFact.renglones.some(renglonFactCompleto) || fFact.renglones.some(r => !renglonFactCompleto(r) && (r.descripcion || r.cantidad || r.precio))}>
            {fFact.tipo === 'nota_credito' ? '✅ Registrar NC' : '✅ Registrar factura'}</ConeButton>
        </>}>
        <div className="space-y-4">
          {/* ── 1 · Tipo (mismo gesto que el modal de remitos) ── */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setFFact({ ...fFact, tipo: 'factura', remito_ids: [], renglones: [] })}
              className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${fFact.tipo === 'factura' ? 'border-neutral-900 bg-neutral-50 text-neutral-900' : 'border-neutral-200 text-neutral-400'}`}>
              🧾 Factura</button>
            <button onClick={() => setFFact({ ...fFact, tipo: 'nota_credito', remito_ids: [], renglones: [] })}
              className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${fFact.tipo === 'nota_credito' ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-neutral-200 text-neutral-400'}`}>
              ↩ Nota de crédito</button>
          </div>
          {/* ── 2 · Quién: proveedor + sucursal que recibe ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Proveedor *</Label>
              <select value={fFact.proveedor_id} onChange={e => setFFact({ ...fFact, proveedor_id: e.target.value, remito_ids: [], renglones: [] })}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm bg-white">
                <option value="">Elegir…</option>
                {proveedores.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Sucursal</Label>
              <select value={fFact.sucursal_id} onChange={e => setFFact({ ...fFact, sucursal_id: e.target.value })}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm bg-white">
                <option value="">—</option>
                {sucursales.map(su => <option key={su.id} value={su.id}>{su.nombre}</option>)}
              </select>
            </div>
          </div>
          {/* ── 3 · El papel: datos del comprobante físico ── */}
          <div className="grid grid-cols-[70px_1fr_150px] gap-3">
            <div className="space-y-1.5">
              <Label>Letra</Label>
              <select value={fFact.letra} onChange={e => setFFact({ ...fFact, letra: e.target.value })}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm bg-white">
                {['A','B','C','X',''].map(l => <option key={l} value={l}>{l || '—'}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>N° del comprobante *</Label>
              <input value={fFact.numero_proveedor} onChange={e => setFFact({ ...fFact, numero_proveedor: e.target.value })}
                placeholder="0001-00012345" className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <input type="date" value={fFact.fecha} onChange={e => setFFact({ ...fFact, fecha: e.target.value })}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm bg-white" />
            </div>
          </div>
          <div className="grid grid-cols-[220px_150px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>CAE</Label>
              <input value={fFact.cae} onChange={e => setFFact({ ...fFact, cae: e.target.value })} maxLength={14}
                placeholder="Opcional" className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Vencimiento</Label>
              <input type="date" value={fFact.fecha_vencimiento} onChange={e => setFFact({ ...fFact, fecha_vencimiento: e.target.value })}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm bg-white" />
            </div>
            <div />
          </div>
          {fFact.tipo === 'factura' && (
            <label className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-bold cursor-pointer transition-colors ${fFact.recepcionar ? 'border-neutral-900 bg-neutral-50 text-neutral-900' : 'border-neutral-200 text-neutral-500'}`}>
              <input type="checkbox" checked={fFact.recepcionar}
                onChange={e => setFFact({ ...fFact, recepcionar: e.target.checked, remito_ids: [], renglones: e.target.checked ? fFact.renglones.filter(r => !r.origen_remito).map(r => ({ ...r, ingresa: !!r.articulo_id })) : fFact.renglones.map(r => ({ ...r, ingresa: false })) })} />
              📦 Esta factura acompaña la mercadería — ingresa stock acá (sin remito del proveedor)
            </label>
          )}
          {fFact.recepcionar && !fFact.sucursal_id && (
            <p className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">Elegí arriba la sucursal que recibe la mercadería.</p>
          )}
          {/* ── 3 · Remitos de respaldo (precargan renglones) ── */}
          {!fFact.recepcionar && fFact.proveedor_id && (() => {
            const cands = remitosFacturables(fFact.proveedor_id, fFact.tipo === 'nota_credito' ? 'devolucion' : 'recepcion')
            return (
              <div className="space-y-1.5">
                <Label>{fFact.tipo === 'nota_credito' ? 'Devoluciones confirmadas sin NC' : 'Remitos confirmados sin facturar'}</Label>
                {cands.length === 0 && <p className="text-xs text-neutral-400 bg-neutral-50 rounded-xl px-3 py-2">
                  {fFact.tipo === 'nota_credito' ? 'Sin devoluciones pendientes — la NC puede cargarse solo con renglones.' : 'Sin remitos pendientes — la factura puede cargarse solo con renglones (flete, servicios…).'}</p>}
                <div className="grid grid-cols-2 gap-1.5">
                {cands.map(r => (
                  <label key={r.id} className="flex items-center gap-2.5 bg-neutral-50 rounded-xl px-3 py-2 text-sm cursor-pointer hover:bg-neutral-100">
                    <input type="checkbox" checked={fFact.remito_ids.includes(r.id)}
                      onChange={e => {
                        // Tildar = los renglones del remito entran EDITABLES; destildar = salen
                        if (e.target.checked) setFFact({ ...fFact, remito_ids: [...fFact.remito_ids, r.id], renglones: [...fFact.renglones, ...renglonesDeRemito(r.id)] })
                        else setFFact({ ...fFact, remito_ids: fFact.remito_ids.filter(x => x !== r.id), renglones: fFact.renglones.filter(x => x.origen_remito !== r.id) })
                      }} />
                    <span className="font-bold text-neutral-700 flex-1">REM-{String(r.numero).padStart(4, '0')}</span>
                    <span className="text-xs text-neutral-400">{r.fecha} · {fmtMon(totalRemito(r.id))}</span>
                  </label>
                ))}
                </div>
              </div>
            )
          })()}
          {/* ── 4 · RENGLONES (el papel, línea por línea) ── */}
          <div className="space-y-1">
            <Label>{fFact.tipo === 'nota_credito' ? 'Qué se acredita — renglones del papel' : 'Qué se factura — renglones del papel'}</Label>
            {fFact.renglones.map((r, idx) => (
              <div key={idx} className="bg-neutral-50 rounded-lg px-2 py-1 grid grid-cols-[1fr_150px_130px_75px_110px_105px_24px] gap-1.5 items-center">
                <input value={r.descripcion} onChange={e => setFFact({ ...fFact, renglones: fFact.renglones.map((x, i2) => i2 === idx ? { ...x, descripcion: e.target.value } : x) })}
                  placeholder="Descripción (del papel)" className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm min-w-0" />
                <select value={r.articulo_id} onChange={e => { const art = articulos.find(a => a.id === e.target.value); setFFact({ ...fFact, renglones: fFact.renglones.map((x, i2) => i2 === idx ? { ...x, articulo_id: e.target.value, presentacion_id: '', ingresa: fFact.recepcionar && !!e.target.value, descripcion: art ? art.nombre : x.descripcion } : x) }) }}
                  className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs bg-white text-neutral-500">
                  <option value="">Sin artículo</option>
                  {articulos.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
                <select value={r.presentacion_id} disabled={!r.articulo_id}
                  onChange={e => { const art = articulos.find(a => a.id === r.articulo_id); const pr = presentaciones.find(pp => pp.id === e.target.value); setFFact({ ...fFact, renglones: fFact.renglones.map((x, i2) => i2 === idx ? { ...x, presentacion_id: e.target.value, descripcion: (art && (x.descripcion === art.nombre || x.descripcion.startsWith(art.nombre + ' ') || !x.descripcion.trim())) ? (pr ? `${art.nombre} ${pr.nombre} x${Number(pr.factor)}` : art.nombre) : x.descripcion } : x) }) }}
                  className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs bg-white text-neutral-500 disabled:opacity-40">
                  <option value="">Unidad suelta</option>
                  {presDe(r.articulo_id).map(pr => <option key={pr.id} value={pr.id}>{pr.nombre} ×{Number(pr.factor)}</option>)}
                </select>
                <input type="number" min="0" step="0.01" value={r.cantidad} onChange={e => setFFact({ ...fFact, renglones: fFact.renglones.map((x, i2) => i2 === idx ? { ...x, cantidad: e.target.value } : x) })}
                  placeholder="Cant." className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm text-right" />
                <input type="number" min="0" step="0.01" value={r.precio} onChange={e => setFFact({ ...fFact, renglones: fFact.renglones.map((x, i2) => i2 === idx ? { ...x, precio: e.target.value } : x) })}
                  placeholder="$ s/IVA" className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm text-right" />
                <div className="text-right">
                  <span className="text-xs font-bold text-neutral-500">{fmtMon((Number(r.cantidad) || 0) * (Number(r.precio) || 0))}</span>
                  {fFact.recepcionar && r.articulo_id && (controla(r.articulo_id)
                    ? <label className="flex items-center justify-end gap-1 text-[10px] font-bold text-neutral-500 cursor-pointer">
                        <input type="checkbox" checked={r.ingresa} onChange={e => setFFact({ ...fFact, renglones: fFact.renglones.map((x, i2) => i2 === idx ? { ...x, ingresa: e.target.checked } : x) })} />📦 ingresa
                        {r.presentacion_id && <span className="text-neutral-400">= {fmtU((Number(r.cantidad) || 0) * Number(presentaciones.find(pp => pp.id === r.presentacion_id)?.factor ?? 1))} u</span>}
                      </label>
                    : <p className="text-[10px] text-neutral-400">solo documenta (sin control)</p>)}
                </div>
                <button onClick={() => setFFact({ ...fFact, renglones: fFact.renglones.filter((_, i2) => i2 !== idx) })}
                  className="text-neutral-300 hover:text-red-500 font-bold">✕</button>
              </div>
            ))}
            <button onClick={() => setFFact({ ...fFact, renglones: [...fFact.renglones, { descripcion: '', articulo_id: '', presentacion_id: '', cantidad: '', precio: '', origen_remito: null, ingresa: false }] })}
              className="text-xs px-3 py-1.5 rounded-full font-semibold border border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors">
              + Agregar renglón
            </button>
          </div>
          {/* ── 5 · La plata: resumen de comprobante (IVA calculado, pisable) ── */}
          <div className="ml-auto w-72 space-y-1 text-sm">
            <div className="flex items-center justify-between text-neutral-500">
              <span>Neto</span><span className="font-bold text-neutral-700">{fmtMon(netoDe(fFact.renglones))}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-neutral-500">
              <span>IVA 21%</span>
              <input type="number" min="0" step="0.01" value={fFact.iva}
                onChange={e => setFFact({ ...fFact, iva: e.target.value })}
                placeholder={ivaCalc().toFixed(2)}
                className="w-32 rounded-lg border border-neutral-200 px-2 py-1 text-sm text-right" />
            </div>
            {fFact.iva !== '' && Math.abs((Number(fFact.iva) || 0) - ivaCalc()) > 0.01 && (
              <p className="text-[11px] text-amber-600 font-semibold text-right">⚠️ difiere del 21% calculado ({fmtMon(ivaCalc())})</p>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-1.5">
              <span className="font-black text-neutral-900">TOTAL</span>
              <input type="number" min="0" step="0.01" value={fFact.total}
                onChange={e => setFFact({ ...fFact, total: e.target.value })}
                placeholder={(r2(netoDe(fFact.renglones) + ivaEf())).toFixed(2)}
                className="w-32 rounded-lg border border-neutral-200 px-2 py-1 text-sm text-right font-black" />
            </div>
            {fFact.total !== '' && Math.abs((netoDe(fFact.renglones) + ivaEf()) - (Number(fFact.total) || 0)) > 0.01 && (
              <p className="text-[11px] font-bold text-red-500 text-right">⛔ neto + IVA no da este total — el server lo rechaza</p>
            )}
          </div>
          {/* ── 6 · Pie ── */}
          <div className="space-y-1.5">
            <Label>Observaciones</Label>
            <input value={fFact.observaciones} onChange={e => setFFact({ ...fFact, observaciones: e.target.value })}
              placeholder="Opcional" className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm" />
          </div>
          <p className="text-[11px] text-neutral-400 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            {fFact.tipo === 'nota_credito'
              ? 'Al registrar nace el CRÉDITO en la cuenta corriente — por devolución, descuento o acuerdo comercial. Si hubo devolución física, tildá su remito arriba.'
              : 'Al registrar nace el CARGO en la cuenta corriente. El comprobante no se edita después — las diferencias se documentan con una NC.'}
          </p>
        </div>
      </ConeModal>

      <ConeModal size="lg" open={modalRemito} onClose={() => setModalRemito(false)} title={fRem.tipo === 'devolucion' ? 'Nueva devolución al proveedor' : 'Nuevo remito de recepción'}
        footer={<><ConeButton variant="outline" onClick={() => setModalRemito(false)}>Cancelar</ConeButton>
          <ConeButton onClick={crearRemito} loading={saving}
            disabled={!fRem.proveedor_id || !fRem.sucursal_id || !remRenglones.some(remRenglonCompleto) || remRenglones.some(remRenglonIncompleto)}>
            {fRem.tipo === 'devolucion' ? '↩ Confirmar devolución' : '✅ Confirmar recepción'}</ConeButton></>}>
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['recepcion', 'devolucion'] as const).map(t => (
              <button key={t} onClick={() => setFRem({ ...fRem, tipo: t, orden_compra_id: '' })}
                className={`flex-1 px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${fRem.tipo === t ? (t === 'devolucion' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-neutral-900 border-neutral-900 text-white') : 'bg-white border-neutral-200 text-neutral-400'}`}>
                {t === 'devolucion' ? '↩ Devolución' : '📦 Recepción'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Proveedor *</Label>
              <select value={fRem.proveedor_id} onChange={e => setFRem({ ...fRem, proveedor_id: e.target.value, orden_compra_id: '' })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">Elegí...</option>
                {proveedores.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>Nº remito del proveedor</Label><Input value={fRem.numero_proveedor} onChange={e => setFRem({ ...fRem, numero_proveedor: e.target.value })} placeholder="0001-00012345" /></div>
            <div className="space-y-1.5">
              <Label>Sucursal que recibe *</Label>
              <select value={fRem.sucursal_id} onChange={e => setFRem({ ...fRem, sucursal_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">Elegí...</option>
                {sucursales.map(su => <option key={su.id} value={su.id}>{su.nombre}</option>)}
              </select>
            </div>
          </div>
          {fRem.tipo === 'recepcion' && (<div className="space-y-1.5">
            <Label>Contra orden de compra (opcional)</Label>
            <select value={fRem.orden_compra_id} onChange={e => {
              const ocId = e.target.value
              setFRem({ ...fRem, orden_compra_id: ocId })
              setRemRenglones(ocId ? pendientesDeOC(ocId) : [{ articulo_id: '', presentacion_id: '', cantidad: '', costo_bulto: '' }])
            }}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
              <option value="">Sin OC — recepción directa</option>
              {ocs.filter(o => o.proveedor_id === fRem.proveedor_id && (o.estado === 'abierta' || o.estado === 'parcial')).map(o =>
                <option key={o.id} value={o.id}>OC-{String(o.numero).padStart(4, '0')} · {o.fecha}</option>)}
            </select>
            <p className="text-[11px] text-neutral-400">Con OC: los pendientes se cargan abajo, EDITABLES — ajustá a lo que REALMENTE llegó; el faltante queda pendiente en la OC.</p>
          </div>)}
          {(
            <div className="space-y-2">
              <Label>{fRem.tipo === 'devolucion' ? 'Qué se devuelve' : 'Qué llegó'} — en presentaciones de COMPRA</Label>
              {remRenglones.map((r, i) => {
                const presDeArt = presentaciones.filter(pr => pr.articulo_id === r.articulo_id && pr.activo)
                const f = r.presentacion_id ? Number(presentaciones.find(x => x.id === r.presentacion_id)?.factor ?? 1) : 1
                const q = Number(r.cantidad)
                const cb = Number(r.costo_bulto)
                return (
                  <div key={i} className="bg-neutral-50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={r.articulo_id}
                        onChange={e => setRemRenglones(rr => rr.map((x, j) => j === i ? { ...x, articulo_id: e.target.value, presentacion_id: '' } : x))}
                        className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                        <option value="">Artículo...</option>
                        {articulos.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                      </select>
                      <button onClick={() => setRemRenglones(rr => rr.filter((_, j) => j !== i))}
                        className="text-neutral-300 hover:text-red-500 font-bold px-2">✕</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select value={r.presentacion_id}
                        onChange={e => setRemRenglones(rr => rr.map((x, j) => j === i ? { ...x, presentacion_id: e.target.value } : x))}
                        className="px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                        <option value="">Unidad suelta</option>
                        {presDeArt.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre} ×{pr.factor}</option>)}
                      </select>
                      <Input value={r.cantidad} placeholder="Bultos"
                        onChange={e => setRemRenglones(rr => rr.map((x, j) => j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') } : x))} inputMode="decimal" />
                      <Input value={r.costo_bulto} placeholder="$ por bulto"
                        onChange={e => setRemRenglones(rr => rr.map((x, j) => j === i ? { ...x, costo_bulto: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') } : x))} inputMode="decimal" />
                    </div>
                    {r.articulo_id && q > 0 && (
                      <p className="text-[11px] text-neutral-400">= <span className="font-bold">{fmtU(q * f)} unidades</span>{isFinite(cb) && cb > 0 ? ` · $${fmtU(cb / f)} por unidad` : ''}</p>
                    )}
                    {remRenglonIncompleto(r) && (
                      <p className="text-[11px] font-semibold text-red-500">{!r.articulo_id ? 'Elegí el artículo' : 'Poné la cantidad (mayor a 0)'} — o dejá el renglón vacío y se ignora</p>
                    )}
                  </div>
                )
              })}
              <button onClick={() => setRemRenglones(rr => [...rr, { articulo_id: '', presentacion_id: '', cantidad: '', costo_bulto: '' }])}
                className="text-xs px-3 py-1.5 rounded-full font-semibold border border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors">
                + Agregar renglón
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">

            <div className="space-y-1.5"><Label>Observaciones</Label><Input value={fRem.observaciones} onChange={e => setFRem({ ...fRem, observaciones: e.target.value })} placeholder="Llegó sin frío..." /></div>
          </div>
        </div>
      </ConeModal>

      {/* ── ÓRDENES DE COMPRA (T3): la OC NO mueve stock — expresa
          "quiero comprar esto"; el movimiento nace en T4 con el remito ── */}
      {tab === 'ordenes' && (
        <div className="space-y-2">
          {ocs.length === 0 && <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">Sin órdenes de compra. Creá la primera con el botón de arriba.</div>}
          {ocs.map(oc => {
            const est = ESTADOS_OC[oc.estado] ?? { label: oc.estado, cls: 'bg-neutral-100 text-neutral-500' }
            const tot = totalPrevisto(oc.id)
            return (
              <button key={oc.id} onClick={() => setOcDetalle(oc)}
                className={`w-full text-left bg-white rounded-2xl border border-neutral-100 px-5 py-4 flex items-center justify-between shadow-sm hover:border-neutral-300 transition-colors ${oc.estado === 'anulada' ? 'opacity-55' : ''}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-neutral-900">OC-{String(oc.numero).padStart(4, '0')}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${est.cls}`}>{est.label}</span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5 truncate">
                    {nombreProveedor(oc.proveedor_id)} · {nombreSucursal(oc.sucursal_id)} · {oc.fecha}
                  </p>
                </div>
                <span className="font-bold text-neutral-700 text-sm flex-shrink-0">{tot > 0 ? `$${tot.toLocaleString('es-AR')}` : '—'}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Modal nueva OC ── */}
      <ConeModal size="lg" open={modalOC} onClose={() => setModalOC(false)} title="Nueva orden de compra"
        footer={<><ConeButton variant="outline" onClick={() => setModalOC(false)}>Cancelar</ConeButton>
          <ConeButton onClick={crearOC} loading={saving} disabled={!ocLista}>Crear orden</ConeButton></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Proveedor *</Label>
              <select value={fOC.proveedor_id} onChange={e => setFOC({ ...fOC, proveedor_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">Elegí...</option>
                {proveedores.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Destino *</Label>
              <select value={fOC.sucursal_id} onChange={e => setFOC({ ...fOC, sucursal_id: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                <option value="">🏢 Central (todas)</option>
                {sucursales.map(su => <option key={su.id} value={su.id}>{su.nombre}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Renglones — en presentaciones de COMPRA</Label>
            {fOC.renglones.map((r, i) => {
              const presDeArt = presentaciones.filter(pr => pr.articulo_id === r.articulo_id && pr.activo)
              const f = factorPresentacion(r.presentacion_id || null)
              const q = Number(r.cantidad)
              return (
                <div key={i} className="bg-neutral-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select value={r.articulo_id}
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, articulo_id: e.target.value, presentacion_id: '' } : x) })}
                      className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Artículo...</option>
                      {articulos.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                    <button onClick={() => setFOC({ ...fOC, renglones: fOC.renglones.filter((_, j) => j !== i) })}
                      className="text-neutral-300 hover:text-red-500 font-bold px-2">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select value={r.presentacion_id}
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, presentacion_id: e.target.value } : x) })}
                      className="px-3 py-2 rounded-lg border border-neutral-200 text-sm bg-white min-w-0">
                      <option value="">Unidad suelta</option>
                      {presDeArt.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre} ×{pr.factor}</option>)}
                    </select>
                    <Input value={r.cantidad} placeholder="Cant."
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') } : x) })} inputMode="decimal" />
                    <Input value={r.costo_previsto} placeholder="$ c/u previsto"
                      onChange={e => setFOC({ ...fOC, renglones: fOC.renglones.map((x, j) => j === i ? { ...x, costo_previsto: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') } : x) })} inputMode="decimal" />
                  </div>
                  {r.articulo_id && q > 0 && (
                    <p className="text-[11px] text-neutral-400">
                      = {fmtU(q * f)} {r.presentacion_id ? 'unidades operativas' : 'unidades'}{r.costo_previsto ? ` · previsto $${(q * Number(r.costo_previsto)).toLocaleString('es-AR')}` : ''}
                    </p>
                  )}
                  {rIncompleto(r) && (
                    <p className="text-[11px] font-semibold text-red-500">
                      {!r.articulo_id ? 'Elegí el artículo' : 'Poné la cantidad (mayor a 0)'} — o dejá el renglón vacío y se ignora
                    </p>
                  )}
                </div>
              )
            })}
            <button onClick={() => setFOC({ ...fOC, renglones: [...fOC.renglones, { articulo_id: '', presentacion_id: '', cantidad: '', costo_previsto: '' }] })}
              className="text-xs px-3 py-1.5 rounded-full font-semibold border border-dashed border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600 transition-colors">
              + Agregar renglón
            </button>
          </div>
          <div className="space-y-1.5"><Label>Observaciones</Label><Input value={fOC.observaciones} onChange={e => setFOC({ ...fOC, observaciones: e.target.value })} placeholder="Entregar por la mañana..." /></div>
        </div>
      </ConeModal>

      {/* ── Modal detalle OC ── */}
      <ConeModal open={!!ocDetalle} onClose={() => setOcDetalle(null)}
        title={ocDetalle ? `OC-${String(ocDetalle.numero).padStart(4, '0')} · ${ESTADOS_OC[ocDetalle.estado]?.label ?? ocDetalle.estado}` : ''}
        footer={<>
          {ocDetalle?.estado === 'abierta' && (
            <button onClick={() => anularOC(ocDetalle.id)}
              className="px-4 py-2 rounded-xl border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 transition-colors">Anular</button>
          )}
          <ConeButton variant="outline" onClick={() => setOcDetalle(null)}>Cerrar</ConeButton>
        </>}>
        {ocDetalle && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">
              <span className="font-bold text-neutral-800">{nombreProveedor(ocDetalle.proveedor_id)}</span> · {nombreSucursal(ocDetalle.sucursal_id)} · {ocDetalle.fecha}
            </p>
            <div className="space-y-1.5">
              {ocItems.filter(i => i.orden_compra_id === ocDetalle.id).map(i => (
                <div key={i.id} className="flex items-center justify-between bg-neutral-50 rounded-xl px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-800 truncate">{nombreArticulo(i.articulo_id)}</p>
                    <p className="text-xs text-neutral-400">
                      {Number(i.cantidad)} × {nombrePresentacion(i.presentacion_id) ?? 'unidad suelta'}
                      {i.presentacion_id ? ` = ${fmtU(Number(i.cantidad) * factorPresentacion(i.presentacion_id))} u.` : ''}
                    </p>
                  </div>
                  <span className="font-bold text-neutral-700 flex-shrink-0">{i.costo_previsto != null ? `$${(Number(i.cantidad) * Number(i.costo_previsto)).toLocaleString('es-AR')}` : '—'}</span>
                </div>
              ))}
            </div>
            {totalPrevisto(ocDetalle.id) > 0 && (
              <div className="flex justify-between font-black text-neutral-900 px-1">
                <span>Total previsto</span><span>${totalPrevisto(ocDetalle.id).toLocaleString('es-AR')}</span>
              </div>
            )}
            {ocDetalle.observaciones && <p className="text-xs text-neutral-400">📝 {ocDetalle.observaciones}</p>}
            <p className="text-[11px] text-neutral-400">La orden no mueve stock — el ingreso real nace con el remito (próximamente).</p>
          </div>
        )}
      </ConeModal>

      {/* ── Modal proveedor ── */}
      <ConeModal open={modalProv} onClose={() => setModalProv(false)} title={provEdit ? 'Editar proveedor' : 'Nuevo proveedor'}
        footer={<><ConeButton variant="outline" onClick={() => setModalProv(false)}>Cancelar</ConeButton><ConeButton onClick={guardarProveedor} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre de fantasía *</Label><Input value={fProv.nombre} onChange={e => setFProv({ ...fProv, nombre: e.target.value })} placeholder="Almacén Sur" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Razón social</Label>
            <Input value={fProv.razon_social} onChange={e => setFProv({ ...fProv, razon_social: e.target.value })} placeholder="Distribuidora Sur S.R.L." />
            <p className="text-[11px] text-neutral-400">La de los comprobantes. Vacía = se usa el nombre de fantasía.</p>
          </div>
          <div className="space-y-1.5"><Label>CUIT</Label><Input value={fProv.cuit} onChange={e => setFProv({ ...fProv, cuit: e.target.value.replace(/[^\d-]/g, '') })} placeholder="30-11122233-3" inputMode="numeric" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Teléfono</Label><Input value={fProv.telefono} onChange={e => setFProv({ ...fProv, telefono: e.target.value })} placeholder="2302..." /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input value={fProv.email} onChange={e => setFProv({ ...fProv, email: e.target.value })} placeholder="ventas@..." /></div>
          </div>
          <div className="space-y-1.5"><Label>Dirección</Label><Input value={fProv.direccion} onChange={e => setFProv({ ...fProv, direccion: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Observaciones</Label><Input value={fProv.observaciones} onChange={e => setFProv({ ...fProv, observaciones: e.target.value })} placeholder="Entrega los martes..." /></div>
        </div>
      </ConeModal>

      {/* ── Modal artículo ── */}
      <ConeModal open={modalArt} onClose={() => setModalArt(false)} title={artEdit ? 'Editar artículo' : 'Nuevo artículo'}
        footer={<><ConeButton variant="outline" onClick={() => setModalArt(false)}>Cancelar</ConeButton><ConeButton onClick={guardarArticulo} loading={saving}>Guardar</ConeButton></>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={fArt.nombre} onChange={e => setFArt({ ...fArt, nombre: e.target.value })} placeholder="Dulce de leche x balde" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <select value={fArt.tipo} onChange={e => setFArt({ ...fArt, tipo: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Unidad de stock *</Label>
              <select value={fArt.unidad_stock} onChange={e => setFArt({ ...fArt, unidad_stock: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between py-1">
            <div>
              <Label>Controla stock</Label>
              <p className="text-[11px] text-neutral-400">Apagado: el artículo existe en remitos y facturas pero no lleva stock.</p>
            </div>
            <button type="button" onClick={() => setFArt({ ...fArt, controla_stock: !fArt.controla_stock })}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${fArt.controla_stock ? 'bg-green-500' : 'bg-neutral-200'}`}>
              <span className={`absolute top-0.5 h-5 w-5 bg-white rounded-full shadow transition-all ${fArt.controla_stock ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <div className="space-y-1.5">
            <Label>Es reventa de un producto del catálogo</Label>
            <select value={fArt.producto_id} onChange={e => setFArt({ ...fArt, producto_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm bg-white">
              <option value="">Sin vínculo (insumo/material)</option>
              {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <p className="text-[11px] text-neutral-400">Solo si comprás EXACTAMENTE lo que vendés (la recepción suma en su stock de venta; un producto = un solo artículo). Los ingredientes de un producto elaborado van SIN vínculo — recetas: próximamente.</p>
          </div>
        </div>
      </ConeModal>

      {/* ── Modal importador de catálogo (herramienta de CARGA, GO CTO) ── */}
      <ConeModal open={modalImport} onClose={() => setModalImport(false)} title="Importar del catálogo"
        footer={<><ConeButton variant="outline" onClick={() => setModalImport(false)}>Cancelar</ConeButton>
          <ConeButton onClick={importarCatalogo} loading={saving} disabled={!importSel.length}>Importar {importSel.length > 0 ? `(${importSel.length})` : ''}</ConeButton></>}>
        <p className="text-xs text-neutral-400 mb-3">Crea artículos de REVENTA vinculados 1 a 1 (Mercadería · unidad · controla stock). Solo se ofrecen productos que aún no tienen artículo. No toca precios ni stock de venta; las presentaciones de compra se cargan después donde hagan falta.</p>
        {productosLibres.length === 0
          ? <div className="text-center py-8 text-neutral-400 text-sm">Todos los productos del catálogo ya tienen su artículo.</div>
          : <div className="space-y-1 max-h-80 overflow-y-auto">
              {productosLibres.map(p => (
                <label key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-50 cursor-pointer border border-transparent has-[:checked]:border-neutral-300 has-[:checked]:bg-neutral-50">
                  <input type="checkbox" className="h-4 w-4 rounded" checked={importSel.includes(p.id)}
                    onChange={e => setImportSel(sel => e.target.checked ? [...sel, p.id] : sel.filter(x => x !== p.id))} />
                  <span className="text-sm font-semibold text-neutral-700">{p.nombre}</span>
                </label>
              ))}
            </div>}
      </ConeModal>

      {/* ── Modal presentación de compra ── */}
      <ConeModal open={!!modalPres} onClose={() => { setModalPres(null); setPresEdit(null) }}
        title={presEdit ? `Editar presentación · ${modalPres?.articuloNombre ?? ''}` : `Nueva presentación de compra · ${modalPres?.articuloNombre ?? ''}`}
        footer={<>
          {presEdit && (() => { const pr = presentaciones.find(x => x.id === presEdit); return pr ? (<>
            <button onClick={async () => { await borrarPresentacion(pr.id); setModalPres(null); setPresEdit(null) }}
              className="px-4 py-2 rounded-xl border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 transition-colors">
              Borrar
            </button>
            <ConeButton variant="outline" onClick={() => { togglePresentacion(pr); setModalPres(null); setPresEdit(null) }}>{pr.activo ? 'Desactivar' : 'Activar'}</ConeButton>
          </>) : null })()}
          <ConeButton variant="outline" onClick={() => { setModalPres(null); setPresEdit(null) }}>Cancelar</ConeButton>
          <ConeButton onClick={async () => { await guardarPresentacion(); setModalPres(null) }} loading={saving}>Guardar</ConeButton>
        </>}>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={fPres.nombre} onChange={e => setFPres({ ...fPres, nombre: e.target.value })} placeholder="Caja x24 · Bolsa 25kg · Bidón 20L" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>Factor * (unidades por bulto)</Label>
            <Input value={fPres.factor} onChange={e => setFPres({ ...fPres, factor: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} placeholder="24" inputMode="decimal" />
            <p className="text-[11px] text-neutral-400">Ej.: Caja ×24 → recibir 3 cajas suma 72 al stock. Debe ser mayor a 0.</p>
          </div>
        </div>
      </ConeModal>
    </div>
  )
}
