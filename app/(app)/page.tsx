import Link from "next/link";
import { Bot as BotIcon, Plus } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { RetryButton } from "@/components/retry-button";
import type { Bot } from "@/lib/db/types";

export const dynamic = "force-dynamic";

type Row = Bot & { conversations: { count: number }[] };

export default async function BotsPage() {
  const { supabase } = await getUser();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("bots")
    .select("*, conversations(count)")
    .gte("conversations.created_at", since)
    .order("updated_at", { ascending: false });
  if (error) console.error("[bots] gagal memuat", error);
  const bots = (data ?? []) as Row[];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bot saya</h1>
          <p className="text-sm text-muted-foreground">Buat, atur, dan uji chatbot.</p>
        </div>
        {bots.length > 0 && (
          <Button asChild>
            <Link href="/bots/new">
              <Plus /> Bot baru
            </Link>
          </Button>
        )}
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Daftar bot gagal dimuat.</p>
          <p className="mt-1 text-muted-foreground">Periksa koneksi internet, lalu coba lagi.</p>
          <RetryButton className="mt-4" />
        </div>
      ) : bots.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
          <span className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BotIcon className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">Belum ada bot</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Buat bot pertamamu. Asisten persona bisa membantu menyusun kepribadiannya dalam beberapa menit.
          </p>
          <Button asChild className="mt-6">
            <Link href="/bots/new">
              <Plus /> Buat bot pertama
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((b) => (
            <li key={b.id}>
              <Link
                href={`/bots/${b.id}/playground`}
                className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors duration-150 outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex items-center gap-3">
                  <BotAvatar name={b.name} url={b.avatar_url} className="size-10" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{b.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{b.model}</p>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between text-sm text-muted-foreground">
                  <span>{b.conversations?.[0]?.count ?? 0} chat dalam 7 hari</span>
                  <Badge variant={b.is_public ? "default" : "outline"}>{b.is_public ? "Publik" : "Pribadi"}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
