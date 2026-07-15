import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

const env = (import.meta as ImportMeta & { env?: ViteEnv }).env;
const url = env?.VITE_SUPABASE_URL;
const publishableKey = env?.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null = url && publishableKey
  ? createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const accountsConfigured = Boolean(supabase);
