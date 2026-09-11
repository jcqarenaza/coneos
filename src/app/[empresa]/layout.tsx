import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'

// Metadata dinámica por comercio: cuando un link de ConeOS se comparte por
// WhatsApp/redes, la vista previa muestra el LOGO Y NOMBRE DEL COMERCIO
// (empresa_config.logo_url) en vez de la marca ConeOS. Aplica a todas las
// rutas bajo /{empresa}/... (delivery, /d/, mesa, takeaway, kiosk, admin).
// El layout NO altera el render: devuelve children tal cual.

export async function generateMetadata(
  { params }: { params: Promise<{ empresa: string }> }
): Promise<Metadata> {
  try {
    const { empresa: slug } = await params
    const supabase = createAdminClient()
    const { data: empresa } = await supabase
      .from('empresas').select('id, nombre').eq('slug', slug).maybeSingle()
    if (!empresa) return {}
    const { data: cfg } = await supabase
      .from('empresa_config').select('logo_url').eq('empresa_id', empresa.id).maybeSingle()

    const titulo = empresa.nombre
    const descripcion = `Hacé tu pedido online en ${empresa.nombre}.`
    const logo = cfg?.logo_url ?? null

    return {
      title: titulo,
      description: descripcion,
      openGraph: {
        title: titulo,
        description: descripcion,
        ...(logo ? { images: [{ url: logo, width: 512, height: 512, alt: titulo }] } : {}),
      },
      twitter: {
        card: 'summary',
        title: titulo,
        description: descripcion,
        ...(logo ? { images: [logo] } : {}),
      },
      ...(logo ? { icons: { icon: logo, apple: logo } } : {}),
    }
  } catch {
    return {}
  }
}

export default function EmpresaLayout({ children }: { children: React.ReactNode }) {
  return children
}
