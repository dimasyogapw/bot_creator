import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runBot } from "@/lib/bot/runBot";
import { getLlmConfig } from "@/lib/llm/provider";
import type { Bot, Citation, Message, ToolCallRecord } from "@/lib/db/types";
import { judgeAnswer } from "./judge";
import { estimateRunCost, fallbackCostPerCase, type BotSnapshot } from "./compare";

/**
 * Mesin eval. Satu run = banyak kasus; satu langkah (runNext) = satu kasus.
 * Dipakai tab Evals (lewat route yang dipanggil berulang oleh browser) dan CLI (npm run eval).
 * Kasus dijalankan lewat runBot yang sama dengan channel lain (channel "eval").
 */

/** Kasus yang macet "berjalan" lebih dari ini boleh diambil ulang. */
export const STALE_RUNNING_MS = 3 * 60 * 1000;
/** Run yang masih berjalan dan baru dibuat dalam rentang ini mencegah run baru (hindari belanja ganda). */
export const ACTIVE_RUN_WINDOW_MS = 60 * 60 * 1000;

export interface EvalCaseRow {
  id: string;
  bot_id: string;
  input: string;
  expected_behavior: string;
  tags: string[];
  setup: string[];
  new_conversation: boolean;
}

export interface EvalResultRow {
  id: string;
  run_id: string;
  case_id: string | null;
  position: number;
  case_input: string;
  case_expected: string;
  case_tags: string[];
  status: "pending" | "running" | "pass" | "fail" | "error" | "skipped";
  reason: string | null;
  answer: string | null;
  tools: Pick<ToolCallRecord, "name" | "type" | "label" | "ok" | "summary" | "detail">[];
  citations_count: number;
  conversation_id: string | null;
  cost_bot_usd: number;
  cost_judge_usd: number;
  cost_background_usd: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number | null;
}

export interface EvalRunRow {
  id: string;
  bot_id: string;
  status: "running" | "done";
  source: "app" | "cli";
  judge_model: string;
  bot_snapshot: BotSnapshot;
  total: number;
  pass_count: number;
  fail_count: number;
  error_count: number;
  skipped_count: number;
  estimated_cost_usd: number | null;
  cost_bot_usd: number;
  cost_judge_usd: number;
  cost_background_usd: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
  finished_at: string | null;
}

export const RUN_COLUMNS =
  "id, bot_id, status, source, judge_model, bot_snapshot, total, pass_count, fail_count, error_count, skipped_count, estimated_cost_usd, cost_bot_usd, cost_judge_usd, cost_background_usd, cost_usd, tokens_in, tokens_out, created_at, finished_at";
export const RESULT_COLUMNS =
  "id, run_id, case_id, position, case_input, case_expected, case_tags, status, reason, answer, tools, citations_count, conversation_id, cost_bot_usd, cost_judge_usd, cost_background_usd, tokens_in, tokens_out, latency_ms";

const num = (v: unknown) => Number(v ?? 0);

export function snapshotOf(bot: Bot): BotSnapshot {
  return { system_prompt: bot.system_prompt, model: bot.model, temperature: Number(bot.temperature), max_tokens: bot.max_tokens, memory_enabled: bot.memory_enabled };
}

/** Kasus memory butuh memory aktif; tanpa itu hasilnya pasti menyesatkan, jadi dilewati. */
export function skipReason(c: Pick<EvalCaseRow, "tags" | "new_conversation">, bot: Pick<Bot, "memory_enabled">): string | null {
  if ((c.new_conversation || c.tags.includes("memory")) && !bot.memory_enabled)
    return "Memory bot ini sedang mati. Nyalakan di tab Memory agar kasus ini bisa dinilai.";
  return null;
}

export type StartResult =
  | { ok: true; runId: string; total: number; runnable: number; estimatedCostUsd: number }
  | { ok: false; error: string; resumeRunId?: string };

