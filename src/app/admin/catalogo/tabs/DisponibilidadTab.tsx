'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

interface Sucursal { id: string; nombre: string }
interface Opcion { id: string; nombre: string; emoji: string | null; color: string | null; grupo_nombre: string }
interface Inventario { opcion_id: string; disponible: boolean }

export default function DisponibilidadTab() {
  const { ctx } = useEmpresa()
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [sucursalId, setSucursalId] = useState('')
  const [opciones, setOpciones] = useState<Opcion[]>([])
  const [inventario, setInventario] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    if (!ctx) return
    const supabase = createClient()
    supabase.from('sucursales').select('id, nombre').eq('empresa_id', ctx.empresaId).eq('activo', true)
      .then(({ data }) => {
        setSucursales((data ?? []) as Sucursal[])
        if (data && data.length > 0) setSucursalId(data[0].id)
      })
  }, [ctx])

  useEffect(() => {
    if (!ctx || !sucursalId) return
    setLoading(true)
    const supabase = createClient()

    Promise.all([
      supabase.from('opciones')
        .select('id, nombre, emoji, color, grupos_opciones(nombre)')
        .eq('empresa_id', ctx.empresaId)
        .eq('activo', true)
        .is('deleted_at', null)
        .order('orden'),
      supabase.from('inventario_opciones')
        .select('opcion_id, disponible')
        .eq('sucursal_id', sucursalId)
        .eq('empresa_id', ctx.empresaId),
    ]).then(([{ data: ops }, { data: inv }]) => {
      setOpciones((ops ?? []).map((o: Record<string, unknown>) => ({
        ...o,
        grupo_nombre: (o.grupos_opciones as { nombre: string } | null)?.nombre ?? '',
      })) as Opcion[])

      const map: Record<string, boolean> = {}
      ;(inv ?? []).forEach((i: Inventario) => { map[i.opcion_id] = i.disponible })
      // Opciones sin fila en inventario = disponible por defecto
      ;(ops ?? []).forEach((o: Record<string, unknown>) => {
        if (map[o.id as string] === undefined) map[o.id as string] = true
      })
      setInventario(map)
      setLoading(false)
    })
  }, [ctx, sucursalId])

  async function toggle(opcionId: string) {
    if (!ctx) return
    setToggling(opcionId)
    const nuevoValor = !inventario[opcionId]
    setInventario(prev => ({ ...prev, [opcionId]: nuevoValor }))

    const supabase = createClient()
    await supabase.from('inventario_opciones').upsert({
      opcion_id: opcionId,
      sucursal_id: sucursalId,
      empresa_id: ctx.empresaId,
      disponible: nuevoValor,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'sucursal_id,opcion_id' })

    setToggling(null)
  }

  // Agrupar por grupo
  const porGrupo = opciones.reduce<Record<string, Opcion[]>>((acc, op) => {
    const g = op.grupo_nombre || 'Sin grupo'
    if (!acc[g]) acc[g] = []
    acc[g].push(op)
    return acc
  }, {})

  return (
    <div>
      {/* Selector sucursal */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm text-neutral-500 font-medium">Sucursal:</span>
        <Select value={sucursalId} onValueChange={setSucursalId}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(porGrupo).map(([grupo, ops]) => (
            <div key={grupo}>
              <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">{grupo}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {ops.map(op => {
                  const disponible = inventario[op.id] ?? true
                  return (
                    <button
                      key={op.id}
                      onClick={() => toggle(op.id)}
                      disabled={toggling === op.id}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        disponible
                          ? 'bg-white border-neutral-200 text-neutral-800 hover:border-neutral-400'
                          : 'bg-neutral-50 border-neutral-100 text-neutral-400 line-through'
                      }`}
                    >
                      {toggling === op.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                      ) : (
                        <span className="text-base flex-shrink-0">{op.emoji || '🍦'}</span>
                      )}
                      <span className="truncate">{op.nombre}</span>
                      <span className={`ml-auto text-xs flex-shrink-0 ${disponible ? 'text-green-500' : 'text-neutral-300'}`}>
                        {disponible ? '✓' : '✗'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
