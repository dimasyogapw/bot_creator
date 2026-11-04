"use client";

import { useEffect } from "react";
import { RetryButton } from "@/components/retry-button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Ada yang tidak beres</h1>
      <p className="mt-2 text-sm text-muted-foreground">Halaman ini gagal dimuat. Silakan coba lagi.</p>
      <RetryButton className="mt-6" onRetry={reset} />
    </main>
  );
}
