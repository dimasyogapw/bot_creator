import { MemoryManager } from "@/components/memory/memory-manager";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import type { Channel } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export interface EndUserWithMemories {
  id: string;
  channel: Channel;
  display_name: string | null;
  external_id: string;
  last_seen_at: string;
  memories: { id: string; content: string; importance: number; updated_at: string }[];
}

export default async function MemoryPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);
  const { data, error } = await supabase
    .from("end_users")
    .select("id, channel, display_name, external_id, last_seen_at, memories(id, content, importance, updated_at)")
    .eq("bot_id", bot.id)
    .order("last_seen_at", { ascending: false })
    .returns<EndUserWithMemories[]>();
  if (error) console.error("[memory] gagal memuat", error);
  const users = (data ?? [])
    .filter((u) => u.memories.length > 0)
    .map((u) => ({ ...u, memories: [...u.memories].sort((a, b) => b.importance - a.importance || b.updated_at.localeCompare(a.updated_at)) }));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <MemoryManager key={bot.id} botId={bot.id} enabled={bot.memory_enabled} users={users} loadError={error ? "Daftar memory gagal dimuat." : undefined} />
    </main>
  );
}
