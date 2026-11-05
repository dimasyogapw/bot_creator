"use client";

import { useState, useTransition } from "react";
import { Check, Hand, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveHandoff } from "@/lib/skills/actions";
import { formatDateTime } from "@/lib/conversations/labels";

export interface HandoffItem {
  id: string;
  reason: string;
  summary: string | null;
  status: "open" | "resolved";
  created_at: string;
}

export function HandoffBanner({ botId, items }: { botId: string; items: HandoffItem[] }) {
  const [list, setList] = useState(items);
  const [pending, start] = useTransition();
  if (!list.length) return null;
  return (
    <ul className="grid gap-2" aria-label="Permintaan bantuan manusia">
      {list.map((h) => (
        <li
          key={h.id}
          data-testid="handoff-item"
          data-status={h.status}
          className={h.status === "open" ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" : "rounded-lg border p-3 text-sm text-muted-foreground"}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                <Hand className="size-4" /> {h.status === "open" ? "Pengguna butuh bantuan manusia" : "Bantuan manusia (selesai)"}
              </p>
              <p className="mt-1">Alasan: {h.reason}</p>
              {h.summary && <p className="mt-0.5">Ringkasan: {h.summary}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(h.created_at)}</p>
            </div>
            {h.status === "open" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await resolveHandoff(botId, h.id);
                    if (!r.ok) return void toast.error(r.error);
                    setList((l) => l.map((x) => (x.id === h.id ? { ...x, status: "resolved" } : x)));
                    toast.success("Ditandai selesai");
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : <Check />} Tandai selesai
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
