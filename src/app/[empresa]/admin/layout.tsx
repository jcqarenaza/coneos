import AdminSidebarWrapper from '@/components/admin/AdminSidebarWrapper'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-neutral-50">
      <AdminSidebarWrapper />
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  )
}
