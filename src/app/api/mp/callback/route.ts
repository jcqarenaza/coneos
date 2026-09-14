import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardarCredencialOAuth } from '@/lib/pagos/mp'

// Callback OAuth de Mercado Pago (multi-cuenta, Fase 3)
// state: { empresa_id, slug, sucursal_id|null, mp_credencial_id|null }
// La identidad de la cuenta es (empresa, alcance de sucursal, mp_user_id):
// misma cuenta → UPDATE (reconexión, reactiva); cuenta distinta → INSERT.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.redirect('https://coneos.vercel.app')
  }

  let empresa_id: string, slug: string, sucursal_id: string | null, mp_credencial_id: string | null
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString())
    empresa_id = parsed.empresa_id
    slug = parsed.slug
    sucursal_id = parsed.sucursal_id ?? null
    mp_credencial_id = parsed.mp_credencial_id ?? null
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

  try {
    const resultado = await guardarCredencialOAuth(createAdminClient(), {
      empresa_id,
      sucursal_id,
      mp_user_id: String(data.user_id),
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      public_key: data.public_key ?? null,
      expires_at: new Date(Date.now() + (data.expires_in ?? 15552000) * 1000).toISOString(),
      credencial_hint_id: mp_credencial_id,
    })
    const nota = resultado.distinta_del_hint ? '&nota=cuenta_distinta' : ''
    return NextResponse.redirect(`https://coneos.vercel.app/${slug}/admin/config?mp=ok${nota}`)
  } catch (e) {
    console.error('[mp/callback] Error guardando credencial:', e)
    return NextResponse.redirect(`https://coneos.vercel.app/${slug}/admin/config?mp=error`)
  }
}
