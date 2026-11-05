import type { SkillType } from "./types";

/** Data skill yang aman dikirim ke browser: tanpa nilai header rahasia. */
export interface SkillView {
  key: string;
  id: string | null;
  type: SkillType;
  name: string;
  toolName: string;
  label: string;
  ownerDescription: string;
  defaultDescription: string;
  enabled: boolean;
  description: string;
  config: unknown;
  configValid: boolean;
  available: { ok: boolean; reason?: string };
  /** Nama header rahasia yang sudah tersimpan di Vault (nilainya tidak pernah dikirim). */
  storedSecrets: string[];
}

/** Contoh argumen untuk tombol "Tes skill". */
export function sampleArgs(v: Pick<SkillView, "type" | "config">): string {
  switch (v.type) {
    case "search_knowledge":
      return JSON.stringify({ query: "jam buka" });
    case "web_fetch":
      return JSON.stringify({ url: "https://id.wikipedia.org/wiki/Monumen_Nasional" });
    case "web_search":
      return JSON.stringify({ query: "berita teknologi hari ini" });
    case "handoff_to_human":
      return JSON.stringify({ reason: "Pengguna minta bicara dengan admin", summary: "Tanya status pesanan" });
    case "capture_lead": {
      const fields = ((v.config as { fields?: { key: string; label: string }[] })?.fields ?? []).map((f) => [f.key, `contoh ${f.label.toLowerCase()}`]);
      return JSON.stringify(Object.fromEntries(fields));
    }
    case "http_webhook": {
      const params = ((v.config as { parameters?: { name: string; type: string }[] })?.parameters ?? []).map((p) => [
        p.name,
        p.type === "string" ? "contoh" : p.type === "boolean" ? true : 1,
      ]);
      return JSON.stringify(Object.fromEntries(params));
    }
    default:
      return "{}";
  }
}
