/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

export function BotAvatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-sm font-semibold text-primary",
        className,
      )}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initials || "B"}
    </span>
  );
}
