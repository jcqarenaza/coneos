import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// API pública (kiosk/delivery anónimos): NUNCA devolver credenciales.
// mp_access_token/mp_public_key se reemplazan por el booleano mp_configurado.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sucursal_id = searchParams.get('sucursal_id')

  if (!sucursal_id) return NextResponse.json({ error: 'sucursal_id requerido' }, { status: 400 })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('sucursal_pagos')
    .select('acepta_efectivo, acepta_transferencia, acepta_mp, acepta_mp_kiosk, acepta_mp_delivery, cbu_transferencia, titular_transferencia')
    .eq('sucursal_id', sucursal_id)
    .single()

  if (!data) {
    return NextResponse.json({ acepta_efectivo: true, acepta_transferencia: false, acepta_mp: false, acepta_mp_kiosk: false, acepta_mp_delivery: false, cbu_transferencia: null, titular_transferencia: null })
  }
  return NextResponse.json(data)
}
