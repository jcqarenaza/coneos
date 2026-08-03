import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { operador_id, pin, dispositivo_id, sucursal_id, empresa_id } = await request.json()

  if (!operador_id || !pin) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: operador, error } = await supabase
    .from('operadores')
    .select('id, nombre, pin_hash, puede_cobrar, puede_preparar, activo, sucursal_id')
    .eq('id', operador_id)
    .eq('empresa_id', empresa_id)
    .single()

  if (error || !operador) {
    return NextResponse.json({ error: 'Operador no encontrado' }, { status: 404 })
  }

  if (!operador.activo) {
    return NextResponse.json({ error: 'Operador inactivo' }, { status: 403 })
  }

  const pinValido = await bcrypt.compare(pin, operador.pin_hash)
  if (!pinValido) {
    return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 })
  }

  // Cerrar sesiones activas anteriores del mismo operador en este dispositivo
  await supabase
    .from('operator_sessions')
    .update({ estado: 'CERRADA', fin: new Date().toISOString() })
    .eq('operador_id', operador_id)
    .eq('dispositivo_id', dispositivo_id)
    .eq('estado', 'ACTIVA')

  // Crear nueva sesión
  const { data: session } = await supabase
    .from('operator_sessions')
    .insert({
      operador_id: operador.id,
      dispositivo_id,
      sucursal_id,
      empresa_id,
      estado: 'ACTIVA',
    })
    .select('id')
    .single()

  return NextResponse.json({
    session_id: session?.id,
    operador: {
      id: operador.id,
      nombre: operador.nombre,
      puede_cobrar: operador.puede_cobrar,
      puede_preparar: operador.puede_preparar,
    }
  })
}
