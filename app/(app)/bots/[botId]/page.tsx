import { redirect } from "next/navigation";

export default async function BotIndex({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  redirect(`/bots/${botId}/playground`);
}
