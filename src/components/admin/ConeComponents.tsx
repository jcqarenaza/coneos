'use client'

import { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'

// ─── ConePageHeader ───────────────────────────────────────────────
interface ConePageHeaderProps {
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function ConePageHeader({ title, description, action }: ConePageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="text-2xl font-medium text-neutral-900">{title}</h1>
        {description && <p className="text-sm text-neutral-500 mt-1">{description}</p>}
      </div>
      {action && (
        <ConeButton onClick={action.onClick} icon={<Plus className="h-4 w-4" />}>
          {action.label}
        </ConeButton>
      )}
    </div>
  )
}

// ─── ConeButton ───────────────────────────────────────────────────
interface ConeButtonProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'default' | 'sm'
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
  className?: string
}

export function ConeButton({
  children, onClick, type = 'button', variant = 'default',
  size = 'default', loading, disabled, icon, className
}: ConeButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled || loading}
      className={className}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : icon && <span className="mr-2">{icon}</span>}
      {children}
    </Button>
  )
}

// ─── ConeCard ─────────────────────────────────────────────────────
interface ConeCardProps {
  title?: string
  children: ReactNode
  className?: string
}

export function ConeCard({ title, children, className }: ConeCardProps) {
  return (
    <Card className={className}>
      {title && (
        <CardHeader>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={title ? '' : 'pt-6'}>{children}</CardContent>
    </Card>
  )
}

// ─── ConeTable ────────────────────────────────────────────────────
interface ConeTableColumn<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
}

interface ConeTableProps<T> {
  columns: ConeTableColumn<T>[]
  data: T[]
  onEdit?: (row: T) => void
  onDelete?: (row: T) => void
  emptyMessage?: string
  keyField?: keyof T
}

export function ConeTable<T extends Record<string, unknown>>({
  columns, data, onEdit, onDelete, emptyMessage = 'Sin registros', keyField = 'id' as keyof T
}: ConeTableProps<T>) {
  return (
    <div className="rounded-lg border border-neutral-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr>
            {columns.map(col => (
              <th key={col.key} className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                {col.label}
              </th>
            ))}
            {(onEdit || onDelete) && (
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide w-24">
                Acciones
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="text-center py-12 text-neutral-400">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr key={String(row[keyField] ?? i)} className="hover:bg-neutral-50 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3 text-neutral-700">
                    {col.render ? col.render(row) : String(row[col.key] ?? '')}
                  </td>
                ))}
                {(onEdit || onDelete) && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {onEdit && (
                        <button
                          onClick={() => onEdit(row)}
                          className="p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(row)}
                          className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── ConeModal ────────────────────────────────────────────────────
interface ConeModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function ConeModal({ open, onClose, title, children, footer }: ConeModalProps) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-medium">{title}</DialogTitle>
        </DialogHeader>
        <div className="py-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">{footer}</div>}
      </DialogContent>
    </Dialog>
  )
}

// ─── ConeBadge ────────────────────────────────────────────────────
interface ConeBadgeProps {
  active: boolean
  labelOn?: string
  labelOff?: string
}

export function ConeBadge({ active, labelOn = 'Activo', labelOff = 'Inactivo' }: ConeBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      active ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-500'
    }`}>
      {active ? labelOn : labelOff}
    </span>
  )
}
