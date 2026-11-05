"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { savePublishSettings } from "@/lib/publish/actions";
import type { PublishSettings } from "@/lib/publish/schema";

function CopyBox({ id, label, value, multiline }: { id: string; label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        {multiline ? (
          <Textarea id={id} readOnly value={value} rows={2} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <Input id={id} readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Salin ${label.toLowerCase()}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

export function PublishForm({
  botId,
  slug,
  origin,
  usage,
  initial,
}: {
  botId: string;
  slug: string;
  origin: string;
  usage: { messages: number; costUsd: number } | null;
  initial: PublishSettings;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [domains, setDomains] = useState(initial.allowed_domains.join("\n"));
  const [saving, start] = useTransition();
  const [previewKey, setPreviewKey] = useState(0);
  const link = `${origin}/c/${slug}`;
  const embed = `<script src="${origin}/widget.js" data-bot="${slug}" async></script>`;

  function save(next: PublishSettings, msg = "Pengaturan publikasi disimpan") {
    start(async () => {
      const r = await savePublishSettings(botId, next);
      if (!r.ok) {
        toast.error(r.error);
        setV(initial);
        return;
      }
      toast.success(msg);
      setPreviewKey((k) => k + 1);
      router.refresh();
    });
  }

  const current = (): PublishSettings => ({
    ...v,
    allowed_domains: domains
      .split(/[\n,]/)
      .map((d) => d.trim().replace(/^(https?:\/\/[^/]+|[^/]+).*$/, "$1"))
      .filter(Boolean),
  });

  return (
    <div className="grid gap-6">
      <section className="flex items-start justify-between gap-4 rounded-xl border p-4 sm:p-5" aria-labelledby="pub-title">
        <div className="min-w-0">
          <h2 id="pub-title" className="text-base font-semibold">
            Publikasikan bot
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Jika aktif, siapa pun yang punya link bisa chat dengan bot ini tanpa login. Batas biaya dan pesan di bawah melindungi saldo SumoPod-mu.
          </p>
          <p className="mt-2 text-sm font-medium" aria-live="polite">
            {v.is_public ? "Bot dipublikasikan" : "Bot tidak dipublikasikan: link dan widget menampilkan halaman tidak ditemukan."}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Switch
            checked={v.is_public}
            disabled={saving}
            aria-label="Publikasikan bot"
            onCheckedChange={(on) => {
              const next = { ...current(), is_public: on };
              setV(next);
              save(next, on ? "Bot dipublikasikan" : "Bot tidak dipublikasikan lagi");
            }}
          />
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border p-4 sm:p-5" aria-labelledby="link-title">
        <h2 id="link-title" className="text-base font-semibold">
          Link dan widget
        </h2>
        <CopyBox id="pub-link" label="Link publik" value={link} />
        <div>
          <Button asChild variant="outline" size="sm">
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Buka link publik
            </a>
          </Button>
        </div>
        <CopyBox id="pub-embed" label="Kode widget" value={embed} multiline />
        <p className="-mt-2 text-xs text-muted-foreground">Tempel sebelum tag &lt;/body&gt; di website-mu. Widget hanya tampil di domain yang diizinkan di bawah.</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="w-color">Warna tombol</Label>
            <div className="flex items-center gap-2">
              <input
                id="w-color"
                type="color"
                value={v.widget.color}
                onChange={(e) => setV({ ...v, widget: { ...v.widget, color: e.target.value } })}
                className="h-11 w-14 cursor-pointer rounded-md border bg-background p-1 sm:h-9"
              />
              <span className="font-mono text-xs text-muted-foreground">{v.widget.color}</span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="w-pos">Posisi</Label>
            <select
              id="w-pos"
              value={v.widget.position}
              onChange={(e) => setV({ ...v, widget: { ...v.widget, position: e.target.value as "left" | "right" } })}
              className="h-11 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-9"
            >
              <option value="right">Kanan bawah</option>
              <option value="left">Kiri bawah</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="w-text">Teks tombol</Label>
            <Input id="w-text" value={v.widget.buttonText} maxLength={30} onChange={(e) => setV({ ...v, widget: { ...v.widget, buttonText: e.target.value } })} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="w-domains">Domain yang boleh memasang widget</Label>
          <Textarea id="w-domains" rows={3} placeholder={"tokoku.com\n*.tokoku.com"} value={domains} onChange={(e) => setDomains(e.target.value)} />
          <p className="text-xs text-muted-foreground">Satu domain per baris, mis. tokoku.com. Pakai *.tokoku.com untuk semua subdomain, dan tulis http://alamat jika situsnya belum memakai https. Link publik tidak terpengaruh.</p>
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border p-4 sm:p-5" aria-labelledby="limit-title">
        <div>
          <h2 id="limit-title" className="text-base font-semibold">
            Batas pemakaian
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Berlaku untuk link publik dan widget (bukan Playground). Batas harian direset pukul 00.00 WIB.
            {usage && (
              <>
                {" "}
                Hari ini: <span data-testid="usage-today">{usage.messages} jawaban, ${usage.costUsd.toFixed(4)}</span>.
              </>
            )}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="l-cost">Biaya maks per hari (USD)</Label>
            <Input id="l-cost" type="number" min={0} max={1000} step={0.1} value={v.daily_cost_limit_usd} onChange={(e) => setV({ ...v, daily_cost_limit_usd: Number(e.target.value) })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="l-daily">Pesan maks per hari</Label>
            <Input id="l-daily" type="number" min={0} max={100000} value={v.daily_message_limit} onChange={(e) => setV({ ...v, daily_message_limit: Number(e.target.value) })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="l-minute">Pesan maks per menit per pengunjung</Label>
            <Input id="l-minute" type="number" min={1} max={600} value={v.per_minute_limit} onChange={(e) => setV({ ...v, per_minute_limit: Number(e.target.value) })} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="l-msg">Pesan saat batas harian tercapai</Label>
          <Input id="l-msg" value={v.limit_message} maxLength={500} onChange={(e) => setV({ ...v, limit_message: e.target.value })} />
        </div>
      </section>

      <div>
        <Button onClick={() => save(current())} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Simpan pengaturan
        </Button>
      </div>

      {v.is_public && (
        <section className="grid gap-2" aria-labelledby="preview-title">
          <h2 id="preview-title" className="text-base font-semibold">
            Pratinjau widget
          </h2>
          <iframe key={previewKey} title="Pratinjau widget" src={`/embed/${slug}`} className="h-[560px] w-full max-w-sm rounded-2xl border shadow-sm" />
          <p className="text-xs text-muted-foreground">Pesan di pratinjau dihitung sebagai percakapan widget dan ikut batas pemakaian.</p>
        </section>
      )}
    </div>
  );
}
