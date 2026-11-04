"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, ownerExists } from "@/lib/supabase/admin";
import { isOwner, OWNER_ROLE } from "./owner";

export type AuthState = { error?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    console.error("[auth] login gagal", error.message);
    return { error: "Email atau password salah." };
  }
  if (!isOwner(data.user)) {
    await supabase.auth.signOut();
    console.error("[auth] login ditolak: akun bukan owner", data.user?.id);
    return { error: "Akun ini tidak punya akses ke dashboard." };
  }
  redirect("/");
}

const setupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Email tidak valid"),
    password: z.string().min(10, "Password minimal 10 karakter"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Konfirmasi password tidak sama", path: ["confirm"] });

/** Membuat akun owner pertama. Hanya bisa sekali, dan hanya untuk OWNER_EMAIL. */
export async function setupOwner(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return { error: "OWNER_EMAIL belum diisi di pengaturan server." };
  if (parsed.data.email !== ownerEmail) return { error: "Email ini tidak terdaftar sebagai owner." };

  try {
    if (await ownerExists()) return { error: "Akun owner sudah ada. Silakan login." };
    const { error } = await createAdminClient().auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      app_metadata: { role: OWNER_ROLE },
    });
    if (error) throw error;
  } catch (e) {
    console.error("[auth] gagal membuat owner", e);
    return { error: "Gagal membuat akun. Silakan coba lagi." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) redirect("/login");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
