import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Callback OAuth de Mercado Pago
// El state trae { empresa_id, slug, sucursal_id } — sucursal_id null = cuenta de la marca.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.redirect('https://coneos.vercel.app')
  }

  let empresa_id: string, slug: string, sucursal_id: string | null
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    empresa_id = parsed.empresa_id
    slug = parsed.slug
    sucursal_id = parsed.sucursal_id ?? null
  } catch {
    return NextResponse.redirect('https://coneos.vercel.app')
  }

  const res = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.MP_CLIENT_ID,
      client_secret: process.env.MP_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: 'https://coneos.vercel.app/api/mp/callback',
    }),
  })

  const data = await res.json()

  if (!res.ok || !data.access_token) {
    console.error('[mp/callback] Error obteniendo tokens:', data)
    return NextResponse.redirect(`https://coneos.vercel.app/${slug}/admin/config?mp=error`)
  }

  const supabase = createAdminClient()
  const expires_at = new Date(Date.now() + (data.expires_in ?? 15552000) * 1000).toISOString()

  // MICRO-FIX 1.1 (Fase 1): el UNIQUE viejo (empresa_id, sucursal_id) ya no
  // existe — la identidad de una cuenta es ahora (empresa, sucursal, mp_user_id).
  // Reconectar la MISMA cuenta MP actualiza su fila; una cuenta DISTINTA crea
  // fila nueva (compatible con multi-cuenta sin implementar OAuth completo).
  const mpUserId = String(data.user_id)
  let existente = supabase.from('mp_credenciales')
    .select('id')
    .eq('empresa_id', empresa_id)
    .eq('mp_user_id', mpUserId)
  existente = sucursal_id === null ? existente.is('sucursal_id', null) : existente.eq('sucursal_id', sucursal_id)
  const { data: cred } = await existente.maybeSingle()

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    public_key: data.public_key ?? null,
    expires_at,
    updated_at: new Date().toISOString(),
  }
  if (cred) {
    await supabase.from('mp_credenciales').update(tokens).eq('id', cred.id)
  } else {
    await supabase.from('mp_credenciales').insert({
      empresa_id, sucursal_id, mp_user_id: mpUserId, ...tokens,
    })
  }

  return NextResponse.redirect(`https://coneos.vercel.app/${slug}/admin/config?mp=ok`)
}
