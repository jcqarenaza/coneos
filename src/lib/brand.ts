// ═══════════════════════════════════════════════════════════════════
// MARCA DE PLATAFORMA — único lugar donde vive el nombre del sistema.
// Default: GastrOS. Overrides por comercio (slug): Federal conserva
// ConeOS. Mañana un partner puede tener la suya acá mismo.
// NO toca: URLs (coneos.com.ar/vercel.app), claves de localStorage
// (coneos_*), certificados ARCA ni slugs — eso es infraestructura.
// ═══════════════════════════════════════════════════════════════════

export const MARCA_DEFAULT = 'GastrOS'

const OVERRIDES: Record<string, string> = {
  federal: 'ConeOS',
}

/** Nombre de la plataforma para un comercio (por slug). Sin slug → default. */
export const marcaDe = (slug?: string | null): string =>
  OVERRIDES[(slug ?? '').toLowerCase().trim()] ?? MARCA_DEFAULT
