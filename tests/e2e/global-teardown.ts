import fs from "node:fs";
import { admin, readTestUser, STATE_FILE } from "./test-user";

export default async function globalTeardown() {
  if (!fs.existsSync(STATE_FILE)) return;
  const { id } = readTestUser();
  await admin().auth.admin.deleteUser(id);
  fs.unlinkSync(STATE_FILE);
}
