import fs from "node:fs";
import { admin, readTestUser, STATE_FILE } from "./test-user";

export default async function globalTeardown() {
  if (!fs.existsSync(STATE_FILE)) return;
  const { id } = readTestUser();
  const db = admin();
  // File knowledge milik bot test tidak ikut terhapus oleh cascade database.
  const { data: bots } = await db.from("bots").select("id").eq("owner_id", id);
  if (bots?.length) {
    const { data: files } = await db.from("knowledge_sources").select("storage_path").in("bot_id", bots.map((b) => b.id)).not("storage_path", "is", null);
    const paths = (files ?? []).map((f) => f.storage_path as string);
    if (paths.length) await db.storage.from("knowledge").remove(paths);
    for (const b of bots) {
      const { data: imgs } = await db.storage.from("chat-uploads").list(`${b.id}/uploads`, { limit: 1000 });
      if (imgs?.length) await db.storage.from("chat-uploads").remove(imgs.map((f) => `${b.id}/uploads/${f.name}`));
    }
  }
  await db.auth.admin.deleteUser(id);
  fs.unlinkSync(STATE_FILE);
}
