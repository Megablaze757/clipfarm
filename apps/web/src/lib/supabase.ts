import { createClient } from '@supabase/supabase-js'

// PocketAthlete's Supabase project — Clipper shares it (same accounts). The publishable key is safe in client code;
// row-level security is what protects the data.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://txqhstackgidjqkkrzyj.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_kr26XwyR0HZxS3HR3UJI2Q_YLLT7Sfl'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
