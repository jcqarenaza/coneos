// Layout de la ruta corta /[empresa]/d/[token]
// Inyecta el manifest dinámico resuelto por token,
// para que la PWA instalada desde el link corto tenga el nombre del negocio
// y su start_url apunte al link corto (que incluye el token).

export default async function DeliveryShortLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ empresa: string; token: string }>
}) {
  const { token } = await params

  return (
    <>
      <link rel="manifest" href={`/api/manifest?token=${token}`} />
      {children}
    </>
  )
}