export async function startRun(db: SupabaseClient, bot: Bot, source: "app" | "cli"): Promise<StartResult> {
  const { data: cases, error: caseErr } = await db
    .from("eval_cases")
    .select("id, bot_id, input, expected_behavior, tags, setup, new_conversation")
    .eq("bot_id", bot.id)
    .order("created_at", { ascending: true })
    .returns<EvalCaseRow[]>();
  if (caseErr) {
    console.error("[eval] gagal memuat kasus", caseErr);
    return { ok: false, error: "Test case gagal dimuat. Coba lagi." };
  }
  if (!cases?.length) return { ok: false, error: "Belum ada test case. Tambahkan dulu." };

  // Cegah dua run berjalan bersamaan (hindari belanja ganda karena klik dua kali).
  const { data: active } = await db
    .from("eval_runs")
    .select("id, created_at")
    .eq("bot_id", bot.id)
    .eq("status", "running")
    .gt("created_at", new Date(Date.now() - ACTIVE_RUN_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (active) return { ok: false, error: "Masih ada run yang berjalan untuk bot ini.", resumeRunId: active.id };

  const skip = cases.map((c) => skipReason(c, bot));
  const runnable = skip.filter((s) => !s).length;
  const { data: prev } = await db
    .from("eval_runs")
    .select("cost_usd, total, skipped_count")
    .eq("bot_id", bot.id)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ cost_usd: number; total: number; skipped_count: number }>();
  const est = estimateRunCost(prev ? { cost_usd: num(prev.cost_usd), total: prev.total, skipped_count: prev.skipped_count } : null, runnable, fallbackCostPerCase(getLlmConfig().LLM_JUDGE_MODEL));

  const { data: run, error: runErr } = await db
    .from("eval_runs")
    .insert({
      bot_id: bot.id,
      source,
      judge_model: getLlmConfig().LLM_JUDGE_MODEL,
      bot_snapshot: snapshotOf(bot),
      total: cases.length,
      estimated_cost_usd: est.usd,
    })
    .select("id")
    .single<{ id: string }>();
  if (runErr || !run) {
    console.error("[eval] gagal membuat run", runErr);
    return { ok: false, error: "Run gagal dibuat. Coba lagi." };
  }
  const rows = cases.map((c, i) => ({
    run_id: run.id,
    case_id: c.id,
    position: i + 1,
    case_input: c.input,
    case_expected: c.expected_behavior,
    case_tags: c.tags,
    status: skip[i] ? "skipped" : "pending",
    reason: skip[i],
  }));
  const { error: resErr } = await db.from("eval_results").insert(rows);
  if (resErr) {
    console.error("[eval] gagal membuat hasil", resErr);
    await db.from("eval_runs").delete().eq("id", run.id);
    return { ok: false, error: "Run gagal dibuat. Coba lagi." };
  }
  await db.rpc("recompute_eval_run", { p_run_id: run.id });
  return { ok: true, runId: run.id, total: cases.length, runnable, estimatedCostUsd: est.usd };
}

export type StepResult =
  | { status: "ran"; result: EvalResultRow; finished: boolean }
  | { status: "busy" }
  | { status: "finished" };

/** Jalankan SATU kasus berikutnya yang belum dikerjakan. Aman dipanggil bersamaan (klaim atomik). */
export async function runNext(db: SupabaseClient, runId: string, signal?: AbortSignal): Promise<StepResult> {
  const { data: run } = await db.from("eval_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle<EvalRunRow>();
  if (!run) throw new Error("run tidak ditemukan");
  if (run.status === "done") return { status: "finished" };

  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data: cand } = await db
    .from("eval_results")
    .select("id, status, started_at, position")
    .eq("run_id", runId)
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${staleBefore})`)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; status: string; started_at: string | null }>();
  if (!cand) {
    const { count } = await db.from("eval_results").select("id", { count: "exact", head: true }).eq("run_id", runId).in("status", ["pending", "running"]);
    if ((count ?? 0) > 0) return { status: "busy" }; // sisanya sedang dikerjakan pemanggil lain
    await db.rpc("recompute_eval_run", { p_run_id: runId });
    return { status: "finished" };
  }

  // Klaim atomik: hanya satu pemanggil yang berhasil mengubah status ini.
  let claim = db.from("eval_results").update({ status: "running", started_at: new Date().toISOString() }).eq("id", cand.id).eq("status", cand.status);
  claim = cand.started_at ? claim.eq("started_at", cand.started_at) : claim.is("started_at", null);
  const { data: claimed } = await claim.select(RESULT_COLUMNS).maybeSingle<EvalResultRow>();
  if (!claimed) return { status: "busy" };

  const { data: bot } = await db.from("bots").select("*").eq("id", run.bot_id).maybeSingle<Bot>();
  let outcome: Partial<EvalResultRow>;
  if (!bot) outcome = { status: "error", reason: "Bot tidak ditemukan." };
  else {
    try {
      outcome = await executeCase(db, bot, run, claimed, signal);
    } catch (e) {
      console.error("[eval] kasus gagal dijalankan", claimed.id, e);
      outcome = { status: "error", reason: "Kasus gagal dijalankan karena gangguan tak terduga. Coba jalankan ulang." };
    }
  }

  const { data: saved, error: saveErr } = await db
    .from("eval_results")
    .update({ ...outcome, finished_at: new Date().toISOString() })
    .eq("id", claimed.id)
    .select(RESULT_COLUMNS)
    .single<EvalResultRow>();
  if (saveErr || !saved) throw saveErr ?? new Error("hasil tidak tersimpan");
  await db.rpc("recompute_eval_run", { p_run_id: runId });
  const { data: after } = await db.from("eval_runs").select("status").eq("id", runId).maybeSingle<{ status: string }>();
  return { status: "ran", result: saved, finished: after?.status === "done" };
}

interface Turn {
  conversationId: string | null;
  message: Message | null;
  error: string | null;
}

async function executeCase(db: SupabaseClient, bot: Bot, run: EvalRunRow, result: EvalResultRow, signal?: AbortSignal): Promise<Partial<EvalResultRow>> {
  if (!result.case_id) return { status: "error", reason: "Test case ini sudah dihapus sebelum dijalankan." };
  const { data: c } = await db
    .from("eval_cases")
    .select("id, bot_id, input, expected_behavior, tags, setup, new_conversation")
    .eq("id", result.case_id)
    .maybeSingle<EvalCaseRow>();
  if (!c) return { status: "error", reason: "Test case ini sudah dihapus sebelum dijalankan." };

  const turn = async (message: string, conversationId: string | null): Promise<Turn> => {
    const tasks: (() => Promise<void>)[] = [];
    const out: Turn = { conversationId, message: null, error: null };
    for await (const ev of runBot({
      db,
      botId: bot.id,
      conversationId,
      userMessage: message,
      channel: "eval",
      endUser: { externalId: result.id, displayName: `Eval #${result.position}` },
      defer: (t) => tasks.push(t),
      evalContext: { runId: run.id, resultId: result.id },
      signal,
    })) {
      if (ev.type === "start") out.conversationId = ev.conversationId;
      else if (ev.type === "done") out.message = ev.message;
      else if (ev.type === "error") out.error = ev.message;
    }
    // Memory dan ringkasan harus selesai sebelum langkah berikutnya (tes memory antar percakapan).
    for (const t of tasks) await t();
    return out;
  };

  const convIds = new Set<string>();
  let current: string | null = null;
  let last: Turn | null = null;
  const messages = [...c.setup, c.input];
  for (let i = 0; i < messages.length; i++) {
    const isFinal = i === messages.length - 1;
    const startNew = isFinal && c.new_conversation && c.setup.length > 0;
    last = await turn(messages[i], startNew ? null : current);
    if (last.conversationId) {
      convIds.add(last.conversationId);
      current = last.conversationId;
    }
    if (last.error || !last.message) {
      await cleanupEvalUser(db, bot.id, result.id);
      return await withCosts(db, result.id, [...convIds], {
        status: "error",
        reason: `Bot gagal menjawab${i < c.setup.length ? " pada pesan pendahuluan" : ""}: ${last.error ?? "tanpa jawaban"}`,
        conversation_id: current,
      });
    }
  }

  const msg = last!.message!;
  const tools = (msg.content.tools ?? []).map((t) => ({ name: t.name, type: t.type, label: t.label, ok: t.ok, summary: t.summary, detail: t.detail }));
  const citations: Citation[] = msg.content.citations ?? [];

  const verdict = await judgeAnswer(
    {
      systemPrompt: bot.system_prompt,
      setup: c.setup,
      newConversation: c.new_conversation,
      input: c.input,
      expected: c.expected_behavior,
      answer: msg.content.text,
      tools,
      citationTitles: [...new Set(citations.map((x) => x.title))],
    },
    { db, botId: bot.id, conversationId: current, evalRunId: run.id, evalResultId: result.id },
  );
  await cleanupEvalUser(db, bot.id, result.id);

  return await withCosts(db, result.id, [...convIds], {
    status: verdict.ok ? verdict.verdict.verdict : "error",
    reason: verdict.ok ? verdict.verdict.reason : verdict.error,
    answer: msg.content.text.slice(0, 8000),
    tools,
    citations_count: citations.length,
    conversation_id: current,
    latency_ms: msg.latency_ms,
  });
}

