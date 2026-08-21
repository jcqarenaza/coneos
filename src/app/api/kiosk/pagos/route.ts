import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sucursal_id = searchParams.get('sucursal_id')

  if (!sucursal_id) return NextResponse.json({ error: 'sucursal_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('sucursal_pagos')
    .select('acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_kiosk, acepta_mp_delivery, cbu_transferencia, mp_access_token, mp_public_key')
    .eq('sucursal_id', sucursal_id)
    .single()

  return NextResponse.json(data ?? { acepta_efectivo: true, acepta_transferencia: false, acepta_mp: false, cbu_transferencia: null, mp_access_token: null, mp_public_key: null })
}
