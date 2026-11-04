import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { login } from "@/lib/auth/actions";
import { ownerExists } from "@/lib/supabase/admin";

export const metadata = { title: "Masuk | Bot Creator" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let hasOwner = true;
  try {
    hasOwner = await ownerExists();
  } catch (e) {
    console.error("[login] gagal cek owner", e);
  }
  return (
    <>
      <h1 className="text-xl font-semibold">Masuk</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Dashboard khusus pemilik.</p>
      <AuthForm action={login} mode="login" />
      {!hasOwner && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Belum ada akun owner.{" "}
          <Link href="/setup" className="font-medium text-primary underline-offset-4 hover:underline">
            Buat sekarang
          </Link>
        </p>
      )}
    </>
  );
}
