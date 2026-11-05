import { SkillsManager } from "@/components/skills/skills-manager";
import { getBotOr404 } from "@/lib/bots/queries";
import { getUser } from "@/lib/supabase/server";
import { listBotSkills } from "@/lib/skills/runtime";
import type { SkillView } from "@/lib/skills/view";

export const dynamic = "force-dynamic";

export default async function SkillsPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const [bot, { supabase }] = await Promise.all([getBotOr404(botId), getUser()]);

  let views: SkillView[] = [];
  let loadError: string | undefined;
  try {
    const all = await listBotSkills(supabase, bot.id);
    views = await Promise.all(
      all.map(async (r) => {
        let storedSecrets: string[] = [];
        const headers = ((r.skill.config as { headers?: { name: string; secret?: boolean }[] })?.headers ?? []).filter((h) => h.secret);
        if (r.skill.id && headers.length) {
          // Hanya nama header yang dikirim ke browser, nilainya tidak.
          const { data } = await supabase.rpc("get_skill_secrets", { p_skill_id: r.skill.id });
          storedSecrets = ((data ?? []) as { key: string }[]).map((x) => x.key);
        }
        return {
          key: r.skill.id ?? r.skill.type,
          id: r.skill.id,
          type: r.skill.type,
          name: r.skill.name,
          toolName: r.skill.tool_name,
          label: r.def.label,
          ownerDescription: r.def.ownerDescription,
          defaultDescription: r.def.defaultDescription,
          enabled: r.skill.enabled,
          description: r.skill.description,
          config: r.config ?? r.skill.config,
          configValid: r.config !== null,
          available: r.available.ok ? { ok: true } : { ok: false, reason: r.available.reason },
          storedSecrets,
        };
      }),
    );
  } catch (e) {
    console.error("[skills] gagal memuat", e);
    loadError = "Daftar skill gagal dimuat.";
  }

  const [{ count: readyKnowledge }, { count: leadCount }] = await Promise.all([
    supabase.from("knowledge_sources").select("id", { count: "exact", head: true }).eq("bot_id", bot.id).eq("status", "ready"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("bot_id", bot.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <p className="mb-6 text-sm text-muted-foreground">
        Skill adalah kemampuan tambahan bot. Bot memutuskan sendiri kapan memakainya berdasarkan percakapan. Skill yang dimatikan tidak pernah dipakai.
      </p>
      <SkillsManager key={bot.id} botId={bot.id} skills={views} readyKnowledge={readyKnowledge ?? 0} leadCount={leadCount ?? 0} loadError={loadError} />
    </main>
  );
}
