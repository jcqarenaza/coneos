'use client'

// CICLO SUCURSALES (orden CTO 23/09): esta página se mudó a
// Configuración del negocio → tab 🏢 Sucursales. La ruta queda como
// redirect para bookmarks viejos; el sidebar ya no la lista.
// La edición de pagos/TA/delivery que vivía acá tiene UNA sola casa:
// Cobros y la grilla de Horarios y servicios.
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function SucursalesRedirect() {
  const router = useRouter()
  const params = useParams<{ empresa: string }>()
  useEffect(() => { router.replace(`/${params.empresa}/admin/servicios`) }, [router, params.empresa])
  return null
}
