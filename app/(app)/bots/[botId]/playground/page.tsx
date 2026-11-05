import { z } from "zod";
import { Playground } from "@/components/chat/playground";
import type { UIMessage } from "@/components/chat/types";
import { getBotOr404 } from "@/lib/bots/queries";
import { getChatModels } from "@/lib/llm/models";
import { getUser } from "@/lib/supabase/server";
import type { Message } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ botId }, { c }] = await Promise.all([params, searchParams]);
  const [bot, { models }, { supabase }] = await Promise.all([getBotOr404(botId), getChatModels(), getUser()]);

  const { data: convs, error: convErr } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .eq("bot_id", bot.id)
    .eq("channel", "playground")
    .order("updated_at", { ascending: false })
    .limit(30);

  const requested = z.string().uuid().safeParse(c).success ? c! : null;
  const activeId = requested ?? convs?.[0]?.id ?? null;

  let messages: UIMessage[] = [];
  let loadError: string | undefined = convErr ? "Riwayat percakapan gagal dimuat." : undefined;
  if (activeId && !convErr) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, role, content, status, feedback, created_at, conversations!inner(bot_id)")
      .eq("conversation_id", activeId)
      .eq("conversations.bot_id", bot.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[playground] gagal memuat pesan", error);
      loadError = "Riwayat percakapan gagal dimuat.";
    }
    messages = ((data ?? []) as unknown as Message[]).map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      text: m.content?.text ?? "",
      status: m.status,
      feedback: m.feedback,
      citations: m.content?.citations,
    }));
  }
  if (convErr) console.error("[playground] gagal memuat percakapan", convErr);

  return (
    <Playground
      bot={{
        id: bot.id,
        name: bot.name,
        avatar_url: bot.avatar_url,
        model: bot.model,
        temperature: Number(bot.temperature),
        max_tokens: bot.max_tokens,
        welcome_message: bot.welcome_message,
        memory_enabled: bot.memory_enabled,
      }}
      models={models}
      conversations={convs ?? []}
      initialConversationId={activeId}
      initialMessages={messages}
      loadError={loadError}
    />
  );
}
