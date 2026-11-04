import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { runBot, type BotEvent } from "@/lib/bot/runBot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    conversationId: z.string().uuid().nullish(),
    message: z.string().trim().min(1).max(8000).optional(),
    regenerate: z.boolean().optional(),
  })
  .refine((b) => (b.regenerate ? !!b.conversationId : !!b.message), { message: "Pesan kosong" });

/** Adapter channel playground: meneruskan event runBot sebagai NDJSON. */
export async function POST(req: Request, ctx: { params: Promise<{ botId: string }> }) {
  const { botId } = await ctx.params;
  if (!z.string().uuid().safeParse(botId).success) return json({ error: "Bot tidak valid." }, 400);

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Pesan tidak valid. Maksimal 8000 karakter." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "Format permintaan salah." }, 400);
  }

  const { supabase: db, user } = await getUser();
  if (!user) return json({ error: "Sesi berakhir. Silakan login lagi." }, 401);

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: BotEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        for await (const event of runBot({
          db,
          botId,
          conversationId: body.conversationId,
          userMessage: body.message,
          regenerate: body.regenerate,
          channel: "playground",
          signal: abort.signal,
        })) {
          send(event);
        }
      } catch (e) {
        console.error("[chat] error tak terduga", e);
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
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

function json(data: unknown, status: number) {
  return Response.json(data, { status });
}
