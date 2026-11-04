"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthState } from "@/lib/auth/actions";

export function AuthForm({
  action,
  mode,
  defaultEmail,
}: {
  action: (s: AuthState, f: FormData) => Promise<AuthState>;
  mode: "login" | "setup";
  defaultEmail?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={defaultEmail} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "setup" ? 10 : undefined}
        />
      </div>
      {mode === "setup" && (
        <div className="grid gap-2">
          <Label htmlFor="confirm">Ulangi password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
      )}
      {state?.error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {mode === "login" ? "Masuk" : "Buat akun owner"}
      </Button>
    </form>
  );
}
