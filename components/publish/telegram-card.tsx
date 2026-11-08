"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Send } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { connectTelegramAction, disconnectTelegramAction, setTelegramEnabledAction } from "@/lib/channels/telegram/actions";
import { formatDateTime } from "@/lib/conversations/labels";

export interface TelegramConnectionView {
  enabled: boolean;
  status: "connected" | "error";
  bot_username: string | null;
  last_error: string | null;
  last_message_at: string | null;
}

/** Bagian Telegram di tab Publikasi. Token hanya dikirim ke server, tidak pernah ditampilkan kembali. */
export function TelegramCard({ botId, connection, canConnect }: { botId: string; connection: TelegramConnectionView | null; canConnect: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function connect() {
    setError(null);
    start(async () => {
      const r = await connectTelegramAction(botId, token);
      if (!r.ok) return setError(r.error);
      setToken(""); // token tidak disimpan di browser
      setChanging(false);
      toast.success("Telegram tersambung");
      router.refresh();
    });
  }

  function toggle(v: boolean) {
    start(async () => {
      const r = await setTelegramEnabledAction(botId, v);
      if (!r.ok) return void toast.error(r.error);
      toast.success(v ? "Telegram dinyalakan" : "Telegram dimatikan");
      router.refresh();
    });
  }

  function disconnect() {
    start(async () => {
      const r = await disconnectTelegramAction(botId);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Telegram diputus");
      router.refresh();
    });
  }

  const showForm = !connection || changing;

  return (
    <section className="grid gap-4 rounded-xl border p-4 sm:p-5" aria-labelledby="tg-title" data-testid="telegram-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="tg-title" className="flex items-center gap-2 text-base font-semibold">
            <Send className="size-4" /> Telegram
            {connection && (
              <Badge variant={connection.status === "connected" ? "default" : "outline"} data-testid="telegram-status" className={connection.status === "error" ? "text-destructive" : undefined}>
                {connection.status === "connected" ? (connection.enabled ? "Tersambung" : "Tersambung, dimatikan") : "Error"}
              </Badge>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bot yang sama bisa dipakai di Telegram, lengkap dengan knowledge, memory, dan skill. Percakapan masuk ke tab Percakapan dengan channel Telegram. Batas pesan per menit dan biaya harian sama dengan link publik.
          </p>
        </div>
        {connection && (
          <Switch checked={connection.enabled} onCheckedChange={toggle} disabled={busy || connection.status === "error"} aria-label="Nyalakan Telegram" data-testid="telegram-toggle" />
        )}
      </div>

      {connection && !showForm && (
        <div className="grid gap-2 text-sm">
          {connection.bot_username && (
            <a
              href={`https://t.me/${connection.bot_username}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 font-medium text-primary underline-offset-2 hover:underline"
              data-testid="telegram-link"
            >
              @{connection.bot_username} <ExternalLink className="size-3.5" />
            </a>
          )}
          {connection.status === "error" && connection.last_error && (
            <p role="alert" className="text-destructive" data-testid="telegram-last-error">
              {connection.last_error}
            </p>
          )}
          <p className="text-muted-foreground">{connection.last_message_at ? `Pesan terakhir: ${formatDateTime(connection.last_message_at)}` : "Belum ada pesan masuk."}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)} disabled={busy || !canConnect}>
              Ganti token
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="text-muted-foreground hover:text-destructive" disabled={busy} data-testid="telegram-disconnect">
                  Putuskan
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Putuskan Telegram?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Bot Telegram berhenti menjawab dan token dihapus dari aplikasi. Riwayat percakapan tetap ada di tab Percakapan. Anda bisa menghubungkan lagi kapan saja dengan token yang sama atau yang baru.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={disconnect} data-testid="telegram-disconnect-confirm">
                    Putuskan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      {showForm && (
        <div className="grid gap-3">
          {!canConnect && (
            <p role="status" className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              Telegram hanya bisa dihubungkan dari alamat Production. Buka aplikasi lewat alamat utama (bukan Preview), lalu kembali ke halaman ini.
            </p>
          )}
          <details className="rounded-lg border px-3 py-2 text-sm" open={!connection}>
            <summary className="cursor-pointer font-medium">Cara membuat bot Telegram (sekali saja)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Buka aplikasi Telegram, cari <span className="font-medium text-foreground">@BotFather</span> (bercentang biru), lalu tekan Start.</li>
              <li>Kirim <span className="font-mono text-foreground">/newbot</span>. Isi nama tampilan, lalu username unik yang berakhiran <span className="font-mono text-foreground">bot</span>.</li>
              <li>BotFather membalas dengan <span className="font-medium text-foreground">token</span> (angka, titik dua, lalu huruf dan angka). Salin utuh.</li>
              <li>Tempel token di kolom di bawah, lalu tekan Hubungkan. Jangan bagikan token ke siapa pun, termasuk ke chat Claude.</li>
            </ol>
          </details>
          <div className="grid gap-1.5">
            <Label htmlFor="tg-token">Token dari BotFather</Label>
            <Input
              id="tg-token"
              data-testid="telegram-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={connection ? "Tempel token baru (token lama tersimpan aman, tidak ditampilkan)" : "123456789:AA..."}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="telegram-error">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={connect} disabled={busy || !canConnect || token.trim().length < 10} data-testid="telegram-connect">
              {busy && <Loader2 className="animate-spin" />} Hubungkan
            </Button>
            {changing && (
              <Button type="button" variant="outline" onClick={() => (setChanging(false), setToken(""), setError(null))} disabled={busy}>
                Batal
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
