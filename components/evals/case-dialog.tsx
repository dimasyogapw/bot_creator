"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface CaseValues {
  input: string;
  expected_behavior: string;
  tags: string[];
  setup: string[];
  new_conversation: boolean;
}

export const EMPTY_CASE: CaseValues = { input: "", expected_behavior: "", tags: [], setup: [], new_conversation: false };

type SubmitResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

/** Dialog tambah/edit satu test case. Dipakai tab Evals dan tombol "Buat test case" di Percakapan. */
export function CaseDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  badAnswer,
  loading,
  submitLabel = "Simpan",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  initial: CaseValues;
  /** Jawaban bot yang dinilai buruk (ditampilkan sebagai konteks, tidak disimpan). */
  badAnswer?: string;
  loading?: boolean;
  submitLabel?: string;
  onSubmit: (v: CaseValues) => Promise<SubmitResult>;
}) {
  // Form dibuat ulang (key) setiap dialog dibuka dengan data awal baru.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Menyiapkan draf...
          </div>
        ) : (
          <CaseForm key={JSON.stringify(initial)} initial={initial} badAnswer={badAnswer} submitLabel={submitLabel} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CaseForm({
  initial,
  badAnswer,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: CaseValues;
  badAnswer?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: CaseValues) => Promise<SubmitResult>;
}) {
  const [input, setInput] = useState(initial.input);
  const [expected, setExpected] = useState(initial.expected_behavior);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [setup, setSetup] = useState(initial.setup.join("\n"));
  const [newConv, setNewConv] = useState(initial.new_conversation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const setupLines = setup
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await onSubmit({
      input,
      expected_behavior: expected,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      setup: setupLines,
      new_conversation: newConv && setupLines.length > 0,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setFields(r.fields ?? {});
    }
  }

  const hasSetup = setup.trim().length > 0;

  return (
    <form onSubmit={submit} className="grid gap-4">
      {badAnswer && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Jawaban bot yang dinilai kurang baik</p>
          <p className="line-clamp-5 whitespace-pre-wrap">{badAnswer}</p>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="case-input">Pertanyaan pengguna</Label>
        <Textarea id="case-input" rows={3} value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000} aria-invalid={!!fields.input} required />
        {fields.input && <p className="text-xs text-destructive">{fields.input}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="case-expected">Perilaku yang diharapkan</Label>
        <Textarea
          id="case-expected"
          rows={3}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          maxLength={2000}
          placeholder="Contoh: Mengatakan tidak punya informasinya dan tidak mengarang angka"
          aria-invalid={!!fields.expected_behavior}
          required
        />
        <p className="text-xs text-muted-foreground">Tulis apa yang seharusnya dilakukan bot, bukan kalimat persisnya. Juri menilai berdasarkan ini.</p>
        {fields.expected_behavior && <p className="text-xs text-destructive">{fields.expected_behavior}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="case-tags">Tag (pisahkan dengan koma, opsional)</Label>
        <Input id="case-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="knowledge, keamanan" aria-invalid={!!fields.tags} />
        {fields.tags && <p className="text-xs text-destructive">{fields.tags}</p>}
      </div>
      <details className="rounded-lg border px-3 py-2" open={hasSetup}>
        <summary className="cursor-pointer text-sm font-medium">Lanjutan: pesan pendahuluan</summary>
        <div className="mt-3 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="case-setup">Pesan yang dikirim lebih dulu (satu per baris, maks 5)</Label>
            <Textarea id="case-setup" rows={3} value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="Nama saya Budi, saya suka kopi hitam" aria-invalid={!!fields.setup} />
            {fields.setup && <p className="text-xs text-destructive">{fields.setup}</p>}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="case-newconv" className="font-normal">
              Kirim pertanyaan utama di percakapan baru (untuk tes memory)
            </Label>
            <Switch id="case-newconv" checked={newConv && hasSetup} onCheckedChange={setNewConv} disabled={!hasSetup} />
          </div>
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
