import { after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runBot } from "@/lib/bot/runBot";
import { checkLimits, clientIp, getPublicBot, toPublicEvent } from "@/lib/publish/public";
import { publicChatSchema } from "@/lib/publish/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOT_FOUND = { error: "Bot tidak ditemukan." };

/** Adapter channel publik (link dan widget): batas pemakaian dicek dulu, lalu runBot, event disaring. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let body: z.infer<typeof publicChatSchema>;
  try {
    const parsed = publicChatSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Pesan tidak valid. Maksimal 4000 karakter." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "Format permintaan salah." }, 400);
  }

  let bot;
  try {
    bot = await getPublicBot(slug);
  } catch {
    return json({ error: "Maaf, layanan sedang bermasalah. Coba lagi sebentar lagi." }, 500);
  }
  if (!bot) return json(NOT_FOUND, 404);

  try {
    const limit = await checkLimits(bot, body.visitorId, clientIp(req));
    if (!limit.ok) return json({ error: limit.message, limited: limit.reason }, 429);
  } catch (e) {
    console.error("[public chat] gagal cek batas", e);
    return json({ error: "Maaf, layanan sedang bermasalah. Coba lagi sebentar lagi." }, 500);
  }

  const db = createAdminClient();
  const tasks: (() => Promise<void>)[] = [];
  after(async () => {
    for (const t of tasks) await t();
  });
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: Record<string, unknown> | null) => {
        if (!open || !e) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        for await (const event of runBot({
          db,
          botId: bot.id,
          conversationId: body.conversationId,
          userMessage: body.message,
          regenerate: body.regenerate,
          channel: body.channel,
          endUser: { externalId: body.visitorId, displayName: body.channel === "widget" ? "Pengunjung widget" : "Pengunjung web" },
          defer: (t) => tasks.push(t),
          signal: abort.signal,
        })) {
          send(toPublicEvent(event));
        }
      } catch (e) {
        console.error("[public chat] error tak terduga", e);
        send({ type: "error", message: "Maaf, terjadi kesalahan. Silakan coba lagi." });
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {}
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Robots-Tag": "noindex" },
  });
}

function json(data: unknown, status: number) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
