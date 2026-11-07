'use client'

// MULTI-FOTOS — galería del admin para un producto o una presentación.
// - Hasta MAX_IMAGENES (10) por ámbito; el servidor también lo valida.
// - Subir varias, marcar principal (⭐), reordenar (◀ ▶) y quitar.
// - Si la tabla `producto_imagenes` todavía no existe (SQL sin aplicar), renderiza
//   `fallback` (el cargador de una sola imagen de siempre): el código se puede
//   desplegar antes o después del SQL sin romper nada.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MAX_IMAGENES } from '@/lib/imagenes'
import { Loader2, Upload, X, Star, ChevronLeft, ChevronRight } from 'lucide-react'

interface Foto { id: string; url: string; orden: number; es_principal: boolean }
interface Props {
  empresaId: string
  productoId: string
  presentacionId?: string | null
  onCambio?: () => void
  fallback: ReactNode
}

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 10 * 1024 * 1024

// Cache por sesión: ¿existe la tabla? (una sola consulta para todas las galerías)
let probe: Promise<boolean> | null = null
function galeriaDisponible(): Promise<boolean> {
  if (!probe) {
    probe = Promise.resolve(createClient().from('producto_imagenes').select('id').limit(1))
      .then(({ error }) => !error)
      .catch(() => false)
  }
  return probe
}

/** Para saber, antes de guardar un formulario, si el espejo imagen_url lo mantiene la galería. */
export function useGaleriaDisponible(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => { let vivo = true; galeriaDisponible().then(v => { if (vivo) setOk(v) }); return () => { vivo = false } }, [])
  return ok
}

