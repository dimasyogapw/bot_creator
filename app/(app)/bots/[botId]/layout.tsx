import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getBotOr404 } from "@/lib/bots/queries";
import { BotAvatar } from "@/components/ui/bot-avatar";
import { BotTabs } from "@/components/bots/bot-tabs";

export default async function BotLayout({ children, params }: { children: React.ReactNode; params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const bot = await getBotOr404(botId);
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b">
        <div className="mx-auto w-full max-w-6xl px-4 pt-3">
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="Kembali ke daftar bot" className="-ml-2 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground sm:size-9">
              <ChevronLeft className="size-5" />
            </Link>
            <BotAvatar name={bot.name} url={bot.avatar_url} className="size-8" />
            <h1 className="truncate text-lg font-semibold">{bot.name}</h1>
          </div>
          <BotTabs botId={bot.id} />
        </div>
      </div>
      {children}
    </div>
  );
}
