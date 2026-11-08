import { headers } from "next/headers";
import { PublishForm } from "@/components/publish/publish-form";
import { TelegramCard } from "@/components/publish/telegram-card";
import { getConnectionByBot } from "@/lib/channels/telegram/connection";
import { getUser } from "@/lib/supabase/server";
import { getBotOr404 } from "@/lib/bots/queries";
import { publicUsageToday } from "@/lib/publish/public";
import { widgetSchema } from "@/lib/publish/schema";

export const dynamic = "force-dynamic";

export default async function PublishPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const bot = await getBotOr404(botId); // RLS: bot milik owner
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const usage = await publicUsageToday(bot.id).catch(() => null);
  // Status koneksi dibaca lewat RLS (owner). Token dan kode rahasia tidak pernah dibaca di sini.
  const { supabase } = await getUser();
  const connection = await getConnectionByBot(supabase, bot.id).catch((e) => {
    console.error("[publish] gagal memuat koneksi telegram", e);
    return null;
  });
  const canConnect = !process.env.VERCEL || process.env.VERCEL_ENV === "production";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <PublishForm
        key={bot.id}
        botId={bot.id}
        slug={bot.slug}
        origin={origin}
        usage={usage}
        initial={{
          is_public: bot.is_public,
          daily_cost_limit_usd: Number(bot.daily_cost_limit_usd),
          daily_message_limit: bot.daily_message_limit,
          per_minute_limit: bot.per_minute_limit,
          limit_message: bot.limit_message,
          widget: widgetSchema.parse(bot.widget ?? {}),
          allowed_domains: bot.allowed_domains ?? [],
        }}
      />
      <div className="mt-6">
        <TelegramCard
          key={connection ? `${connection.id}:${connection.status}:${connection.enabled}` : "none"}
          botId={bot.id}
          canConnect={canConnect}
          connection={connection ? { enabled: connection.enabled, status: connection.status, bot_username: connection.bot_username, last_error: connection.last_error, last_message_at: connection.last_message_at } : null}
        />
      </div>
    </main>
  );
}
