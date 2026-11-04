"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generatePersonaDraft } from "@/lib/bots/actions";
import type { PersonaResult } from "@/lib/bots/schema";

const TONES = [
  { v: "ramah", l: "Ramah dan hangat" },
  { v: "santai", l: "Santai, seperti teman" },
  { v: "profesional", l: "Profesional, to the point" },
  { v: "formal", l: "Formal dan resmi" },
] as const;

export function PersonaAssistant({
  open,
  onOpenChange,
  botName,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  botName: string;
  onApply: (r: PersonaResult) => void;
}) {
  const [answers, setAnswers] = useState({ purpose: "", audience: "", tone: "ramah", allowed: "", forbidden: "", examples: "" });
  const [result, setResult] = useState<PersonaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const set = (k: keyof typeof answers) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setAnswers((a) => ({ ...a, [k]: e.target.value }));

  function generate() {
    setError(null);
    setFields({});
    start(async () => {
      const r = await generatePersonaDraft({ ...answers, name: botName });
      if (r.ok && r.data) setResult(r.data);
      else if (!r.ok) {
        setError(r.error);
        setFields(r.fields ?? {});
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> Bantu buatkan persona
          </DialogTitle>
          <DialogDescription>
            Jawab beberapa pertanyaan. AI akan menyusun draf instruksi dan pesan sambutan. Kamu tetap bisa mengeditnya sebelum disimpan.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pa-purpose">Bot ini untuk apa? *</Label>
              <Textarea
                id="pa-purpose"
                rows={2}
                placeholder="Contoh: menjawab pertanyaan pelanggan toko kopi online saya tentang produk, pengiriman, dan cara seduh."
                value={answers.purpose}
                onChange={set("purpose")}
                aria-invalid={!!fields.purpose}
              />
              {fields.purpose && <p className="text-sm text-destructive">{fields.purpose}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-audience">Siapa yang akan chat dengan bot?</Label>
              <Input id="pa-audience" placeholder="Contoh: pembeli umum, kebanyakan anak muda" value={answers.audience} onChange={set("audience")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-tone">Gaya bahasa</Label>
              <Select value={answers.tone} onValueChange={(v) => setAnswers((a) => ({ ...a, tone: v }))}>
                <SelectTrigger id="pa-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t.v} value={t.v}>
                      {t.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pa-allowed">Topik yang boleh dibahas</Label>
                <Textarea id="pa-allowed" rows={2} placeholder="Produk, harga, ongkir, cara seduh" value={answers.allowed} onChange={set("allowed")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pa-forbidden">Yang tidak boleh</Label>
                <Textarea id="pa-forbidden" rows={2} placeholder="Membahas politik, menjanjikan diskon" value={answers.forbidden} onChange={set("forbidden")} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-examples">Contoh pertanyaan yang sering muncul</Label>
              <Textarea
                id="pa-examples"
                rows={3}
                placeholder={"Kopi mana yang tidak terlalu asam?\nBerapa lama pengiriman ke Surabaya?"}
                value={answers.examples}
                onChange={set("examples")}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Batal
              </Button>
              <Button onClick={generate} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {pending ? "Menyusun draf..." : "Susun draf"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pa-result-prompt">Draf instruksi</Label>
              <Textarea
                id="pa-result-prompt"
                rows={12}
                value={result.system_prompt}
                onChange={(e) => setResult({ ...result, system_prompt: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pa-result-welcome">Draf pesan sambutan</Label>
              <Input
                id="pa-result-welcome"
                value={result.welcome_message}
                onChange={(e) => setResult({ ...result, welcome_message: e.target.value })}
              />
            </div>
            <p className="text-sm text-muted-foreground">Memakai draf ini akan mengganti isi instruksi dan pesan sambutan di form. Belum tersimpan sampai kamu menekan Simpan.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>
                Ubah jawaban
              </Button>
              <Button
                onClick={() => {
                  onApply(result);
                  onOpenChange(false);
                  setResult(null);
                }}
              >
                Pakai draf ini
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
