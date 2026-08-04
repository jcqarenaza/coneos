'use client'

import { Loader2 } from 'lucide-react'
import { ReactNode } from 'react'

// ConePageHeader
export function ConePageHeader({ title, description, action }: {
  title: string; description?: string; action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{title}</h1>
        {description && <p className="text-neutral-400 text-sm mt-0.5">{description}</p>}
      </div>
      {action && (
        <ConeButton onClick={action.onClick} icon={<span className="text-base leading-none">+</span>}>
          {action.label}
        </ConeButton>
      )}
    </div>
  )
}

// ConeCard
export function ConeCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5">
      {title && <h3 className="font-bold text-neutral-700 mb-4">{title}</h3>}
      {children}
    </div>
  )
}

// ConeButton
export function ConeButton({
  children, onClick, variant = 'primary', size = 'md', loading = false, disabled = false, icon, type = 'button'
}: {
  children?: ReactNode; onClick?: () => void; variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md'; loading?: boolean; disabled?: boolean; icon?: ReactNode; type?: 'button' | 'submit'
}) {
  const base = 'inline-flex items-center gap-2 font-semibold rounded-xl transition-all active:scale-98 disabled:opacity-50'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' }
  const variants = {
    primary: 'bg-neutral-800 text-white hover:bg-neutral-700 shadow-sm',
    outline: 'border border-neutral-200 text-neutral-700 hover:bg-neutral-50',
    ghost: 'text-neutral-600 hover:bg-neutral-100',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

// ConeModal
export function ConeModal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <h2 className="font-bold text-neutral-900">{title}</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 transition-colors text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-neutral-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

// ConeBadge
export function ConeBadge({ active, labelOn = 'Activo', labelOff = 'Inactivo' }: {
  active: boolean; labelOn?: string; labelOff?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${active ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-400'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-neutral-400'}`} />
      {active ? labelOn : labelOff}
    </span>
  )
}

// ConeTable — mantener para compatibilidad
export function ConeTable({ data, columns, onEdit, onDelete, emptyMessage }: {
  data: Record<string, unknown>[]
  columns: { key: string; label: string; render?: (row: Record<string, unknown>) => ReactNode }[]
  onEdit?: (row: Record<string, unknown>) => void
  onDelete?: (row: Record<string, unknown>) => void
  onToggle?: (row: Record<string, unknown>) => void
  emptyMessage?: string
}) {
  if (data.length === 0) return (
    <div className="text-center py-12 text-neutral-400 bg-white rounded-2xl border border-neutral-100">{emptyMessage ?? 'Sin datos'}</div>
  )
  return (
    <div className="bg-white rounded-2xl border border-neutral-100 overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-50">
            {columns.map(col => <th key={col.key} className="text-left px-5 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">{col.label}</th>)}
            {(onEdit || onDelete) && <th className="px-5 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wide">Acciones</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50">
          {data.map((row, i) => (
            <tr key={i} className="hover:bg-neutral-50/50">
              {columns.map(col => <td key={col.key} className="px-5 py-3.5 text-neutral-700">{col.render ? col.render(row) : String(row[col.key] ?? '')}</td>)}
              {(onEdit || onDelete) && (
                <td className="px-5 py-3.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {onEdit && <button onClick={() => onEdit(row)} className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"><span className="text-xs">Editar</span></button>}
                    {onDelete && <button onClick={() => onDelete(row)} className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><span className="text-xs">Eliminar</span></button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
