import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getPublicBot } from "./public";
import type { PublicBotInfo } from "@/components/public/public-chat";

/** Data bot untuk halaman publik. Hanya nama, avatar, dan sambutan; 404 jika tidak dipublikasikan. */
export const publicBotOr404 = cache(async (slug: string): Promise<PublicBotInfo> => {
  const bot = await getPublicBot(slug);
  if (!bot) notFound();
  return { slug: bot.slug, name: bot.name, avatar_url: bot.avatar_url, welcome_message: bot.welcome_message };
});
