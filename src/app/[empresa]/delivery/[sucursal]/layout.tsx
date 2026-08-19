// Layout server-side de la ruta delivery.
// Inyecta el <link rel="manifest"> correcto ANTES de servir el HTML.
// Los browsers usan el último <link rel="manifest"> que encuentran,
// por lo que este sobreescribe al del layout raíz.

export default async function DeliveryLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ empresa: string; sucursal: string }>
}) {
  const { empresa, sucursal } = await params

  return (
    <>
      {/* Manifest dinámico por empresa/sucursal — sobreescribe el raíz */}
      <link
        rel="manifest"
        href={`/api/manifest?empresa=${empresa}&sucursal=${sucursal}`}
      />
      {children}
    </>
  )
}
