import fs from "node:fs";
import crypto from "node:crypto";
import { admin, STATE_FILE } from "./test-user";

export default async function globalSetup() {
  const email = `e2e-${crypto.randomBytes(4).toString("hex")}@test.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "owner" } });
  if (error || !data.user) throw error ?? new Error("gagal membuat user test");
  fs.writeFileSync(STATE_FILE, JSON.stringify({ id: data.user.id, email, password }));
}
