import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { z } from "zod";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import { BarChart } from "@/components/analytics/bar-chart";
import { Delta } from "@/components/evals/evals-manager";
import { ALLOWED_RANGES, normalizeRow, summarize } from "@/lib/analytics";
import { scorePercent } from "@/lib/evals/compare";
import { formatDateTime } from "@/lib/conversations/labels";
import { formatInt, formatSeconds, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const qSchema = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).catch(30) });

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ botId }, sp] = await Promise.all([params, searchParams]);
  const { days } = qSchema.parse(sp);
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);

  const [{ data, error }, firstUsage, lastEval] = await Promise.all([
    supabase.rpc("bot_analytics", { p_bot_id: bot.id, p_days: days }),
    supabase.from("llm_usage").select("created_at").eq("bot_id", bot.id).order("created_at", { ascending: true }).limit(1).maybeSingle<{ created_at: string }>(),
    supabase
      .from("eval_runs")
      .select("total, pass_count, skipped_count, created_at")
      .eq("bot_id", bot.id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(2)
      .returns<{ total: number; pass_count: number; skipped_count: number; created_at: string }[]>(),
  ]);
  if (error) console.error("[analytics] gagal memuat", error);

  const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeRow);
  const s = summarize(rows);
  const evalRuns = lastEval.data ?? [];
  const evalScore = evalRuns[0] ? scorePercent(evalRuns[0]) : null;
  const prevScore = evalRuns[1] ? scorePercent(evalRuns[1]) : null;
  const empty = !error && s.conversations === 0 && s.answers === 0 && s.costEval === 0 && s.costBackground === 0;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <nav aria-label="Rentang waktu" className="mb-4 flex flex-wrap items-center gap-2">
        {/* Tautan biasa (muat ulang), bukan <Link>, mengikuti pola filter di tab Percakapan. */}
        {ALLOWED_RANGES.map((d) => (
          <a
            key={d}
            href={`/bots/${bot.id}/analytics?days=${d}`}
            aria-current={d === days ? "true" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-full border px-3 text-sm transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8",
              d === days ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {d} hari
          </a>
        ))}
        <span className="text-xs text-muted-foreground">Per hari menurut WIB. Termasuk pemakaian Playground, tidak termasuk percakapan eval.</span>
      </nav>

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Data analitik gagal dimuat.</p>
          <a href={`/bots/${bot.id}/analytics?days=${days}`} className="mt-3 inline-block underline">
            Coba lagi
          </a>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <BarChart3 className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Belum ada data dalam {days} hari terakhir</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Coba ngobrol dengan bot di Playground, lalu buka halaman ini lagi.</p>
          <Link href={`/bots/${bot.id}/playground`} className="mt-3 text-sm text-primary underline-offset-2 hover:underline">
            Buka Playground
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          <section aria-label="Ringkasan" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card label="Percakapan" value={formatInt(s.conversations)} testId="a-conversations" />
            <Card label="Jawaban bot" value={formatInt(s.answers)} testId="a-answers" />
            <Card label="Token masuk" value={formatInt(s.tokensIn)} testId="a-tokens-in" />
            <Card label="Token keluar" value={formatInt(s.tokensOut)} testId="a-tokens-out" />
            <Card label="Biaya jawaban" value={formatUsd(s.costAnswers)} hint="sama dengan jumlah biaya di tabel pesan" testId="a-cost-answers" />
            <Card
              label="Biaya latar belakang"
              value={formatUsd(s.costBackground)}
              hint={firstUsage.data ? `memory, ringkasan, pencarian. Tercatat sejak ${formatDateTime(firstUsage.data.created_at)}` : "memory, ringkasan, pencarian. Belum ada yang tercatat"}
              testId="a-cost-bg"
            />
            <Card label="Biaya eval" value={formatUsd(s.costEval)} hint="terpisah dari biaya chat" testId="a-cost-eval" />
            <Card label="Biaya rata-rata per percakapan" value={s.avgCostPerConversation === null ? "-" : formatUsd(s.avgCostPerConversation)} hint="jawaban + latar belakang" testId="a-cost-per-conv" />
            <Card label="Latensi rata-rata" value={s.avgLatencyMs === null ? "-" : formatSeconds(s.avgLatencyMs)} hint="sampai jawaban selesai" testId="a-latency" />
            <Card label="Token pertama rata-rata" value={s.avgTtftMs === null ? "-" : formatSeconds(s.avgTtftMs)} hint="target di bawah 3 dtk" testId="a-ttft" />
            <Card
              label="Jempol"
              value={s.thumbsUpRatio === null ? "-" : `${s.thumbsUpRatio}% positif`}
              hint={`${s.thumbsUp} atas, ${s.thumbsDown} bawah`}
              testId="a-thumbs"
            />
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Skor eval terakhir</p>
              <p className="mt-1 flex items-baseline gap-2 text-2xl font-semibold tabular-nums" data-testid="a-eval-score">
                {evalScore === null ? "-" : `${evalScore}%`}
                {evalScore !== null && prevScore !== null && <Delta value={Math.round((evalScore - prevScore) * 10) / 10} />}
              </p>
              <Link href={`/bots/${bot.id}/evals`} className="mt-0.5 inline-block text-xs text-primary underline-offset-2 hover:underline">
                Buka Evals
              </Link>
            </div>
          </section>

          <BarChart
            testId="chart-cost"
            title="Biaya per hari (USD)"
            format={formatUsd}
            series={[
              { key: "answers", label: "Jawaban", fill: "fill-primary", swatch: "bg-primary" },
              { key: "background", label: "Latar belakang", fill: "fill-primary/50", swatch: "bg-primary/50" },
              { key: "eval", label: "Eval", fill: "fill-muted-foreground/60", swatch: "bg-muted-foreground/60" },
            ]}
            data={rows.map((r) => ({ day: r.day, values: { answers: r.cost_answers, background: r.cost_background, eval: r.cost_eval } }))}
          />
          <BarChart
            testId="chart-answers"
            title="Jawaban bot per hari"
            format={(n) => formatInt(n)}
            series={[{ key: "answers", label: "Jawaban", fill: "fill-primary", swatch: "bg-primary" }]}
            data={rows.map((r) => ({ day: r.day, values: { answers: r.answers } }))}
          />
        </div>
      )}
    </main>
  );
}

function Card({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl" data-testid={testId}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
