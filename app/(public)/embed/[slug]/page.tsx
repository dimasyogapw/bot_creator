import type { Metadata } from "next";
import { PublicChat } from "@/components/public/public-chat";
import { publicBotOr404 } from "@/lib/publish/page";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const bot = await publicBotOr404(slug);
  return { title: bot.name, robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bot = await publicBotOr404(slug);
  return <PublicChat bot={bot} channel="widget" />;
}
