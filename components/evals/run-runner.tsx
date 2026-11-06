"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/format";

type StepReply =
  | { status: "ran"; finished: boolean; run: { total: number; pass_count: number; fail_count: number; error_count: number; skipped_count: number; cost_usd: number } }
  | { status: "busy" | "finished"; run?: { cost_usd: number } }
  | { error: string };

/**
 * Menjalankan kasus satu per satu (satu permintaan = satu kasus) selama run masih berjalan.
 * Aman ditutup: saat halaman dibuka lagi, run dilanjutkan dari kasus berikutnya.
 */
export function RunRunner({ botId, runId, initialDone, total }: { botId: string; runId: string; initialDone: number; total: number }) {
  const router = useRouter();
  const [done, setDone] = useState(initialDone);
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const loopId = useRef(0);

  const loop = useCallback(async () => {
    const id = ++loopId.current;
    setRunning(true);
    setError(null);
    let busyCount = 0;
    while (loopId.current === id) {
      let reply: StepReply;
      try {
        const res = await fetch(`/api/bots/${botId}/evals/runs/${runId}/step`, { method: "POST" });
        reply = (await res.json()) as StepReply;
        if (!res.ok && !("error" in reply)) reply = { error: "Langkah eval gagal." };
      } catch {
        reply = { error: "Koneksi terputus." };
      }
      if (loopId.current !== id) return;
      if ("error" in reply) {
        setError(`${reply.error} Tekan Lanjutkan untuk meneruskan.`);
        break;
      }
      if (reply.run) setCost(Number(reply.run.cost_usd));
      if (reply.status === "ran") {
        busyCount = 0;
        const r = reply.run;
        setDone(r.pass_count + r.fail_count + r.error_count + r.skipped_count);
        router.refresh();
        if (reply.finished) break;
      } else if (reply.status === "finished") {
        break;
      } else {
        // Kasus lain sedang dikerjakan pemanggil lain: tunggu sebentar.
        if (++busyCount > 40) {
          setError("Run tampak macet. Tekan Lanjutkan untuk mencoba lagi.");
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (loopId.current === id) {
      setRunning(false);
      router.refresh();
    }
  }, [botId, runId, router]);

  useEffect(() => {
    void loop();
    return () => {
      loopId.current++; // hentikan loop saat halaman ditinggalkan
    };
  }, [loop]);

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <section className="rounded-xl border p-4" aria-live="polite" data-testid="run-progress">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {running && <Loader2 className="mr-1.5 inline size-4 animate-spin" />}
          {done} dari {total} kasus selesai{cost !== null && <span className="text-muted-foreground"> · biaya sejauh ini {formatUsd(cost)}</span>}
        </p>
        {!running && (
          <Button size="sm" onClick={() => void loop()}>
            <Play /> Lanjutkan
          </Button>
        )}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progres eval">
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
