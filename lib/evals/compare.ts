/** Fungsi murni untuk membandingkan dua run eval. */

export interface RunScoreInput {
  total: number;
  pass_count: number;
  skipped_count: number;
}

/** Skor dalam persen (0 sampai 100). Kasus yang dilewati tidak dihitung. Null jika tidak ada kasus yang dinilai. */
export function scorePercent(r: RunScoreInput): number | null {
  const graded = r.total - r.skipped_count;
  if (graded <= 0) return null;
  return Math.round((r.pass_count / graded) * 1000) / 10;
}

export interface ResultLite {
  case_id: string | null;
  case_input: string;
  status: string;
}

export type ChangeKind = "improved" | "regressed" | "changed" | "new";

export interface ResultChange {
  caseId: string;
  input: string;
  from: string | null;
  to: string;
  kind: ChangeKind;
}

const GOOD = new Set(["pass"]);

/** Kasus yang statusnya berbeda dari run sebelumnya (dicocokkan lewat case_id). */
export function compareResults(current: ResultLite[], previous: ResultLite[]): ResultChange[] {
  const prev = new Map(previous.filter((p) => p.case_id).map((p) => [p.case_id as string, p]));
  const out: ResultChange[] = [];
  for (const c of current) {
    if (!c.case_id) continue;
    const p = prev.get(c.case_id);
    if (!p) {
      out.push({ caseId: c.case_id, input: c.case_input, from: null, to: c.status, kind: "new" });
      continue;
    }
    if (p.status === c.status) continue;
    const kind: ChangeKind = !GOOD.has(p.status) && GOOD.has(c.status) ? "improved" : GOOD.has(p.status) && !GOOD.has(c.status) ? "regressed" : "changed";
    out.push({ caseId: c.case_id, input: c.case_input, from: p.status, to: c.status, kind });
  }
  return out;
}

export interface BotSnapshot {
  system_prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  memory_enabled?: boolean;
}

const SNAPSHOT_LABELS: Record<keyof BotSnapshot, string> = {
  system_prompt: "Instruksi bot (system prompt)",
  model: "Model",
  temperature: "Suhu (temperature)",
  max_tokens: "Batas token",
  memory_enabled: "Memory",
};

/** Daftar pengaturan bot yang berbeda antara dua run. */
export function diffSnapshots(current: BotSnapshot | null | undefined, previous: BotSnapshot | null | undefined): string[] {
  if (!current || !previous) return [];
  return (Object.keys(SNAPSHOT_LABELS) as (keyof BotSnapshot)[]).filter((k) => current[k] !== previous[k]).map((k) => SNAPSHOT_LABELS[k]);
}

/** Perkiraan biaya kasar per kasus bila belum ada run sebelumnya (bot murah + juri Sonnet). */
export const FALLBACK_COST_PER_CASE_USD = 0.008;

export function estimateRunCost(previous: { cost_usd: number; total: number; skipped_count: number } | null, runnableCases: number): { usd: number; basis: "run_sebelumnya" | "perkiraan_kasar" } {
  if (previous) {
    const ran = previous.total - previous.skipped_count;
    if (ran > 0) return { usd: Math.round((previous.cost_usd / ran) * runnableCases * 1e6) / 1e6, basis: "run_sebelumnya" };
  }
  return { usd: Math.round(FALLBACK_COST_PER_CASE_USD * runnableCases * 1e6) / 1e6, basis: "perkiraan_kasar" };
}
