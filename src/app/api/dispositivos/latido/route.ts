import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Latido de instancia: cada pantalla abierta reporta que está viva (cada ~2 min).
// POST { instancia_id, empresa_id, sucursal_id?, dispositivo_id?, tipo }
// Silencioso y best-effort: si falla no afecta la operación.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { instancia_id, empresa_id, sucursal_id, dispositivo_id, tipo } = body ?? {}
  if (!instancia_id || !empresa_id || !tipo) return NextResponse.json({ ok: false })

  const supabase = createAdminClient()
  await supabase.from('dispositivo_instancias').upsert({
    instancia_id: String(instancia_id).slice(0, 80),
    empresa_id,
    sucursal_id: sucursal_id ?? null,
    dispositivo_id: dispositivo_id ?? null,
    tipo: String(tipo).toUpperCase().slice(0, 20),
    user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300),
    last_seen: new Date().toISOString(),
  }, { onConflict: 'instancia_id' })

  return NextResponse.json({ ok: true })
}
