import { NextResponse } from 'next/server'

export async function GET() {
  const hora = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit', hour12: false
  })
  return NextResponse.json({ hora })
}
