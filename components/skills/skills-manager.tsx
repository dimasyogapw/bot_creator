"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronDown, FlaskConical, KeyRound, Loader2, Plus, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { deleteWebhook, saveBuiltinSkill, saveWebhook, setWebhookEnabled, testSkill } from "@/lib/skills/actions";
import { sampleArgs, type SkillView } from "@/lib/skills/view";

const TIMEZONES = [
  ["Asia/Jakarta", "WIB (Jakarta)"],
  ["Asia/Makassar", "WITA (Makassar)"],
  ["Asia/Jayapura", "WIT (Jayapura)"],
  ["Asia/Singapore", "Singapura"],
  ["Asia/Kuala_Lumpur", "Kuala Lumpur"],
  ["Asia/Riyadh", "Arab Saudi"],
  ["UTC", "UTC"],
] as const;

const linesToList = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function SkillsManager({
  botId,
  skills,
  readyKnowledge,
  leadCount,
  loadError,
}: {
  botId: string;
  skills: SkillView[];
  readyKnowledge: number;
  leadCount: number;
  loadError?: string;
}) {
  const [adding, setAdding] = useState(false);
  if (loadError)
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <p className="font-medium text-destructive">{loadError}</p>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Coba lagi
        </Button>
      </div>
    );
  const builtins = skills.filter((s) => s.type !== "http_webhook");
  const webhooks = skills.filter((s) => s.type === "http_webhook");

  return (
    <div className="grid gap-8">
      <section aria-labelledby="builtin-title" className="grid gap-3">
        <h2 id="builtin-title" className="text-base font-semibold">
          Skill bawaan
        </h2>
        {builtins.map((s) => (
          <BuiltinCard key={s.key} botId={botId} s={s} readyKnowledge={readyKnowledge} leadCount={leadCount} />
        ))}
      </section>

      <section aria-labelledby="api-title" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="api-title" className="text-base font-semibold">
              Integrasi API
            </h2>
            <p className="text-sm text-muted-foreground">Panggil API atau workflow n8n milikmu. Bot menjawab dari hasilnya.</p>
          </div>
          {!adding && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Tambah integrasi
            </Button>
          )}
        </div>
        {adding && <WebhookForm botId={botId} onDone={() => setAdding(false)} />}
        {webhooks.length === 0 && !adding && (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center">
            <Webhook className="mb-3 size-7 text-muted-foreground" />
            <p className="font-medium">Belum ada integrasi API</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Contoh: cek ongkir, cek stok, atau jalankan workflow n8n saat pengguna memesan.</p>
          </div>
        )}
        {webhooks.map((s) => (
          <WebhookCard key={s.key} botId={botId} s={s} />
        ))}
      </section>
    </div>
  );
}

/* ---------- Kartu umum ---------- */

