import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BotForm } from "@/components/bots/bot-form";
import { getChatModels } from "@/lib/llm/models";

export const metadata = { title: "Bot baru | Bot Creator" };

export default async function NewBotPage() {
  const { models, defaultModel, error } = await getChatModels();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link href="/" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Daftar bot
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Bot baru</h1>
      <BotForm models={models} defaultModel={defaultModel} modelsError={error} />
    </main>
  );
}
