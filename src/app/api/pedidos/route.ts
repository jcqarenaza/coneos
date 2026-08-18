import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { device_token } = await request.json()

  if (!device_token) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: dispositivo, error } = await supabase
    .from('dispositivos')
    .select('id, nombre, tipo, activo, empresa_id, sucursal_id, sucursales(nombre, slug), empresas(nombre, slug)')
    .eq('device_token', device_token)
    .single()

  if (error || !dispositivo) {
    return NextResponse.json({ error: 'Dispositivo no encontrado' }, { status: 404 })
  }

  if (!dispositivo.activo) {
    return NextResponse.json({ error: 'Dispositivo inactivo' }, { status: 403 })
  }

  // Normalizar joins que Supabase puede devolver como array o como objeto
  const sucursales = Array.isArray(dispositivo.sucursales)
    ? dispositivo.sucursales[0]
    : dispositivo.sucursales
  const empresas = Array.isArray(dispositivo.empresas)
    ? dispositivo.empresas[0]
    : dispositivo.empresas

  return NextResponse.json({
    dispositivo: { ...dispositivo, sucursales, empresas }
  })
}
