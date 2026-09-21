'use client'

// ═══════════════════════════════════════════════════════════════════
// Admin → Mesas — PODADA (ciclo QR y accesos)
// Queda la llave del negocio: "Recibir pedidos de mesa"
// (empresa_config.mesas_activo — doble llave con modulos.mesas de QP).
// Los links y el generador de QRs imprimibles se MUDARON a la casa
// "Servicios y horarios" → tab QR y accesos (componente QrMesas, intacto).
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useEmpresa } from '@/lib/useEmpresa'
import { Loader2 } from 'lucide-react'

export default function MesasPage() {
  const { ctx } = useEmpresa()
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [moduloActivo, setModuloActivo] = useState(false)
  const [mesasActivo, setMesasActivo] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!ctx) return
    supabase.from('empresa_config').select('modulos, mesas_activo').eq('empresa_id', ctx.empresaId).maybeSingle()
      .then(({ data: cfg }) => {
        const modulos = (cfg?.modulos ?? {}) as Record<string, boolean>
        setModuloActivo(modulos.mesas === true)
        setMesasActivo(cfg?.mesas_activo !== false)
        setLoading(false)
      })
  }, [ctx, supabase])

  async function toggleRecibir() {
    if (!ctx || guardando) return
    setGuardando(true)
    const nuevo = !mesasActivo
    await supabase.from('empresa_config').update({ mesas_activo: nuevo }).eq('empresa_id', ctx.empresaId)
    setMesasActivo(nuevo)
    setGuardando(false)
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-neutral-300" /></div>

  if (!moduloActivo) return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-8 text-center">
        <span className="text-5xl block mb-3">🪑</span>
        <h2 className="text-lg font-black text-neutral-800 mb-2">El módulo Mesas no está activo</h2>
        <p className="text-neutral-500 text-sm">Contactá a QP C&IA para activarlo en tu plan.</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-black text-neutral-900">🪑 Mesas</h1>
        <p className="text-neutral-400 text-sm">Pedidos con QR desde la mesa</p>
      </div>

      {/* Llave del negocio */}
      <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-bold text-neutral-800">Recibir pedidos de mesa</p>
          <p className="text-neutral-400 text-sm">Pausalo cuando no haya servicio en el salón. Los QR mostrarán &quot;no disponible&quot;.</p>
        </div>
        <button onClick={toggleRecibir} disabled={guardando}
          className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 ${mesasActivo ? 'bg-green-500' : 'bg-neutral-200'}`}>
          <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${mesasActivo ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* CICLO QR: los links y QRs imprimibles se mudaron */}
      <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
        <p className="text-xs text-neutral-500">📱 Los <b>links y QRs imprimibles</b> de las mesas (cartelitos y stickers) ahora viven en <b>Servicios y horarios</b> → tab 📱 QR y accesos.</p>
      </div>
    </div>
  )
}
