// ═══════════════════════════════════════════════════════════════
// COLOR POR SUCURSAL (idea JC 23/09) — lenguaje visual instantáneo
// Determinístico por id: la misma sucursal tiene SIEMPRE el mismo
// color en toda la app, sin columna nueva ni configuración. Paleta
// pastel fija (clases Tailwind completas para sobrevivir el purge).
// Uso: <ChipSucursal id={...} nombre={...} /> y <LeyendaSucursales />.
// ═══════════════════════════════════════════════════════════════

export const PALETA_SUCURSAL = [
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-400' },
  { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-400' },
  { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-400' },
  { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-400' },
  { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-400' },
  { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', dot: 'bg-cyan-400' },
  { bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200', dot: 'bg-lime-400' },
  { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200', dot: 'bg-fuchsia-400' },
] as const

// "Todas las sucursales" tiene su identidad propia, neutra
export const COLOR_TODAS = { bg: 'bg-neutral-100', text: 'text-neutral-600', border: 'border-neutral-200', dot: 'bg-neutral-400' } as const

export function colorSucursal(id: string | null | undefined) {
  if (!id) return COLOR_TODAS
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETA_SUCURSAL[h % PALETA_SUCURSAL.length]
}

export function ChipSucursal({ id, nombre }: { id: string | null | undefined; nombre: string }) {
  const c = colorSucursal(id)
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {nombre}
    </span>
  )
}

export function LeyendaSucursales({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  if (sucursales.length <= 1) return null
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {sucursales.map(s => <ChipSucursal key={s.id} id={s.id} nombre={s.nombre} />)}
    </div>
  )
}
