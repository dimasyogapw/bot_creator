/**
 * npm run eval -- --bot <slug> [--concurrency 2] [--min-score 90]
 * Menjalankan semua test case sebuah bot dan mencetak hasil per kasus, skor, perbandingan dengan
 * run sebelumnya, dan tagihan. Memakai mesin yang sama dengan tab Evals (lib/evals/engine.ts).
 * Hasilnya tersimpan dan tampil juga di tab Evals. Hanya untuk dijalankan di server/Claude Code web.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createAdminClient } from "../lib/supabase/admin";
import { RESULT_COLUMNS, RUN_COLUMNS, runNext, startRun, type EvalResultRow, type EvalRunRow } from "../lib/evals/engine";
import { compareResults, diffSnapshots, scorePercent } from "../lib/evals/compare";
import type { Bot } from "../lib/db/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const usd = (n: number | string) => `$${Number(n).toFixed(4)}`;

async function main() {
  const slug = arg("bot");
  if (!slug) {
    console.error("Pemakaian: npm run eval -- --bot <slug> [--concurrency 2] [--min-score 90]");
    process.exit(2);
  }
  const concurrency = Math.max(1, Math.min(4, Number(arg("concurrency") ?? 2) || 2));
  const minScore = arg("min-score") !== undefined ? Number(arg("min-score")) : null;

  const db = createAdminClient();
  const { data: bot, error } = await db.from("bots").select("*").eq("slug", slug).maybeSingle<Bot>();
  if (error) throw error;
  if (!bot) {
    console.error(`Bot dengan slug "${slug}" tidak ditemukan.`);
    process.exit(2);
  }

  const started = await startRun(db, bot, "cli");
  if (!started.ok) {
    console.error(started.error);
    process.exit(started.resumeRunId ? 3 : 2);
  }
  console.log(`Bot: ${bot.name} (${bot.model})`);
  console.log(`Run ${started.runId}: ${started.total} kasus, ${started.runnable} dijalankan. Perkiraan biaya ${usd(started.estimatedCostUsd)}.\n`);

  let done = 0;
  const worker = async () => {
    for (;;) {
      const r = await runNext(db, started.runId);
      if (r.status === "finished") return;
      if (r.status === "busy") {
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      done++;
      const x = r.result;
      console.log(`[${done}/${started.runnable}] #${x.position} ${x.status.toUpperCase()}  ${x.case_input.slice(0, 70)}`);
      if (x.reason) console.log(`      ${x.reason}`);
      if (r.finished) return;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const { data: run } = await db.from("eval_runs").select(RUN_COLUMNS).eq("id", started.runId).single<EvalRunRow>();
  const { data: results } = await db.from("eval_results").select(RESULT_COLUMNS).eq("run_id", started.runId).order("position").returns<EvalResultRow[]>();
  if (!run) throw new Error("run tidak ditemukan");
  const score = scorePercent(run);

  console.log("\n=== Ringkasan ===");
  console.log(`Skor: ${score === null ? "-" : `${score}%`}  (${run.pass_count} lulus, ${run.fail_count} gagal, ${run.error_count} error, ${run.skipped_count} dilewati)`);

  const { data: prev } = await db
    .from("eval_runs")
    .select(RUN_COLUMNS)
    .eq("bot_id", bot.id)
    .eq("status", "done")
    .lt("created_at", run.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<EvalRunRow>();
  if (prev) {
    const prevScore = scorePercent(prev);
    const { data: prevResults } = await db.from("eval_results").select("case_id, case_input, status").eq("run_id", prev.id);
    const changes = compareResults(results ?? [], prevResults ?? []);
    console.log(`Run sebelumnya: ${prevScore === null ? "-" : `${prevScore}%`}${score !== null && prevScore !== null ? ` (selisih ${Math.round((score - prevScore) * 10) / 10} poin)` : ""}`);
    const diff = diffSnapshots(run.bot_snapshot, prev.bot_snapshot);
    console.log(`Pengaturan bot yang berbeda: ${diff.length ? diff.join(", ") : "tidak ada"}`);
    for (const c of changes) console.log(`  ${c.kind.toUpperCase()}: ${c.input.slice(0, 70)} (${c.from ?? "baru"} -> ${c.to})`);
  }
  console.log("\n=== Tagihan ===");
  console.log(`Jawaban bot ${usd(run.cost_bot_usd)} + juri ${usd(run.cost_judge_usd)} (${run.judge_model}) + latar belakang ${usd(run.cost_background_usd)} = ${usd(run.cost_usd)}`);
  console.log(`Link: /bots/${bot.id}/evals/${run.id}`);

  if (minScore !== null && (score === null || score < minScore)) {
    console.error(`\nSkor di bawah target ${minScore}%.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