function Card({
  s,
  checked,
  onToggle,
  toggleDisabled,
  saving,
  children,
  badge,
  note,
}: {
  s: SkillView;
  checked: boolean;
  onToggle: (v: boolean) => void;
  toggleDisabled?: boolean;
  saving?: boolean;
  children?: React.ReactNode;
  badge?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border" data-testid="skill-card" data-skill={s.type} data-enabled={checked}>
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{s.type === "http_webhook" ? s.name : s.label}</h3>
            {badge}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{s.ownerDescription}</p>
          {note && <div className="mt-2 text-xs">{note}</div>}
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Switch checked={checked} onCheckedChange={onToggle} disabled={toggleDisabled || saving} aria-label={`Aktifkan ${s.type === "http_webhook" ? s.name : s.label}`} />
        </div>
      </div>
      {children && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-h-11 w-full items-center justify-between px-4 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-10"
          >
            Pengaturan dan tes
            <ChevronDown className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
          </button>
          {open && <div className="grid gap-4 px-4 pb-4">{children}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- Skill bawaan ---------- */

function BuiltinCard({ botId, s, readyKnowledge, leadCount }: { botId: string; s: SkillView; readyKnowledge: number; leadCount: number }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(s.enabled);
  const [config, setConfig] = useState<Record<string, unknown>>((s.config as Record<string, unknown>) ?? {});
  const [description, setDescription] = useState(s.description);
  const [saving, start] = useTransition();

  function save(nextEnabled = enabled, successMsg = "Skill disimpan") {
    start(async () => {
      const r = await saveBuiltinSkill(botId, s.type, { enabled: nextEnabled, description, config });
      if (!r.ok) {
        toast.error(r.error);
        setEnabled(s.enabled);
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  const unavailable = !s.available.ok;
  let note: React.ReactNode = null;
  if (unavailable)
    note = (
      <p className="flex items-start gap-1 text-destructive">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {s.available.reason}
      </p>
    );
  else if (s.type === "search_knowledge" && readyKnowledge === 0)
    note = (
      <p className="text-muted-foreground">
        Belum ada sumber knowledge yang siap.{" "}
        <Link href={`/bots/${botId}/knowledge`} className="text-primary underline-offset-4 hover:underline">
          Tambah knowledge
        </Link>
      </p>
    );
  else if (s.type === "capture_lead")
    note = (
      <Link href={`/bots/${botId}/skills/leads`} className="text-primary underline-offset-4 hover:underline">
        Lihat data pelanggan ({leadCount})
      </Link>
    );

  return (
    <Card
      s={s}
      checked={enabled && !unavailable}
      onToggle={(v) => {
        setEnabled(v);
        save(v, v ? `${s.label} dinyalakan` : `${s.label} dimatikan`);
      }}
      toggleDisabled={unavailable}
      saving={saving}
      note={note}
    >
      <BuiltinConfig type={s.type} config={config} setConfig={setConfig} />
      <div className="grid gap-2">
        <Label htmlFor={`desc-${s.key}`}>Petunjuk untuk bot (opsional)</Label>
        <Textarea id={`desc-${s.key}`} rows={2} placeholder={s.defaultDescription} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
        <p className="text-xs text-muted-foreground">Kosongkan untuk memakai petunjuk bawaan. Bot memakai petunjuk ini untuk memutuskan kapan skill dipakai.</p>
      </div>
      <div>
        <Button onClick={() => save()} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Simpan pengaturan
        </Button>
      </div>
      <TestPanel botId={botId} s={{ ...s, config }} disabled={unavailable} />
    </Card>
  );
}

function BuiltinConfig({ type, config, setConfig }: { type: SkillView["type"]; config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: unknown) => setConfig({ ...config, [k]: v });
  if (type === "current_datetime") {
    const tz = String(config.timezone ?? "Asia/Jakarta");
    return (
      <div className="grid gap-2">
        <Label htmlFor="tz">Zona waktu</Label>
        <select
          id="tz"
          value={tz}
          onChange={(e) => set("timezone", e.target.value)}
          className="h-11 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-9"
        >
          {TIMEZONES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
          {!TIMEZONES.some(([v]) => v === tz) && <option value={tz}>{tz}</option>}
        </select>
      </div>
    );
  }
  if (type === "web_fetch" || type === "web_search") {
    const key = type === "web_fetch" ? "allowedDomains" : "includeDomains";
    return (
      <div className="grid gap-4">
        {type === "web_search" && (
          <div className="grid gap-2">
            <Label htmlFor="max-results">Jumlah hasil per pencarian</Label>
            <Input id="max-results" type="number" min={1} max={10} value={Number(config.maxResults ?? 5)} onChange={(e) => set("maxResults", Number(e.target.value))} />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor={`domains-${type}`}>{type === "web_fetch" ? "Hanya domain ini (opsional)" : "Cari hanya di domain ini (opsional)"}</Label>
          <Textarea
            id={`domains-${type}`}
            rows={2}
            placeholder="contoh.com&#10;*.go.id"
            defaultValue={((config[key] as string[]) ?? []).join("\n")}
            onChange={(e) => set(key, linesToList(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">Satu domain per baris. Kosongkan untuk semua domain publik.</p>
        </div>
      </div>
    );
  }
  if (type === "handoff_to_human" || type === "capture_lead") {
    return (
      <div className="grid gap-4">
        {type === "handoff_to_human" && (
          <div className="grid gap-2">
            <Label htmlFor="reply-hint">Pesan bot ke pengguna</Label>
            <Input id="reply-hint" value={String(config.replyHint ?? "")} maxLength={300} onChange={(e) => set("replyHint", e.target.value)} />
          </div>
        )}
        {type === "capture_lead" && <LeadFields fields={(config.fields as LeadField[]) ?? []} onChange={(f) => set("fields", f)} />}
        <div className="grid gap-2">
          <Label htmlFor={`notify-${type}`}>Kirim notifikasi ke webhook (opsional)</Label>
          <Input id={`notify-${type}`} type="url" placeholder="https://n8n.contoh.com/webhook/..." value={String(config.notifyUrl ?? "")} onChange={(e) => set("notifyUrl", e.target.value)} />
          <p className="text-xs text-muted-foreground">Mis. webhook n8n yang meneruskan ke WhatsApp, Telegram, atau email kamu.</p>
        </div>
      </div>
    );
  }
  return null;
}

interface LeadField {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

function LeadFields({ fields, onChange }: { fields: LeadField[]; onChange: (f: LeadField[]) => void }) {
  const upd = (i: number, patch: Partial<LeadField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Data yang dikumpulkan</legend>
      {fields.map((f, i) => (
        <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor={`lf-label-${i}`} className="text-xs">
              Nama data
            </Label>
            <Input
              id={`lf-label-${i}`}
              value={f.label}
              onChange={(e) =>
                upd(i, {
                  label: e.target.value,
                  key:
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "_")
                      .replace(/^_+|_+$/g, "")
                      .replace(/^(\d)/, "f_$1")
                      .slice(0, 40) || `data_${i + 1}`,
                })
              }
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`lf-desc-${i}`} className="text-xs">
              Penjelasan
            </Label>
            <Input id={`lf-desc-${i}`} value={f.description} onChange={(e) => upd(i, { description: e.target.value })} />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={f.required} onChange={(e) => upd(i, { required: e.target.checked })} /> Wajib
          </label>
          <Button variant="ghost" size="icon-sm" aria-label={`Hapus data ${f.label}`} onClick={() => onChange(fields.filter((_, j) => j !== i))} disabled={fields.length <= 1}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" onClick={() => onChange([...fields, { key: `data_${fields.length + 1}`, label: "", description: "", required: false }])} disabled={fields.length >= 15}>
          <Plus /> Tambah data
        </Button>
      </div>
    </fieldset>
  );
}

/* ---------- Tes skill ---------- */

function TestPanel({ botId, s, disabled }: { botId: string; s: SkillView; disabled?: boolean }) {
  const [args, setArgs] = useState(() => sampleArgs(s));
  const [result, setResult] = useState<{ ok: boolean; summary: string; content: string; ms: number } | null>(null);
  const [running, start] = useTransition();
  return (
    <div className="grid gap-2 rounded-lg bg-muted/40 p-3" data-testid="skill-test">
      <Label htmlFor={`test-${s.key}`} className="flex items-center gap-1.5">
        <FlaskConical className="size-4" /> Tes skill
      </Label>
      <Textarea id={`test-${s.key}`} rows={2} className="font-mono text-xs" value={args} onChange={(e) => setArgs(e.target.value)} aria-describedby={`test-help-${s.key}`} />
      <p id={`test-help-${s.key}`} className="text-xs text-muted-foreground">
        Argumen dalam format JSON, seperti yang akan dikirim bot. Simpan pengaturan dulu sebelum tes. Data pelanggan dan permintaan bantuan tidak disimpan saat tes.
      </p>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={running || disabled || (!s.id && s.type === "http_webhook")}
          onClick={() =>
            start(async () => {
              setResult(null);
              const r = await testSkill(botId, { type: s.type, skillId: s.id }, args);
              if (!r.ok) toast.error(r.error);
              else setResult(r.data!);
            })
          }
        >
          {running && <Loader2 className="animate-spin" />} Jalankan tes
        </Button>
      </div>
      {result && (
        <div role="status" className="grid gap-1">
          <p className={cn("text-xs font-medium", result.ok ? "text-primary" : "text-destructive")}>
            {result.ok ? "Berhasil" : "Gagal"}: {result.summary} · {(result.ms / 1000).toFixed(1).replace(".", ",")} dtk
          </p>
          <pre className="max-h-64 overflow-auto rounded-md border bg-background p-2 text-xs whitespace-pre-wrap">{result.content}</pre>
        </div>
      )}
    </div>
  );
}

/* ---------- Webhook ---------- */

interface HeaderRow {
  name: string;
  value: string;
  secret: boolean;
}
interface ParamRow {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  description: string;
  required: boolean;
}

function WebhookCard({ botId, s }: { botId: string; s: SkillView }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(s.enabled);
  const [editing, setEditing] = useState(false);
  const [saving, start] = useTransition();
  const cfg = s.config as { url?: string; method?: string; allowedDomains?: string[] };

  if (editing) return <WebhookForm botId={botId} initial={s} onDone={() => setEditing(false)} />;
  return (
    <Card
      s={{ ...s, ownerDescription: s.description }}
      checked={enabled}
      saving={saving}
      onToggle={(v) => {
        setEnabled(v);
        start(async () => {
          const r = await setWebhookEnabled(botId, s.id!, v);
          if (!r.ok) {
            setEnabled(!v);
            toast.error(r.error);
          } else {
            toast.success(v ? "Integrasi dinyalakan" : "Integrasi dimatikan");
            router.refresh();
          }
        });
      }}
      badge={<Badge variant="outline">{cfg.method}</Badge>}
      note={
        <p className="truncate font-mono text-muted-foreground" title={cfg.url}>
          {cfg.url}
        </p>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Ubah
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
              <Trash2 /> Hapus
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus integrasi &quot;{s.name}&quot;?</AlertDialogTitle>
              <AlertDialogDescription>Bot tidak akan bisa memanggil API ini lagi. Header rahasianya ikut terhapus.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  const r = await deleteWebhook(botId, s.id!);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Integrasi dihapus");
                    router.refresh();
                  }
                }}
              >
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <TestPanel botId={botId} s={s} />
    </Card>
  );
}

function WebhookForm({ botId, initial, onDone }: { botId: string; initial?: SkillView; onDone: () => void }) {
  const router = useRouter();
  const c = (initial?.config ?? {}) as {
    url?: string;
    method?: "GET" | "POST";
    allowedDomains?: string[];
    headers?: { name: string; value?: string; secret?: boolean }[];
    parameters?: ParamRow[];
    timeoutMs?: number;
  };
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [url, setUrl] = useState(c.url ?? "");
  const [method, setMethod] = useState<"GET" | "POST">(c.method ?? "POST");
  const [domains, setDomains] = useState((c.allowedDomains ?? []).join("\n"));
  const [headers, setHeaders] = useState<HeaderRow[]>((c.headers ?? []).map((h) => ({ name: h.name, value: h.secret ? "" : (h.value ?? ""), secret: !!h.secret })));
  const [params, setParams] = useState<ParamRow[]>(c.parameters ?? []);
  const [timeout, setTimeoutS] = useState(Math.round((c.timeoutMs ?? 10000) / 1000));
  const [err, setErr] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const stored = new Set((initial?.storedSecrets ?? []).map((x) => x.toLowerCase()));

  function autoDomain(u: string) {
    if (domains.trim()) return;
    try {
      setDomains(new URL(u.replace(/\{[^}]*\}/g, "x")).hostname);
    } catch {
      // abaikan
    }
  }

  return (
    <form
      className="grid gap-4 rounded-xl border p-4"
      aria-label={initial ? `Ubah integrasi ${initial.name}` : "Integrasi API baru"}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await saveWebhook(botId, initial?.id ?? null, {
            name,
            description,
            enabled: initial?.enabled ?? true,
            config: { url, method, allowedDomains: linesToList(domains), headers, parameters: params, timeoutMs: timeout * 1000 },
          });
          if (!r.ok) return setErr(r.error);
          toast.success("Integrasi disimpan");
          onDone();
          router.refresh();
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="wh-name">Nama</Label>
        <Input id="wh-name" placeholder="Cek ongkir" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="wh-desc">Kapan bot memakai API ini?</Label>
        <Textarea
          id="wh-desc"
          rows={2}
          placeholder="Hitung ongkos kirim saat pengguna menanyakan ongkir ke kota tertentu."
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
        <div className="grid gap-2">
          <Label htmlFor="wh-url">Alamat (URL)</Label>
          <Input id="wh-url" type="url" placeholder="https://api.contoh.com/ongkir/{kota}" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={(e) => autoDomain(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="wh-method">Metode</Label>
          <select
            id="wh-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as "GET" | "POST")}
            className="h-11 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-9"
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Pakai {"{nama_parameter}"} di alamat untuk mengisi parameter. Parameter lain dikirim sebagai query (GET) atau body JSON (POST).</p>
      <div className="grid gap-2">
        <Label htmlFor="wh-domains">Domain yang diizinkan</Label>
        <Textarea id="wh-domains" rows={2} placeholder="api.contoh.com" value={domains} onChange={(e) => setDomains(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Satu per baris. Bot hanya boleh menghubungi domain ini (termasuk saat dialihkan).</p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Parameter yang diisi bot</legend>
        {params.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_1.5fr_auto_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor={`p-name-${i}`} className="text-xs">
                Nama
              </Label>
              <Input id={`p-name-${i}`} value={p.name} placeholder="kota" onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`p-type-${i}`} className="text-xs">
                Jenis
              </Label>
              <select
                id={`p-type-${i}`}
                value={p.type}
                onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, type: e.target.value as ParamRow["type"] } : x)))}
                className="h-11 rounded-md border bg-background px-2 text-sm sm:h-9"
              >
                <option value="string">Teks</option>
                <option value="number">Angka</option>
                <option value="integer">Bilangan bulat</option>
                <option value="boolean">Ya/tidak</option>
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`p-desc-${i}`} className="text-xs">
                Penjelasan untuk bot
              </Label>
              <Input id={`p-desc-${i}`} value={p.description} placeholder="Kota tujuan" onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <input type="checkbox" className="size-4" checked={p.required} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> Wajib
            </label>
            <Button variant="ghost" size="icon-sm" type="button" aria-label={`Hapus parameter ${p.name}`} onClick={() => setParams(params.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setParams([...params, { name: "", type: "string", description: "", required: true }])} disabled={params.length >= 15}>
            <Plus /> Tambah parameter
          </Button>
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Header (opsional)</legend>
        {headers.map((h, i) => (
          <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1.5fr_auto_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor={`h-name-${i}`} className="text-xs">
                Nama header
              </Label>
              <Input id={`h-name-${i}`} value={h.name} placeholder="Authorization" onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`h-val-${i}`} className="text-xs">
                Nilai
              </Label>
              <Input
                id={`h-val-${i}`}
                type={h.secret ? "password" : "text"}
                autoComplete="off"
                value={h.value}
                placeholder={h.secret && stored.has(h.name.toLowerCase()) ? "Tersimpan aman. Isi untuk mengganti." : h.secret ? "Nilai rahasia" : ""}
                onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <input type="checkbox" className="size-4" checked={h.secret} onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, secret: e.target.checked, value: "" } : x)))} />
              <KeyRound className="size-3.5" /> Rahasia
            </label>
            <Button variant="ghost" size="icon-sm" type="button" aria-label={`Hapus header ${h.name}`} onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setHeaders([...headers, { name: "", value: "", secret: true }])} disabled={headers.length >= 10}>
            <Plus /> Tambah header
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Header rahasia (mis. API key) disimpan terenkripsi dan tidak pernah ditampilkan lagi.</p>
      </fieldset>

      <div className="grid max-w-40 gap-2">
        <Label htmlFor="wh-timeout">Batas waktu (detik)</Label>
        <Input id="wh-timeout" type="number" min={1} max={20} value={timeout} onChange={(e) => setTimeoutS(Number(e.target.value))} />
      </div>

      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Simpan integrasi
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Batal
        </Button>
      </div>
    </form>
  );
}
