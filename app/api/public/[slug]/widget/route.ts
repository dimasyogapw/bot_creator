import { getPublicBot } from "@/lib/publish/public";
import { widgetSchema } from "@/lib/publish/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Konfigurasi tampilan widget (dibaca widget.js dari website pemasang). Hanya data tampilan. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const bot = await getPublicBot(slug).catch(() => null);
  // "Tidak ditemukan" tidak boleh di-cache: bot yang baru dipublikasikan harus langsung tampil.
  // (Ditemukan saat test Production: CDN Vercel menyimpan 404 selama 60 detik.)
  if (!bot) return Response.json({ error: "Bot tidak ditemukan." }, { status: 404, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" };
  const w = widgetSchema.parse(bot.widget ?? {});
  return Response.json({ name: bot.name, color: w.color, position: w.position, buttonText: w.buttonText }, { headers });
}
