// ═══════════════════════════════════════════════════════════════════
// MARCA DE PLATAFORMA — único lugar donde vive el nombre del sistema.
// Default: GastrOS. Overrides por comercio (slug): Federal conserva
// ConeOS. NO toca: URLs coneos.*, claves coneos_* de storage, ni el
// certificado ARCA — eso es infraestructura, no marca.
// ═══════════════════════════════════════════════════════════════════

export const MARCA_DEFAULT = 'GastrOS'

const OVERRIDES: Record<string, string> = {
  federal: 'ConeOS',
}

/** Marca de la plataforma para un comercio (por slug). Sin slug → default. */
export const marcaDe = (slug?: string | null): string =>
  OVERRIDES[(slug ?? '').toLowerCase().trim()] ?? MARCA_DEFAULT

/** Para componentes cliente bajo /[empresa]/...: lee el slug de la ruta. */
export const marcaDeRuta = (): string =>
  marcaDe(typeof window === 'undefined' ? null : window.location.pathname.split('/')[1])
