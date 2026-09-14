import { supabase } from './supabase.js'

// The only account allowed into the app. The frontend uses this for UX only —
// the authoritative gate is the Supabase RLS policy on every table.
export const ALLOWED_EMAIL = (
  import.meta.env.VITE_ALLOWED_EMAIL || 'avnamer@gmail.com'
).toLowerCase()

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
}

export function signOut() {
  return supabase.auth.signOut()
}
