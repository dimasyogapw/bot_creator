"use client";

import { FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Citation } from "@/lib/db/types";
import { pagesLabel } from "@/lib/knowledge/format";

/** Chip sumber di bawah jawaban. Klik untuk melihat kutipan dokumen yang dipakai. */
export function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Sumber jawaban">
      {citations.map((c) => (
        <Dialog key={c.n}>
          <DialogTrigger asChild>
            <button
              type="button"
              data-testid="citation-chip"
              className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-7"
            >
              <span className="font-semibold text-primary">[{c.n}]</span>
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{c.title}</span>
              {c.pages?.length ? <span className="shrink-0">· {pagesLabel(c.pages)}</span> : null}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="pr-8">
                [{c.n}] {c.title}
              </DialogTitle>
              <DialogDescription>{c.pages?.length ? `Kutipan dari ${pagesLabel(c.pages)}` : "Kutipan yang dipakai bot"}</DialogDescription>
            </DialogHeader>
            <blockquote className="max-h-[60dvh] overflow-y-auto rounded-lg border-l-2 border-primary bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {c.snippet}
            </blockquote>
          </DialogContent>
        </Dialog>
      ))}
    </div>
  );
}
