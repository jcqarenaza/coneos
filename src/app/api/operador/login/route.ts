import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { operador_id, pin, dispositivo_id, sucursal_id, empresa_id } = await request.json()

  if (!operador_id || !pin) {
    return NextResponse.json({ error: 'Datos requeridos' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Verificar PIN con pgcrypto
  const { data: operador } = await supabase
    .from('operadores')
    .select('id, nombre, pin_hash, puede_cobrar, puede_preparar, activo, sucursal_id')
    .eq('id', operador_id)
    .eq('empresa_id', empresa_id)
    .single()

  if (!operador || !operador.activo) {
    return NextResponse.json({ error: 'Operador no encontrado' }, { status: 401 })
  }

  // Verificar PIN con pgcrypto en Supabase
  const { data: pinValido } = await supabase.rpc('verificar_pin_operador', {
    p_pin: pin,
    p_hash: operador.pin_hash,
  })

  if (!pinValido) {
    return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 })
  }

  // Crear sesión — EQUIPO V1 (H1, orden CTO 24/09): la tabla gobierna por
  // `estado` text ('ACTIVA'/'CERRADA') + inicio/fin; la columna `activa` que
  // se insertaba acá NO EXISTE → el insert fallaba mudo y las sesiones nunca
  // se registraban (nadie lo notó porque las pantallas solo usan `operador`).
  // El logout ya hablaba el idioma correcto; el desalineado era este insert.
  const { data: sesion } = await supabase
    .from('operator_sessions')
    .insert({
      operador_id: operador.id,
      dispositivo_id,
      sucursal_id,
      empresa_id,
      estado: 'ACTIVA',
      inicio: new Date().toISOString(),
    })
    .select('id')
    .single()

  return NextResponse.json({
    session_id: sesion?.id,
    operador: {
      id: operador.id,
      nombre: operador.nombre,
      puede_cobrar: operador.puede_cobrar,
      puede_preparar: operador.puede_preparar,
      sucursal_id: operador.sucursal_id,
    },
  })
}
