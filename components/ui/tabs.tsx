import Link from "next/link";
import { cn } from "@/lib/utils";

/** Tab berbasis link (setiap tab adalah halaman sendiri). */
export function TabLinks({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav aria-label="Bagian bot" className="-mb-px flex gap-1 overflow-x-auto">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            t.key === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
