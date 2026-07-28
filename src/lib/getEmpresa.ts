import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

// Lee el token de localStorage (client-side) o cookie (server-side)
// Para server components usamos el admin client con el token del header

export function getSupabaseClient(accessToken: string) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    }
  )
}

export function parseTokenFromCookie(cookieValue: string): string {
  const raw = cookieValue
  const jsonStr = raw.startsWith('base64-')
    ? Buffer.from(raw.replace('base64-', ''), 'base64').toString('utf-8')
    : raw
  const parsed = JSON.parse(jsonStr)
  return parsed.access_token
}
