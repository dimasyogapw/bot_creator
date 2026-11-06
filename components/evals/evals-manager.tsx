"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, FlaskConical, Loader2, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addEvalCase, deleteEvalCase, importEvalCases, updateEvalCase } from "@/lib/evals/actions";
import { EXAMPLE_CASES_JSONL } from "@/lib/evals/examples";
import { formatDateTime } from "@/lib/conversations/labels";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CaseDialog, EMPTY_CASE, type CaseValues } from "./case-dialog";

export interface CaseView extends CaseValues {
  id: string;
}

export interface RunView {
  id: string;
  created_at: string;
  status: "running" | "done";
  total: number;
  pass_count: number;
  fail_count: number;
  error_count: number;
  skipped_count: number;
  cost_usd: number;
  score: number | null;
  /** Selisih skor terhadap run sebelumnya (poin persen). Null jika tidak ada pembanding. */
  delta: number | null;
}

export interface SpendView {
  last30: number;
  all: number;
  runs: number;
}

export function EvalsManager({
  botId,
  cases,
  runs,
  spend,
  estimate,
  judgeModel,
  maxCases,
}: {
  botId: string;
  cases: CaseView[];
  runs: RunView[];
  spend: SpendView;
  estimate: { usd: number; basis: "run_sebelumnya" | "perkiraan_kasar"; runnable: number; skipped: number };
  judgeModel: string;
  maxCases: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CaseView | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState<CaseView | null>(null);
  const [busyExample, setBusyExample] = useState(false);

  async function start() {
    setStarting(true);
    try {
      const res = await fetch(`/api/bots/${botId}/evals/runs`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string; resumeRunId?: string };
      if (res.ok && data.runId) {
        router.push(`/bots/${botId}/evals/${data.runId}`);
        return;
      }
      if (data.resumeRunId) {
        toast.message("Masih ada run yang berjalan. Membuka run itu.");
        router.push(`/bots/${botId}/evals/${data.resumeRunId}`);
        return;
      }
      toast.error(data.error ?? "Run gagal dimulai. Coba lagi.");
    } catch {
      toast.error("Koneksi bermasalah. Coba lagi.");
    }
    setStarting(false);
    setConfirmRun(false);
  }

  async function useExamples() {
    setBusyExample(true);
    const r = await importEvalCases(botId, EXAMPLE_CASES_JSONL);
    setBusyExample(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("6 kasus contoh ditambahkan");
    router.refresh();
  }

  async function remove(c: CaseView) {
    const r = await deleteEvalCase(botId, c.id);
    setDeleting(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Test case dihapus");
    router.refresh();
  }

  const lastRun = runs[0];

  return (
    <div className="grid gap-6">
      <section aria-label="Pengeluaran eval" className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pengeluaran eval 30 hari" value={formatUsd(spend.last30)} testId="spend-30d" />
        <Stat label="Total pengeluaran eval" value={formatUsd(spend.all)} hint={`${spend.runs} run`} testId="spend-all" />
        <Stat label="Biaya run terakhir" value={lastRun ? formatUsd(lastRun.cost_usd) : "-"} hint={lastRun ? formatDateTime(lastRun.created_at) : "Belum ada run"} testId="spend-last" />
      </section>

      <section aria-labelledby="cases-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="cases-title" className="text-base font-semibold">
            Test case{" "}
            <span className="font-normal text-muted-foreground" data-testid="case-count">
              ({cases.length}/{maxCases})
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={cases.length >= maxCases}>
              <Plus /> Tambah
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} disabled={cases.length >= maxCases}>
              <Upload /> Impor
            </Button>
            <Button size="sm" onClick={() => setConfirmRun(true)} disabled={cases.length === 0 || starting} data-testid="run-eval">
              <Play /> Jalankan
            </Button>
          </div>
        </div>

        {cases.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
            <FlaskConical className="mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">Belum ada test case</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Test case adalah &quot;soal ujian&quot; untuk bot: sebuah pertanyaan dan perilaku yang seharusnya dilakukan bot. Tambahkan sendiri, impor dari file, atau mulai dari 6 kasus contoh.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setEditing("new")}>
                <Plus /> Tambah test case
              </Button>
              <Button variant="outline" onClick={useExamples} disabled={busyExample}>
                {busyExample && <Loader2 className="animate-spin" />} Pakai 6 kasus contoh
              </Button>
            </div>
          </div>
        ) : (
          <ul className="grid gap-2" aria-label="Daftar test case">
            {cases.map((c) => (
              <li key={c.id} className="rounded-xl border p-3 sm:p-4" data-testid="eval-case">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words whitespace-pre-wrap">{c.input}</p>
                    <p className="mt-1 text-sm break-words text-muted-foreground">
                      <span className="font-medium">Diharapkan:</span> {c.expected_behavior}
                    </p>
                    {(c.tags.length > 0 || c.setup.length > 0) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.tags.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                        {c.setup.length > 0 && <Badge variant="outline">{c.setup.length} pesan pendahuluan</Badge>}
                        {c.new_conversation && <Badge variant="outline">percakapan baru</Badge>}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button variant="ghost" size="icon-sm" aria-label="Edit test case" onClick={() => setEditing(c)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Hapus test case" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(c)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="runs-title">
        <h2 id="runs-title" className="mb-3 text-base font-semibold">
          Riwayat run
        </h2>
        {runs.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Belum ada run. Tekan Jalankan setelah ada test case.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[34rem] text-sm" data-testid="runs-table">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Waktu</th>
                  <th className="px-3 py-2 font-medium">Skor</th>
                  <th className="px-3 py-2 font-medium">Lulus</th>
                  <th className="px-3 py-2 text-right font-medium">Biaya</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((r) => (
                  <tr key={r.id} data-testid="run-row">
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.status === "running" ? (
                        <Badge variant="outline">berjalan</Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-medium">{r.score === null ? "-" : `${r.score}%`}</span>
                          <Delta value={r.delta} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {r.pass_count}/{r.total - r.skipped_count}
                      {r.skipped_count > 0 && ` (${r.skipped_count} dilewati)`}
                      {r.error_count > 0 && <span className="text-destructive"> · {r.error_count} error</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums" data-testid="run-cost">
                      {formatUsd(r.cost_usd)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/bots/${botId}/evals/${r.id}`}>Lihat</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CaseDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        title={editing === "new" ? "Tambah test case" : "Edit test case"}
        initial={editing && editing !== "new" ? editing : EMPTY_CASE}
        onSubmit={async (v) => {
          const r = editing && editing !== "new" ? await updateEvalCase(botId, editing.id, v) : await addEvalCase(botId, v);
          if (!r.ok) return r;
          setEditing(null);
          toast.success("Test case disimpan");
          router.refresh();
          return { ok: true };
        }}
      />

      <ImportDialog botId={botId} open={importOpen} onOpenChange={setImportOpen} onDone={() => router.refresh()} />

      <AlertDialog open={confirmRun} onOpenChange={(v) => !starting && setConfirmRun(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Jalankan eval sekarang?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2 text-sm text-muted-foreground">
                <p>
                  {estimate.runnable} kasus akan dijawab bot lalu dinilai juri ({judgeModel}).
                  {estimate.skipped > 0 && ` ${estimate.skipped} kasus memory dilewati karena Memory bot mati.`}
                </p>
                <p data-testid="run-estimate">
                  Perkiraan biaya: <span className="font-medium text-foreground">{formatUsd(estimate.usd)}</span>{" "}
                  {estimate.basis === "run_sebelumnya" ? "(dari rata-rata run sebelumnya)" : "(perkiraan kasar, belum ada run sebelumnya)"}. Biaya sebenarnya tampil di hasil run.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={starting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void start();
              }}
              disabled={starting}
              data-testid="confirm-run"
            >
              {starting && <Loader2 className="animate-spin" />} Jalankan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus test case ini?</AlertDialogTitle>
            <AlertDialogDescription>Hasil di run lama tetap tersimpan, hanya soalnya yang dihapus dari daftar.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove(deleting)}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0)
    return value === 0 ? (
      <span className="text-xs text-muted-foreground" aria-label="skor sama dengan run sebelumnya">
        sama
      </span>
    ) : null;
  const up = value > 0;
  return (
    <span className={cn("inline-flex items-center text-xs font-medium", up ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")} aria-label={`skor ${up ? "naik" : "turun"} ${Math.abs(value)} poin`}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
      {Math.abs(value)}
    </span>
  );
}

function ImportDialog({ botId, open, onOpenChange, onDone }: { botId: string; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setErrors([]);
    const r = await importEvalCases(botId, text);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setErrors(r.errors ?? []);
      return;
    }
    toast.success(`${r.data?.imported ?? 0} test case diimpor`);
    setText("");
    onOpenChange(false);
    onDone();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 400_000) return setError("File terlalu besar (maksimal 400 KB).");
    setText(await f.text());
    e.target.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Impor test case</DialogTitle>
          <DialogDescription>
            Satu test case per baris, format JSON: <code className="text-xs">{`{"input": "...", "expected_behavior": "...", "tags": ["..."]}`}</code>. Opsional: <code className="text-xs">setup</code> (daftar pesan pendahuluan) dan{" "}
            <code className="text-xs">new_conversation</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="import-file">Pilih file .jsonl (opsional)</Label>
            <input id="import-file" type="file" accept=".jsonl,.json,.txt,text/plain" onChange={onFile} className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="import-text">Atau tempel isinya di sini</Label>
            <Textarea id="import-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
          </div>
          {error && (
            <div role="alert" className="text-sm text-destructive">
              <p>{error}</p>
              {errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {errors.slice(0, 8).map((e) => (
                    <li key={e.line}>
                      Baris {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={busy || !text.trim()}>
            {busy && <Loader2 className="animate-spin" />} Impor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
