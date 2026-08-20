import { NextResponse } from 'next/server'

// Inicia el flujo OAuth de Mercado Pago
// GET /api/mp/connect?empresa_id=X&slug=Y
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const empresa_id = searchParams.get('empresa_id')
  const slug = searchParams.get('slug')

  if (!empresa_id || !slug) {
    return NextResponse.json({ error: 'empresa_id y slug requeridos' }, { status: 400 })
  }

  const clientId = process.env.MP_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'MP_CLIENT_ID no configurado' }, { status: 500 })

  const state = Buffer.from(JSON.stringify({ empresa_id, slug })).toString('base64url')

  const url = new URL('https://auth.mercadopago.com.ar/authorization')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', 'mp')
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', 'https://coneos.vercel.app/api/mp/callback')

  return NextResponse.redirect(url.toString())
}
