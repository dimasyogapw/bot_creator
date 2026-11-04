import { KnowledgeManager } from "@/components/knowledge/knowledge-manager";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import type { KnowledgeSource } from "@/lib/db/types";
import { SOURCE_COLUMNS } from "@/lib/knowledge/process";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);
  const { data, error } = await supabase
    .from("knowledge_sources")
    .select(SOURCE_COLUMNS)
    .eq("bot_id", bot.id)
    .order("created_at", { ascending: false })
    .returns<KnowledgeSource[]>();
  if (error) console.error("[knowledge] gagal memuat sumber", error);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">
          Bot mencari jawaban di sumber ini, menyebut nomor sumbernya, dan bilang tidak tahu jika informasinya tidak ada.
        </p>
      </div>
      <KnowledgeManager key={bot.id} botId={bot.id} initialSources={data ?? []} loadError={error ? "Daftar knowledge gagal dimuat." : undefined} />
    </main>
  );
}
