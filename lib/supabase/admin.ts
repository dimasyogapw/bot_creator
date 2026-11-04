import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Client dengan secret key (melewati RLS). Hanya untuk server dan hanya dengan
 * pengecekan eksplisit. Di fase 1 dipakai untuk membuat akun owner pertama.
 */
export function createAdminClient(): SupabaseClient {
  const env = z
    .object({ NEXT_PUBLIC_SUPABASE_URL: z.string().url(), SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_") })
    .parse(process.env);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function ownerExists(): Promise<boolean> {
  const { data, error } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw error;
  return data.users.length > 0;
}
