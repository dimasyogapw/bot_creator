"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
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
import { ModelSelect } from "./model-select";
import { PersonaAssistant } from "./persona-assistant";
import { createBot, deleteBot, updateBot } from "@/lib/bots/actions";
import type { Bot } from "@/lib/db/types";

export function BotForm({
  bot,
  models,
  defaultModel,
  modelsError,
}: {
  bot?: Bot;
  models: string[];
  defaultModel: string;
  modelsError?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: bot?.name ?? "",
    avatar_url: bot?.avatar_url ?? "",
    system_prompt: bot?.system_prompt ?? "",
    model: bot?.model ?? defaultModel,
    temperature: Number(bot?.temperature ?? 0.7),
    max_tokens: bot?.max_tokens ?? 2048,
    welcome_message: bot?.welcome_message ?? "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFields({});
    startSave(async () => {
      const r = bot ? await updateBot(bot.id, values) : await createBot(values);
      if (!r.ok) {
        setFields(r.fields ?? {});
        toast.error(r.error);
        return;
      }
      toast.success(bot ? "Perubahan disimpan" : "Bot dibuat");
      if (!bot && r.data && "id" in r.data) router.push(`/bots/${r.data.id}/playground`);
      else router.refresh();
    });
  }

  const err = (k: string) =>
    fields[k] ? (
      <p id={`${k}-error`} className="text-sm text-destructive">
        {fields[k]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="font-semibold">Identitas</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="name">Nama bot *</Label>
            <Input id="name" value={values.name} onChange={set("name")} maxLength={80} aria-invalid={!!fields.name} aria-describedby="name-error" required />
            {err("name")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="avatar_url">Alamat gambar avatar</Label>
            <Input id="avatar_url" type="url" placeholder="https://..." value={values.avatar_url} onChange={set("avatar_url")} aria-invalid={!!fields.avatar_url} />
            {err("avatar_url")}
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Persona</h2>
            <p className="text-sm text-muted-foreground">Kepribadian, tugas, dan batasan bot.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setAssistantOpen(true)}>
            <Sparkles className="text-primary" /> Bantu buatkan persona
          </Button>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="system_prompt">Instruksi (system prompt)</Label>
          <Textarea
            id="system_prompt"
            rows={10}
            placeholder="Kamu adalah asisten toko kopi yang ramah..."
            value={values.system_prompt}
            onChange={set("system_prompt")}
            aria-invalid={!!fields.system_prompt}
          />
          <p className="text-xs text-muted-foreground">{values.system_prompt.length.toLocaleString("id-ID")} / 20.000 karakter</p>
          {err("system_prompt")}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="welcome_message">Pesan sambutan</Label>
          <Input id="welcome_message" placeholder="Halo! Ada yang bisa saya bantu?" value={values.welcome_message} onChange={set("welcome_message")} />
          {err("welcome_message")}
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="font-semibold">Model</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="model">Model</Label>
            <ModelSelect id="model" models={models} value={values.model} onChange={(m) => setValues((v) => ({ ...v, model: m }))} />
            {modelsError && <p className="text-xs text-muted-foreground">{modelsError}</p>}
            {err("model")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="temperature">Kreativitas: {values.temperature.toFixed(1)}</Label>
            <Slider
              id="temperature"
              min={0}
              max={1}
              step={0.1}
              value={[values.temperature]}
              onValueChange={([t]) => setValues((v) => ({ ...v, temperature: t }))}
            />
            <p className="text-xs text-muted-foreground">Rendah = konsisten, tinggi = bervariasi.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="max_tokens">Panjang jawaban maksimal (token)</Label>
            <Input
              id="max_tokens"
              type="number"
              inputMode="numeric"
              min={1024}
              max={16000}
              step={256}
              value={values.max_tokens}
              onChange={(e) => setValues((v) => ({ ...v, max_tokens: Number(e.target.value) }))}
              aria-invalid={!!fields.max_tokens}
            />
            {err("max_tokens")}
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {bot ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                <Trash2 /> Hapus bot
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus bot &quot;{bot.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>Semua percakapan bot ini ikut terhapus permanen. Tindakan ini tidak bisa dibatalkan.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    startDelete(async () => {
                      const r = await deleteBot(bot.id);
                      if (r && !r.ok) toast.error(r.error);
                    });
                  }}
                >
                  {deleting && <Loader2 className="animate-spin" />} Hapus permanen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {bot ? "Simpan perubahan" : "Buat bot"}
        </Button>
      </div>

      <PersonaAssistant
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        botName={values.name}
        onApply={(r) => setValues((v) => ({ ...v, system_prompt: r.system_prompt, welcome_message: r.welcome_message }))}
      />
    </form>
  );
}
