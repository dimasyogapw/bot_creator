"use client";

import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RetryButton({ className, onRetry }: { className?: string; onRetry?: () => void }) {
  const router = useRouter();
  return (
    <Button variant="outline" className={className} onClick={() => (onRetry ? onRetry() : router.refresh())}>
      <RotateCw /> Coba lagi
    </Button>
  );
}
