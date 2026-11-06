import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import { getLlmConfig } from "@/lib/llm/provider";
import { EvalsManager, type CaseView, type RunView } from "@/components/evals/evals-manager";
import { estimateRunCost, scorePercent } from "@/lib/evals/compare";
import { RUN_COLUMNS, skipReason, type EvalRunRow } from "@/lib/evals/engine";
import { MAX_EVAL_CASES } from "@/lib/evals/schema";

export const dynamic = "force-dynamic";

export default async function EvalsPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);

  const [casesRes, runsRes, spendRes] = await Promise.all([
    supabase
      .from("eval_cases")
      .select("id, input, expected_behavior, tags, setup, new_conversation")
      .eq("bot_id", bot.id)
      .order("created_at", { ascending: true })
      .returns<CaseView[]>(),
    supabase.from("eval_runs").select(RUN_COLUMNS).eq("bot_id", bot.id).order("created_at", { ascending: false }).limit(30).returns<EvalRunRow[]>(),
    supabase.from("eval_runs").select("cost_usd, created_at").eq("bot_id", bot.id).returns<{ cost_usd: number; created_at: string }[]>(),
  ]);
  if (casesRes.error) console.error("[evals] gagal memuat kasus", casesRes.error);
  if (runsRes.error) console.error("[evals] gagal memuat run", runsRes.error);
  const cases = casesRes.data ?? [];
  const runRows = runsRes.data ?? [];

  // Selisih skor terhadap run selesai sebelumnya.
  const doneRuns = runRows.filter((r) => r.status === "done");
  const runs: RunView[] = runRows.map((r) => {
    const score = r.status === "done" ? scorePercent(r) : null;
    const prev = doneRuns.find((p) => p.created_at < r.created_at);
    const prevScore = prev ? scorePercent(prev) : null;
    return {
      id: r.id,
      created_at: r.created_at,
      status: r.status,
      total: r.total,
      pass_count: r.pass_count,
      fail_count: r.fail_count,
      error_count: r.error_count,
      skipped_count: r.skipped_count,
      cost_usd: Number(r.cost_usd),
      score,
      delta: score !== null && prevScore !== null ? Math.round((score - prevScore) * 10) / 10 : null,
    };
  });

  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const spendRows = spendRes.data ?? [];
  const spend = {
    last30: spendRows.filter((r) => new Date(r.created_at).getTime() >= since).reduce((s, r) => s + Number(r.cost_usd), 0),
    all: spendRows.reduce((s, r) => s + Number(r.cost_usd), 0),
    runs: spendRows.length,
  };

  const skipped = cases.filter((c) => skipReason({ tags: c.tags, new_conversation: c.new_conversation }, bot)).length;
  const lastDone = doneRuns[0];
  const est = estimateRunCost(lastDone ? { cost_usd: Number(lastDone.cost_usd), total: lastDone.total, skipped_count: lastDone.skipped_count } : null, cases.length - skipped);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <EvalsManager
        key={bot.id}
        botId={bot.id}
        cases={cases}
        runs={runs}
        spend={spend}
        estimate={{ usd: est.usd, basis: est.basis, runnable: cases.length - skipped, skipped }}
        judgeModel={getLlmConfig().LLM_JUDGE_MODEL}
        maxCases={MAX_EVAL_CASES}
      />
    </main>
  );
}
