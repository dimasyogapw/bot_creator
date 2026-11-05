"use client";

import { useState, useTransition } from "react";
import { Brain, Loader2, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { deleteEndUserMemories, deleteMemory, setMemoryEnabled } from "@/lib/memory/actions";
import { CHANNEL_LABELS, formatDateTime } from "@/lib/conversations/labels";
import type { Channel } from "@/lib/db/types";

interface MemoryRow {
  id: string;
  content: string;
  importance: number;
  updated_at: string;
}
interface UserRow {
  id: string;
  channel: Channel;
  display_name: string | null;
  external_id: string;
  last_seen_at: string;
  memories: MemoryRow[];
}

export function MemoryManager({ botId, enabled: initialEnabled, users: initialUsers, loadError }: { botId: string; enabled: boolean; users: UserRow[]; loadError?: string }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [users, setUsers] = useState(initialUsers);
  const [saving, start] = useTransition();

  function toggle(v: boolean) {
    setEnabled(v);
    start(async () => {
      const r = await setMemoryEnabled(botId, v);
      if (!r.ok) {
        setEnabled(!v);
        toast.error(r.error);
      } else toast.success(v ? "Memory dinyalakan" : "Memory dimatikan");
    });
  }

  async function removeOne(userId: string, m: MemoryRow) {
    const r = await deleteMemory(botId, m.id);
    if (!r.ok) return toast.error(r.error);
    setUsers((us) => us.map((u) => (u.id === userId ? { ...u, memories: u.memories.filter((x) => x.id !== m.id) } : u)).filter((u) => u.memories.length));
    toast.success("Memory dihapus");
  }

  async function removeAll(u: UserRow) {
    const r = await deleteEndUserMemories(botId, u.id);
    if (!r.ok) return toast.error(r.error);
    setUsers((us) => us.filter((x) => x.id !== u.id));
    toast.success("Semua memory pengguna ini dihapus");
  }

  return (
    <div className="grid gap-6">
      <section className="flex items-start justify-between gap-4 rounded-xl border p-4 sm:p-5" aria-labelledby="mem-title">
        <div className="min-w-0">
          <h2 id="mem-title" className="text-base font-semibold">
            Ingat pengguna
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Jika aktif, bot menyimpan fakta penting tentang tiap pengguna (nama, preferensi, konteks) dan memakainya di percakapan berikutnya. Data sensitif seperti password, nomor kartu, dan NIK tidak disimpan.
          </p>
          <p className="mt-2 text-sm font-medium" aria-live="polite">
            {enabled ? "Memory aktif" : "Memory mati: bot tidak membaca dan tidak membuat memory."}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Switch checked={enabled} onCheckedChange={toggle} disabled={saving} aria-label="Ingat pengguna" />
        </div>
      </section>

      <section aria-labelledby="mem-list-title">
        <h2 id="mem-list-title" className="mb-3 text-base font-semibold">
          Memory per pengguna
        </h2>
        {loadError ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
            <p className="font-medium text-destructive">{loadError}</p>
            <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
              Coba lagi
            </Button>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
            <Brain className="mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">Belum ada memory</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {enabled
                ? "Coba ceritakan sesuatu tentang dirimu di Playground, misalnya nama dan minuman favorit."
                : "Nyalakan memory di atas, lalu ceritakan sesuatu tentang dirimu di Playground."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {users.map((u) => (
              <li key={u.id} className="rounded-xl border" data-testid="memory-user">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <UserRound className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{u.display_name || u.external_id}</span>
                    <Badge variant="outline">{CHANNEL_LABELS[u.channel]}</Badge>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                        <Trash2 /> Hapus semua
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus semua memory {u.display_name || "pengguna ini"}?</AlertDialogTitle>
                        <AlertDialogDescription>Bot akan lupa {u.memories.length} fakta tentang pengguna ini. Riwayat percakapan tidak ikut terhapus.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeAll(u)}>Hapus semua</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <ul className="divide-y" aria-label={`Memory ${u.display_name || u.external_id}`}>
                  {u.memories.map((m) => (
                    <li key={m.id} className="flex items-start gap-3 px-4 py-2.5" data-testid="memory-item">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{m.content}</p>
                        <p className="text-xs text-muted-foreground">Diperbarui {formatDateTime(m.updated_at)}</p>
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={`Hapus memory: ${m.content}`} className="text-muted-foreground hover:text-destructive" onClick={() => removeOne(u.id, m)}>
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
