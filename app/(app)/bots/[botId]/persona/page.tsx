import { BotForm } from "@/components/bots/bot-form";
import { getBotOr404 } from "@/lib/bots/queries";
import { getChatModels } from "@/lib/llm/models";

export default async function PersonaPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const [bot, { models, defaultModel, error }] = await Promise.all([getBotOr404(botId), getChatModels()]);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <BotForm key={bot.updated_at} bot={bot} models={models} defaultModel={defaultModel} modelsError={error} />
    </main>
  );
}
