import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { setupOwner } from "@/lib/auth/actions";
import { ownerExists } from "@/lib/supabase/admin";

export const metadata = { title: "Buat akun owner | Bot Creator" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await ownerExists()) redirect("/login");
  return (
    <>
      <h1 className="text-xl font-semibold">Buat akun owner</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Hanya bisa dilakukan sekali, dan hanya untuk email owner yang sudah ditentukan.
      </p>
      <AuthForm action={setupOwner} mode="setup" />
    </>
  );
}
