"use client";
import * as React from "react";
import { Slider as P } from "radix-ui";
import { cn } from "@/lib/utils";

function Slider({ className, ...props }: React.ComponentProps<typeof P.Root>) {
  return (
    <P.Root className={cn("relative flex h-11 w-full touch-none items-center select-none sm:h-6", className)} {...props}>
      <P.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <P.Range className="absolute h-full bg-primary" />
      </P.Track>
      <P.Thumb
        aria-label="Nilai"
        className="block size-5 rounded-full border border-primary bg-background shadow-sm transition-shadow hover:ring-4 hover:ring-ring/30 focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
    </P.Root>
  );
}

export { Slider };
