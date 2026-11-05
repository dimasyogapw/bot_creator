import Link from "next/link";
import { ChevronLeft, Download, Users } from "lucide-react";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { listBotSkills } from "@/lib/skills/runtime";
import { formatDateTime } from "@/lib/conversations/labels";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);
  const [{ data, error }, skills] = await Promise.all([
    supabase.from("leads").select("id, data, conversation_id, created_at").eq("bot_id", bot.id).order("created_at", { ascending: false }).limit(500),
    listBotSkills(supabase, bot.id, bot.model),
  ]);
  if (error) console.error("[leads] gagal memuat", error);
  const leads = (data ?? []) as { id: string; data: Record<string, string>; conversation_id: string | null; created_at: string }[];
  const fieldDefs = ((skills.find((s) => s.skill.type === "capture_lead")?.config as { fields?: { key: string; label: string }[] } | null)?.fields ?? []).map((f) => [f.key, f.label] as const);
  // Kolom: field yang dikonfigurasi + kunci lain yang pernah tersimpan.
  const extra = [...new Set(leads.flatMap((l) => Object.keys(l.data)))].filter((k) => !fieldDefs.some(([f]) => f === k)).map((k) => [k, k] as const);
  const cols = [...fieldDefs, ...extra];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <Link href={`/bots/${bot.id}/skills`} className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground sm:min-h-8">
        <ChevronLeft className="size-4" /> Skills
      </Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Data pelanggan</h2>
        {leads.length > 0 && (
          <Button asChild variant="outline">
            <a href={`/api/bots/${bot.id}/leads`} download>
              <Download /> Unduh CSV
            </a>
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Data pelanggan gagal dimuat. Muat ulang halaman.
        </p>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
          <Users className="mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Belum ada data pelanggan</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Nyalakan skill &quot;Simpan data pelanggan&quot;. Data muncul di sini saat pengguna memberikannya ke bot.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm" data-testid="leads-table">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium whitespace-nowrap">Waktu</th>
                {cols.map(([k, label]) => (
                  <th key={k} className="px-3 py-2 font-medium whitespace-nowrap">
                    {label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Percakapan</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(l.created_at)}</td>
                  {cols.map(([k]) => (
                    <td key={k} className="px-3 py-2">
                      {l.data[k] ?? ""}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {l.conversation_id && (
                      <Link href={`/bots/${bot.id}/conversations/${l.conversation_id}`} className="text-primary underline-offset-4 hover:underline">
                        Buka
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
