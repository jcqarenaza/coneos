import AdminSidebar from '@/components/admin/AdminSidebar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-neutral-50">
      <AdminSidebar
        usuarioNombre="Admin"
        empresaNombre="Cecchetto Helados"
      />
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  )
}
