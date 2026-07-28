import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

let client: SupabaseClient<Database> | null = null

export function createClient() {
  if (client) return client
  client = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        storageKey: 'coneos-auth',
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    }
  )
  return client
}
