import { createClient, SupabaseClient } from '@supabase/supabase-js';

function requireAnonEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }
  return { url, key };
}

// Browser-side client. Used by the Realtime subscription helper.
// Anon key is public (safe to ship). Reads are gated by RLS SELECT
// policies scoped to the `anon` role.
export function createBrowserClient(): SupabaseClient {
  const { url, key } = requireAnonEnv();
  return createClient(url, key);
}

// Server-side client (Server Components, Route Handlers). Uses the
// same anon key as the browser — no service-role secret involved, so
// nothing sensitive ships to Vercel. Session persistence is disabled
// because server functions are stateless.
export function createServerClient(): SupabaseClient {
  const { url, key } = requireAnonEnv();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
