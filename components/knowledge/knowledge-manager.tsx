"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Globe, Link2, Loader2, NotebookPen, RotateCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { KnowledgeSource } from "@/lib/db/types";
import { ACCEPT_ATTR, fileValidationError, MAX_TEXT_CHARS } from "@/lib/knowledge/schema";

type Mode = "file" | "url" | "text";
/** Status lokal tambahan (tidak disimpan di database). */
interface LocalState {
  uploadPct?: number;
  stalled?: string;
}

const UPLOAD_STALE_MS = 15 * 60_000;
const MAX_STEP_FAILURES = 3;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error ?? "Gagal terhubung ke server.");
  return j as T;
}

function putWithProgress(url: string, file: File, contentType: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload ditolak server penyimpanan.")));
    xhr.onerror = () => reject(new Error("Upload gagal. Periksa koneksi internet."));
    xhr.send(file);
  });
}

export function KnowledgeManager({ botId, initialSources, loadError }: { botId: string; initialSources: KnowledgeSource[]; loadError?: string }) {
  const [sources, setSources] = useState(initialSources);
  const [local, setLocal] = useState<Record<string, LocalState>>({});
  const [mode, setMode] = useState<Mode>("file");
  const [tick, setTick] = useState(0);
  const base = `/api/bots/${botId}/knowledge`;

  const upsert = useCallback((s: KnowledgeSource) => {
    setSources((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list]));
  }, []);
  const setLocalFor = (id: string, patch: LocalState | null) =>
    setLocal((l) => {
      const n = { ...l };
      if (patch) n[id] = { ...n[id], ...patch };
      else delete n[id];
      return n;
    });

  // Penggerak pemrosesan: kerjakan satu langkah per panggilan, sumber satu per satu.
  const busy = useRef(false);
  const failures = useRef<Record<string, number>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (busy.current) return;
    const next = sources.find((s) => (s.status === "pending" || s.status === "processing") && !local[s.id]?.stalled);
    if (!next) return;
    busy.current = true;
    void (async () => {
      let wait = 0;
      try {
        const { source } = await api<{ source: KnowledgeSource }>(`${base}/${next.id}`, { method: "POST", body: JSON.stringify({ action: "process" }) });
        failures.current[next.id] = 0;
        if (!mounted.current) return;
        if (source.status === next.status && source.progress === next.progress) wait = 2000; // dikerjakan tab lain
        upsert(source);
        if (source.status === "ready") toast.success(`"${source.title}" siap dipakai bot`);
      } catch (e) {
        const n = (failures.current[next.id] ?? 0) + 1;
        failures.current[next.id] = n;
        wait = 2000 * n;
        if (n >= MAX_STEP_FAILURES && mounted.current) setLocalFor(next.id, { stalled: e instanceof Error ? e.message : "Pemrosesan terhenti." });
      } finally {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        busy.current = false;
        if (mounted.current) setTick((t) => t + 1);
      }
    })();
  }, [sources, local, tick, base, upsert]);

  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const err = fileValidationError(file.name, file.size);
      if (err) {
        toast.error(`${file.name}: ${err}`);
        continue;
      }
      let sourceId: string | null = null;
      try {
        const r = await api<{ source: KnowledgeSource; upload: { url: string; contentType: string } }>(base, {
          method: "POST",
          body: JSON.stringify({ type: "file", name: file.name, size: file.size }),
        });
        sourceId = r.source.id;
        setLocalFor(r.source.id, { uploadPct: 0 });
        upsert(r.source);
        await putWithProgress(r.upload.url, file, r.upload.contentType, (pct) => setLocalFor(r.source.id, { uploadPct: pct }));
        const done = await api<{ source: KnowledgeSource }>(`${base}/${r.source.id}`, { method: "POST", body: JSON.stringify({ action: "uploaded" }) });
        setLocalFor(r.source.id, null);
        upsert(done.source);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Upload gagal.";
        toast.error(`${file.name}: ${msg}`);
        if (sourceId) setLocalFor(sourceId, { uploadPct: undefined, stalled: msg });
      }
    }
  }

  async function remove(s: KnowledgeSource) {
    try {
      await api(`${base}/${s.id}`, { method: "DELETE" });
      setSources((list) => list.filter((x) => x.id !== s.id));
      setLocalFor(s.id, null);
      toast.success("Sumber dihapus");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus.");
    }
  }

  async function retry(s: KnowledgeSource) {
    failures.current[s.id] = 0;
    setLocalFor(s.id, null);
    if (s.status !== "error") return setTick((t) => t + 1);
    try {
      const { source } = await api<{ source: KnowledgeSource }>(`${base}/${s.id}`, { method: "POST", body: JSON.stringify({ action: "retry" }) });
      upsert(source);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses ulang.");
    }
  }

  const readyCount = sources.filter((s) => s.status === "ready").length;

  return (
    <div className="grid gap-6">
      <section aria-labelledby="add-title" className="rounded-xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="add-title" className="text-base font-semibold">
            Tambah sumber
          </h2>
          <div role="tablist" aria-label="Jenis sumber" className="inline-flex rounded-lg bg-muted p-1">
            {(
              [
                ["file", "File", FileText],
                ["url", "URL", Globe],
                ["text", "Teks", NotebookPen],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8",
                  mode === key ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          {mode === "file" && <FileDrop onFiles={uploadFiles} />}
          {mode === "url" && <UrlForm base={base} onAdded={upsert} />}
          {mode === "text" && <TextForm base={base} onAdded={upsert} />}
        </div>
      </section>

      <section aria-labelledby="list-title">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="list-title" className="text-base font-semibold">
            Sumber knowledge
          </h2>
          {sources.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {readyCount} dari {sources.length} siap dipakai
            </p>
          )}
        </div>
        {loadError ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
            <p className="font-medium text-destructive">{loadError}</p>
            <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
              Coba lagi
            </Button>
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
            <FileText className="mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">Belum ada knowledge</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Upload dokumen, tambahkan halaman web, atau tulis teks SOP. Bot akan menjawab dari sini dan menyebut sumbernya.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2" aria-label="Daftar sumber">
            {sources.map((s) => (
              <SourceRow key={s.id} s={s} local={local[s.id]} onDelete={() => remove(s)} onRetry={() => retry(s)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FileDrop({ onFiles }: { onFiles: (f: FileList | File[]) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors duration-150",
        over ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <Upload className="mb-2 size-6 text-muted-foreground" />
      <p className="text-sm font-medium">Seret file ke sini</p>
      <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT, atau MD. Maksimal 20 MB per file.</p>
      <Button type="button" variant="outline" className="mt-4" onClick={() => input.current?.click()}>
        Pilih file
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="sr-only"
        aria-label="Pilih file knowledge"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function UrlForm({ base, onAdded }: { base: string; onAdded: (s: KnowledgeSource) => void }) {
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        try {
          const { source } = await api<{ source: KnowledgeSource }>(base, { method: "POST", body: JSON.stringify({ type: "url", url: url.trim() }) });
          onAdded(source);
          setUrl("");
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Gagal menambah URL.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <Label htmlFor="kn-url">Alamat halaman web</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="kn-url"
          type="url"
          inputMode="url"
          placeholder="https://contoh.com/halaman"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={!!err}
          aria-describedby="kn-url-help"
          required
        />
        <Button type="submit" disabled={saving || !url.trim()}>
          {saving ? <Loader2 className="animate-spin" /> : <Link2 />} Tambah URL
        </Button>
      </div>
      <p id="kn-url-help" className={cn("text-xs", err ? "text-destructive" : "text-muted-foreground")}>
        {err ?? "Isi utama halaman akan diambil sekali. Halaman yang butuh login tidak bisa dibaca."}
      </p>
    </form>
  );
}

function TextForm({ base, onAdded }: { base: string; onAdded: (s: KnowledgeSource) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setSaving(true);
        try {
          const { source } = await api<{ source: KnowledgeSource }>(base, {
            method: "POST",
            body: JSON.stringify({ type: "text", title: title.trim(), content }),
          });
          onAdded(source);
          setTitle("");
          setContent("");
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Gagal menyimpan teks.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="kn-title">Judul</Label>
        <Input id="kn-title" placeholder="Contoh: SOP pengembalian barang" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="kn-content">Isi</Label>
        <Textarea
          id="kn-content"
          rows={8}
          placeholder="Tulis atau tempel isi SOP, FAQ, daftar harga, dan sebagainya."
          value={content}
          maxLength={MAX_TEXT_CHARS}
          onChange={(e) => setContent(e.target.value)}
          required
        />
        <p className="text-right text-xs text-muted-foreground">{content.length.toLocaleString("id-ID")} / 200.000 karakter</p>
      </div>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div>
        <Button type="submit" disabled={saving || !title.trim() || !content.trim()}>
          {saving && <Loader2 className="animate-spin" />} Simpan teks
        </Button>
      </div>
    </form>
  );
}

function formatSize(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function SourceRow({ s, local, onDelete, onRetry }: { s: KnowledgeSource; local?: LocalState; onDelete: () => void; onRetry: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const Icon = s.type === "url" ? Globe : s.type === "text" ? NotebookPen : FileText;
  const uploadStale = s.status === "uploading" && local?.uploadPct === undefined && Date.now() - Date.parse(s.created_at) > UPLOAD_STALE_MS;
  const meta = [
    s.type === "url" && s.url ? safeHost(s.url) : null,
    formatSize(s.size_bytes),
    s.status === "ready" && s.chunk_count ? `${s.chunk_count} potongan` : null,
  ].filter(Boolean);

  let status: React.ReactNode;
  if (s.status === "uploading") {
    status = uploadStale || local?.stalled ? (
      <StatusText tone="error">{local?.stalled ?? "Upload tidak selesai. Hapus lalu upload ulang."}</StatusText>
    ) : (
      <Progress label="Mengunggah" pct={local?.uploadPct ?? 0} />
    );
  } else if (s.status === "pending" || s.status === "processing") {
    status = local?.stalled ? (
      <StatusText tone="error">{local.stalled}</StatusText>
    ) : (
      <Progress label={s.status === "pending" ? "Menunggu diproses" : s.chunk_count ? "Membuat indeks" : "Membaca dokumen"} pct={s.progress} />
    );
  } else if (s.status === "ready") {
    status = (
      <StatusText tone="ok">
        <CheckCircle2 className="size-3.5" /> Siap
      </StatusText>
    );
  } else {
    status = (
      <StatusText tone="error">
        <AlertCircle className="size-3.5 shrink-0" /> {s.error_message ?? "Gagal diproses."}
      </StatusText>
    );
  }

  const canRetry = s.status === "error" || (local?.stalled && s.status !== "uploading");

  return (
    <li className="flex items-start gap-3 rounded-lg border p-3" data-status={s.status} data-testid="knowledge-source">
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={s.title}>
          {s.title}
        </p>
        {meta.length > 0 && <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>}
        <div className="mt-1.5">{status}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {canRetry && (
          <Button variant="ghost" size="icon-sm" aria-label={`Proses ulang ${s.title}`} onClick={onRetry}>
            <RotateCw />
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${s.title}`} className="text-muted-foreground hover:text-destructive">
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus &quot;{s.title}&quot;?</AlertDialogTitle>
              <AlertDialogDescription>File dan seluruh potongan teksnya ikut terhapus. Bot tidak akan bisa menjawab dari sumber ini lagi.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={async (e) => {
                  e.preventDefault();
                  setDeleting(true);
                  await onDelete();
                  setDeleting(false);
                }}
              >
                {deleting && <Loader2 className="animate-spin" />} Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function StatusText({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  return <p className={cn("flex items-start gap-1 text-xs", tone === "ok" ? "text-primary" : "text-destructive")}>{children}</p>;
}

function Progress({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> {label} {pct > 0 && `${pct}%`}
      </p>
      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
    </div>
  );
}
