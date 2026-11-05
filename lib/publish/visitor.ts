import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Percakapan milik pengunjung ini di bot ini (null jika bukan miliknya). */
export async function visitorConversation(botId: string, visitorId: string, conversationId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("conversations")
    .select("id, end_users!inner(external_id, channel)")
    .eq("id", conversationId)
    .eq("bot_id", botId)
    .eq("end_users.external_id", visitorId)
    .in("end_users.channel", ["web", "widget"])
    .maybeSingle();
  return data ? (data.id as string) : null;
}
