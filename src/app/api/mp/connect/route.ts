import { NextResponse } from 'next/server'

// Inicia el flujo OAuth de Mercado Pago (multi-cuenta, Fase 3)
// GET /api/mp/connect?empresa_id=X&slug=Y[&sucursal_id=Z][&mp_credencial_id=C]
// Sin sucursal_id → cuenta de la MARCA (sucursal_id NULL).
// Con sucursal_id → cuenta de esa sucursal.
// mp_credencial_id (opcional) → intención de RECONECTAR esa credencial;
// la identidad real la decide el callback por (empresa, alcance, mp_user_id).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  const slug = searchParams.get('slug')
  const sucursal_id = searchParams.get('sucursal_id')
  const mp_credencial_id = searchParams.get('mp_credencial_id')

  if (!empresa_id || !slug) {
    return NextResponse.json({ error: 'empresa_id y slug requeridos' }, { status: 400 })
  }

  const clientId = process.env.MP_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'MP_CLIENT_ID no configurado' }, { status: 500 })

  const state = Buffer.from(JSON.stringify({
    empresa_id, slug,
    sucursal_id: sucursal_id ?? null,
    mp_credencial_id: mp_credencial_id ?? null,
  })).toString('base64url')

  const url = new URL('https://auth.mercadopago.com.ar/authorization')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', 'mp')
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', 'https://coneos.vercel.app/api/mp/callback')

  return NextResponse.redirect(url.toString())
}
