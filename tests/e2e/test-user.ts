import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

export const STATE_FILE = path.join(__dirname, ".test-user.json");

/** Akun sementara khusus test (bukan akun owner). Dihapus otomatis di teardown, data ikut terhapus. */
export function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function readTestUser(): { id: string; email: string; password: string } {
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}