export default function GaleriaImagenes({ empresaId, productoId, presentacionId = null, onCambio, fallback }: Props) {
  const disponible = useGaleriaDisponible()
  const [fotos, setFotos] = useState<Foto[]>([])
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const traer = useCallback(async () => {
    const supabase = createClient()
    let q = supabase.from('producto_imagenes').select('id, url, orden, es_principal, created_at').eq('producto_id', productoId)
    q = presentacionId ? q.eq('presentacion_id', presentacionId) : q.is('presentacion_id', null)
    const { data, error: err } = await q.order('orden').order('created_at')
    const lista = ((data ?? []) as (Foto & { created_at: string })[])
    // principal primero para mostrar; el orden relativo del resto lo da `orden`
    lista.sort((a, b) => Number(b.es_principal) - Number(a.es_principal) || a.orden - b.orden)
    return { err, fotos: lista.map(({ id, url, orden, es_principal }) => ({ id, url, orden, es_principal })) }
  }, [productoId, presentacionId])

  const aplicar = useCallback((r: { err: unknown; fotos: Foto[] }) => {
    if (r.err) setError('No se pudieron cargar las fotos')
    else setFotos(r.fotos)
    setCargando(false)
  }, [])

  const cargar = useCallback(async () => { aplicar(await traer()) }, [traer, aplicar])

  useEffect(() => {
    if (!disponible) return
    let vivo = true
    traer().then(r => { if (vivo) aplicar(r) })
    return () => { vivo = false }
  }, [disponible, traer, aplicar])

  function mensaje(e: { message?: string } | null): string {
    const m = e?.message ?? ''
    if (m.includes('LIMITE_IMAGENES')) return `Máximo ${MAX_IMAGENES} fotos`
    if (m.includes('PRESENTACION_INVALIDA')) return 'La presentación no pertenece a este producto'
    if (m.includes('IMAGEN_PRINCIPAL_REQUERIDA')) return 'Elegí otra foto como principal'
    return 'No se pudo completar la operación'
  }

  async function subir(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null); setOcupado(true)
    const supabase = createClient()
    const libres = MAX_IMAGENES - fotos.length
    const lote = Array.from(files).slice(0, Math.max(0, libres))
    const avisos: string[] = []
    if (files.length > libres) avisos.push(`Solo entran ${Math.max(0, libres)} más (máximo ${MAX_IMAGENES}).`)
    let siguiente = fotos.reduce((m, f) => Math.max(m, f.orden), -1) + 1
    for (const file of lote) {
      if (!TIPOS.includes(file.type)) { avisos.push(`"${file.name}": solo JPG, PNG, WEBP o GIF.`); continue }
      if (file.size > MAX_BYTES) { avisos.push(`"${file.name}": supera los 10 MB.`); continue }
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `galeria/${productoId}/${crypto.randomUUID()}.${ext}`
      const { error: eUp } = await supabase.storage.from('productos').upload(path, file, { upsert: false })
      if (eUp) { avisos.push(`"${file.name}": no se pudo subir.`); continue }
      const url = supabase.storage.from('productos').getPublicUrl(path).data.publicUrl
      const { error: eIns } = await supabase.from('producto_imagenes').insert({
        empresa_id: empresaId, producto_id: productoId, presentacion_id: presentacionId, url, orden: siguiente++,
      })
      if (eIns) { avisos.push(`"${file.name}": ${mensaje(eIns)}.`); }
    }
    if (avisos.length) setError(avisos.join(' '))
    await cargar(); setOcupado(false); onCambio?.()
  }

  async function hacerPrincipal(id: string) {
    setError(null); setOcupado(true)
    const { error: e } = await createClient().rpc('set_imagen_principal', { p_imagen_id: id })
    if (e) setError(mensaje(e))
    await cargar(); setOcupado(false); onCambio?.()
  }

  async function quitar(id: string) {
    setError(null); setOcupado(true)
    const { error: e } = await createClient().from('producto_imagenes').delete().eq('id', id)
    if (e) setError(mensaje(e))
    await cargar(); setOcupado(false); onCambio?.()
  }

  async function mover(id: string, dir: -1 | 1) {
    const ids = [...fotos].sort((a, b) => a.orden - b.orden).map(f => f.id)
    const i = ids.indexOf(id), j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setError(null); setOcupado(true)
    const { error: e } = await createClient().rpc('reordenar_imagenes', { p_producto_id: productoId, p_presentacion_id: presentacionId, p_ids: ids })
    if (e) setError('No se pudo reordenar')
    await cargar(); setOcupado(false); onCambio?.()
  }

  if (disponible === null) return <div className="h-20 flex items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
  if (!disponible) return <>{fallback}</>

  const porOrden = [...fotos].sort((a, b) => a.orden - b.orden)
  return (
    <div className="space-y-2">
      {cargando ? (
        <div className="h-20 flex items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {fotos.map(f => {
            const pos = porOrden.findIndex(x => x.id === f.id)
            return (
              <div key={f.id} className={`relative aspect-square rounded-xl overflow-hidden border bg-neutral-50 group ${f.es_principal ? 'border-amber-400 ring-2 ring-amber-300' : 'border-neutral-200'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                {f.es_principal && <span className="absolute top-1 left-1 text-[10px] font-bold bg-amber-400 text-white rounded-full px-1.5 py-0.5">Principal</span>}
                <button type="button" disabled={ocupado} onClick={() => quitar(f.id)} aria-label="Quitar foto"
                  className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow disabled:opacity-50">
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="absolute bottom-0 inset-x-0 flex items-center justify-between bg-black/45 px-1 py-0.5">
                  <button type="button" disabled={ocupado || pos === 0} onClick={() => mover(f.id, -1)} aria-label="Mover antes" className="text-white disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" disabled={ocupado || f.es_principal} onClick={() => hacerPrincipal(f.id)} aria-label="Hacer principal" className="text-white disabled:opacity-40"><Star className={`h-4 w-4 ${f.es_principal ? 'fill-amber-300 text-amber-300' : ''}`} /></button>
                  <button type="button" disabled={ocupado || pos === porOrden.length - 1} onClick={() => mover(f.id, 1)} aria-label="Mover después" className="text-white disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )
          })}
          {fotos.length < MAX_IMAGENES && (
            <button type="button" disabled={ocupado} onClick={() => inputRef.current?.click()}
              className="aspect-square rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 hover:bg-neutral-100 flex flex-col items-center justify-center gap-1 text-neutral-400 disabled:opacity-50">
              {ocupado ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              <span className="text-xs font-medium">{ocupado ? 'Subiendo…' : 'Agregar fotos'}</span>
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-neutral-400">{fotos.length}/{MAX_IMAGENES} fotos · JPG, PNG, WEBP o GIF · hasta 10 MB cada una · ⭐ elige la principal (la que se ve en el listado)</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden"
        onChange={e => { subir(e.target.files); e.target.value = '' }} />
    </div>
  )
}
