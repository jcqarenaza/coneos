import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { pin } = await request.json()

  if (!pin || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN inválido' }, { status: 400 })
  }

  const saltRounds = parseInt(process.env.PIN_SALT_ROUNDS ?? '10')
  const hash = await bcrypt.hash(pin, saltRounds)

  return NextResponse.json({ hash })
}