/** Memory yang dibuat pengguna uji hanyalah sampah uji: hapus supaya tidak menumpuk. */
async function cleanupEvalUser(db: SupabaseClient, botId: string, externalId: string) {
  try {
    const { data: eu } = await db.from("end_users").select("id").eq("bot_id", botId).eq("channel", "eval").eq("external_id", externalId).maybeSingle<{ id: string }>();
    if (eu) await db.from("memories").delete().eq("end_user_id", eu.id);
  } catch (e) {
    console.error("[eval] gagal membersihkan memory uji", e);
  }
}

/** Biaya dan token dijumlah dari data sumber (messages dan llm_usage), bukan dari perkiraan. */
async function withCosts(db: SupabaseClient, resultId: string, conversationIds: string[], base: Partial<EvalResultRow>): Promise<Partial<EvalResultRow>> {
  let costBot = 0,
    tin = 0,
    tout = 0;
  if (conversationIds.length) {
    const { data } = await db.from("messages").select("cost_usd, tokens_in, tokens_out").in("conversation_id", conversationIds).eq("role", "assistant");
    for (const m of data ?? []) {
      costBot += num(m.cost_usd);
      tin += num(m.tokens_in);
      tout += num(m.tokens_out);
    }
  }
  let judge = 0,
    bg = 0;
  const { data: usage } = await db.from("llm_usage").select("purpose, cost_usd, tokens_in, tokens_out").eq("eval_result_id", resultId);
  for (const u of usage ?? []) {
    if (u.purpose === "eval_judge") judge += num(u.cost_usd);
    else bg += num(u.cost_usd);
  }
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { ...base, cost_bot_usd: r6(costBot), cost_judge_usd: r6(judge), cost_background_usd: r6(bg), tokens_in: tin, tokens_out: tout };
}
