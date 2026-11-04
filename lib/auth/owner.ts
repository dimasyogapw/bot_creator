import type { User } from "@supabase/supabase-js";

/**
 * Hanya akun yang dibuat lewat server (secret key) dengan app_metadata.role = "owner"
 * yang boleh masuk. app_metadata tidak bisa diubah oleh pengguna sendiri, jadi akun
 * hasil pendaftaran publik (jika lupa dimatikan di Supabase) tetap ditolak.
 */
export const OWNER_ROLE = "owner";

export function isOwner(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.role === OWNER_ROLE;
}
