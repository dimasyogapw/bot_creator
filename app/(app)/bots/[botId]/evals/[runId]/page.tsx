import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Delta } from "@/components/evals/evals-manager";
import { RunRunner } from "@/components/evals/run-runner";
import { compareResults, diffSnapshots, scorePercent, type ChangeKind } from "@/lib/evals/compare";
import { RESULT_COLUMNS, RUN_COLUMNS, type EvalResultRow, type EvalRunRow } from "@/lib/evals/engine";
import { formatDateTime } from "@/lib/conversations/labels";
import { formatInt, formatSeconds, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS: Record<EvalResultRow["status"], { label: string; className: string }> = {
  pass: { label: "Lulus", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  fail: { label: "Gagal", className: "bg-destructive/10 text-destructive" },
  error: { label: "Error", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  skipped: { label: "Dilewati", className: "bg-muted text-muted-foreground" },
  pending: { label: "Menunggu", className: "bg-muted text-muted-foreground" },
  running: { label: "Berjalan", className: "bg-primary/10 text-primary" },
};

const CHANGE_LABEL: Record<ChangeKind, string> = { improved: "Membaik", regressed: "Memburuk", changed: "Berubah", new: "Kasus baru" };

export default async function EvalRunPage({ params }: { params: Promise<{ botId: string; runId: string }> }) {
  const { botId, runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) notFound();
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);

  const { data: run } = await supabase.from("eval_runs").select(RUN_COLUMNS).eq("id", runId).eq("bot_id", bot.id).maybeSingle<EvalRunRow>();
  if (!run) notFound();
  const { data: resultRows, error } = await supabase.from("eval_results").select(RESULT_COLUMNS).eq("run_id", run.id).order("position", { ascending: true }).returns<EvalResultRow[]>();
  if (error) throw error;
  const results = resultRows ?? [];

  const { data: prev } = await supabase
    .from("eval_runs")
    .select(RUN_COLUMNS)
    .eq("bot_id", bot.id)
    .eq("status", "done")
    .lt("created_at", run.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<EvalRunRow>();
  const prevResults = prev
    ? ((await supabase.from("eval_results").select("case_id, case_input, status").eq("run_id", prev.id).returns<{ case_id: string | null; case_input: string; status: string }[]>()).data ?? [])
    : [];

  const score = scorePercent(run);
  const prevScore = prev ? scorePercent(prev) : null;
  const delta = score !== null && prevScore !== null ? Math.round((score - prevScore) * 10) / 10 : null;
  const changes = prev ? compareResults(results, prevResults) : [];
  const settingsChanged = prev ? diffSnapshots(run.bot_snapshot, prev.bot_snapshot) : [];
  const finishedCount = run.pass_count + run.fail_count + run.error_count + run.skipped_count;
  const graded = run.total - run.skipped_count;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <Link href={`/bots/${bot.id}/evals`} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
        <ChevronLeft className="size-4" /> Kembali ke Evals
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Run eval, {formatDateTime(run.created_at)}</h2>
        <Badge variant={run.status === "running" ? "outline" : "secondary"}>{run.status === "running" ? "berjalan" : "selesai"}</Badge>
        {run.source === "cli" && <Badge variant="outline">CLI</Badge>}
      </div>

      {run.status === "running" && (
        <div className="mb-4">
          <RunRunner botId={bot.id} runId={run.id} initialDone={finishedCount} total={run.total} />
        </div>
      )}

      <section aria-label="Ringkasan run" className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Skor</p>
          <p className="mt-1 flex items-baseline gap-2 text-2xl font-semibold tabular-nums" data-testid="run-score">
            {score === null ? "-" : `${score}%`}
            <Delta value={delta} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="run-counts">
            {run.pass_count} lulus, {run.fail_count} gagal
            {run.error_count > 0 ? `, ${run.error_count} error` : ""}
            {run.skipped_count > 0 ? `, ${run.skipped_count} dilewati` : ""} (dari {graded} yang dinilai)
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Target 90% atau lebih</p>
        </div>
        <div className="rounded-xl border p-4 sm:col-span-2">
          <p className="text-xs text-muted-foreground">Tagihan run ini</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="run-total-cost">
            {formatUsd(run.cost_usd)}
          </p>
          <dl className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div>
              <dt>Jawaban bot</dt>
              <dd className="font-medium text-foreground tabular-nums" data-testid="run-cost-bot">
                {formatUsd(run.cost_bot_usd)}
              </dd>
            </div>
            <div>
              <dt>Juri ({run.judge_model})</dt>
              <dd className="font-medium text-foreground tabular-nums" data-testid="run-cost-judge">
                {formatUsd(run.cost_judge_usd)}
              </dd>
            </div>
            <div>
              <dt>Latar belakang</dt>
              <dd className="font-medium text-foreground tabular-nums" data-testid="run-cost-bg">
                {formatUsd(run.cost_background_usd)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {formatInt(run.tokens_in)} token masuk, {formatInt(run.tokens_out)} keluar (jawaban bot).
            {run.estimated_cost_usd != null && ` Perkiraan sebelum jalan: ${formatUsd(run.estimated_cost_usd)}.`} Latar belakang = memory, ringkasan, dan pencarian knowledge selama run.
          </p>
        </div>
      </section>

      {prev && run.status === "done" && (
        <section aria-labelledby="cmp-title" className="mt-6 rounded-xl border p-4" data-testid="run-compare">
          <h3 id="cmp-title" className="text-sm font-semibold">
            Dibanding run sebelumnya ({formatDateTime(prev.created_at)}, skor {prevScore === null ? "-" : `${prevScore}%`})
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {settingsChanged.length ? (
              <>
                Pengaturan bot yang berbeda: <span className="font-medium text-foreground">{settingsChanged.join(", ")}</span>.
              </>
            ) : (
              "Pengaturan bot sama dengan run sebelumnya."
            )}
          </p>
          {changes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Tidak ada kasus yang berubah hasilnya.</p>
          ) : (
            <ul className="mt-2 grid gap-1.5" aria-label="Kasus yang berubah">
              {changes.map((c) => (
                <li key={c.caseId} className="flex flex-wrap items-baseline gap-x-2 text-sm" data-testid="run-change">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-medium",
                      c.kind === "improved" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                      c.kind === "regressed" && "bg-destructive/10 text-destructive",
                      (c.kind === "changed" || c.kind === "new") && "bg-muted text-muted-foreground",
                    )}
                  >
                    {CHANGE_LABEL[c.kind]}
                  </span>
                  <span className="min-w-0 break-words">{c.input}</span>
                  <span className="text-xs text-muted-foreground">
                    ({c.from ? STATUS[c.from as EvalResultRow["status"]]?.label : "baru"} → {STATUS[c.to as EvalResultRow["status"]]?.label})
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Jawaban model bisa sedikit berbeda tiap kali. Jika satu kasus berubah tanpa Anda mengubah apa pun, jalankan ulang untuk memastikan.</p>
        </section>
      )}

      <section aria-labelledby="res-title" className="mt-6">
        <h3 id="res-title" className="mb-3 text-base font-semibold">
          Hasil per kasus
        </h3>
        <ul className="grid gap-2">
          {results.map((r) => {
            const total = Number(r.cost_bot_usd) + Number(r.cost_judge_usd) + Number(r.cost_background_usd);
            const st = STATUS[r.status];
            return (
              <li key={r.id} className="rounded-xl border p-3 sm:p-4" data-testid="eval-result" data-status={r.status}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium break-words whitespace-pre-wrap">
                    <span className="mr-1.5 text-muted-foreground">#{r.position}</span>
                    {r.case_input}
                  </p>
                  <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", st.className)} data-testid="result-status">
                    {st.label}
                  </span>
                </div>
                <p className="mt-1 text-sm break-words text-muted-foreground">
                  <span className="font-medium">Diharapkan:</span> {r.case_expected}
                </p>
                {r.reason && (
                  <p className="mt-2 text-sm break-words" data-testid="result-reason">
                    <span className="font-medium">{r.status === "skipped" ? "Alasan dilewati:" : r.status === "error" ? "Masalah:" : "Penilaian juri:"}</span> {r.reason}
                  </p>
                )}
                {r.answer && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Lihat jawaban bot</summary>
                    <p className="mt-1.5 rounded-lg bg-muted/50 p-3 break-words whitespace-pre-wrap">{r.answer}</p>
                  </details>
                )}
                {r.tools.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Skill dipakai: {r.tools.map((t) => `${t.label} (${t.ok ? "berhasil" : "gagal"}: ${t.summary})`).join("; ")}
                  </p>
                )}
                {r.status !== "pending" && r.status !== "running" && r.status !== "skipped" && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="result-cost-line">
                    <span>
                      Biaya <span className="font-medium text-foreground tabular-nums">{formatUsd(total)}</span> (bot {formatUsd(r.cost_bot_usd)}, juri {formatUsd(r.cost_judge_usd)}
                      {Number(r.cost_background_usd) > 0 ? `, latar belakang ${formatUsd(r.cost_background_usd)}` : ""})
                    </span>
                    {r.latency_ms != null && <span>{formatSeconds(r.latency_ms)}</span>}
                    {r.conversation_id && (
                      <Link href={`/bots/${bot.id}/conversations/${r.conversation_id}`} className="text-primary underline-offset-2 hover:underline">
                        Lihat percakapan
                      </Link>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
