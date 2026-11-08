import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { admin, readTestUser } from "./test-user";

/**
 * Fase 7: Telegram (Definition of Done), diuji dengan server Telegram TIRUAN di localhost
 * (aplikasi lokal diarahkan lewat env TELEGRAM_API_BASE, diabaikan di Vercel).
 * 1. Hubungkan token -> status tersambung, webhook terdaftar otomatis
 * 2. Chat: knowledge + sumber, memory (setelah /baru), skill
 * 3. Percakapan muncul di tab Percakapan, channel Telegram
 * 4. Kode rahasia salah ditolak tanpa memanggil model; update ganda hanya dibalas sekali
 * 5. Token tidak ada di HTML, tabel biasa; owner lain/anon tidak bisa membaca
 * 6. Batas per menit dan biaya harian berlaku
 * 7. Format HTML ditolak Telegram -> dikirim ulang sebagai teks biasa
 * 8. Putuskan: webhook dihapus, rahasia ditimpa, pesan berikutnya ditolak
 * Test Production hanya memeriksa hal yang aman tanpa token nyata.
 */

const SHOTS = "tests/e2e/screenshots";
const REMOTE = !!process.env.E2E_BASE_URL;
const MOCK_PORT = 3197;
const TOKEN = "123456789:AAH_e2e_test_token_abcdefghijklmnopqrstu";
const BAD_TOKEN = "000000000:AAH_e2e_unauthorized_token_abcdefghijk";
const CHAT = 5001;

interface Sent {
  chat_id: number;
  text: string;
  parse_mode?: string;
}
const calls: { method: string; token: string; body: Record<string, unknown> }[] = [];
const sent: Sent[] = [];
let server: http.Server | undefined;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png`, fullPage: true });
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-375.png`, fullPage: true });
  await page.setViewportSize(vp);
}

async function login(page: Page) {
  const u = readTestUser();
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Bot saya" })).toBeVisible();
}

function startMock() {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url ?? "");
      const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (!m) return send(404, { ok: false, error_code: 404, description: "Not Found" });
      const [, token, method] = m;
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}
      calls.push({ method, token, body });
      if (token.startsWith("000000000:")) return send(401, { ok: false, error_code: 401, description: `Unauthorized (bot${token})` });
      if (method === "getMe") return send(200, { ok: true, result: { id: 123456789, is_bot: true, first_name: "Kopi Senja Tes", username: "kopi_tes_bot" } });
      if (method === "sendMessage") {
        const text = String(body.text ?? "");
        // Simulasi Telegram menolak HTML tak valid
        if (body.parse_mode === "HTML" && text.includes("MARKER_FALLBACK")) return send(400, { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" });
        sent.push({ chat_id: Number(body.chat_id), text, parse_mode: body.parse_mode as string | undefined });
        return send(200, { ok: true, result: { message_id: sent.length } });
      }
      return send(200, { ok: true, result: true });
    });
  });
  return new Promise<void>((r) => server!.listen(MOCK_PORT, "localhost", () => r()));
}

const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const msgsFor = (chat: number) => sent.filter((s) => s.chat_id === chat);

async function waitReplies(chat: number, count: number, timeout = 120_000) {
  await expect.poll(() => msgsFor(chat).length, { timeout, intervals: [500, 1000] }).toBeGreaterThanOrEqual(count);
}

let updateSeq = 1000;
function textUpdate(chat: number, text: string, updateId = ++updateSeq) {
  return { update_id: updateId, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: "private" }, from: { id: chat, is_bot: false, first_name: "Budi", username: "budi_tes" }, text } };
}

let botId = "";
let connId = "";
let secret = "";

function post(request: APIRequestContext, body: unknown, headerSecret: string | null = secret, id = connId) {
  return request.post(`/api/telegram/webhook/${id}`, { data: body as object, headers: headerSecret === null ? {} : { "x-telegram-bot-api-secret-token": headerSecret } });
}

async function countAssistant() {
  const { count } = await admin().from("messages").select("id, conversations!inner(bot_id, channel)", { count: "exact", head: true }).eq("conversations.bot_id", botId).eq("conversations.channel", "telegram").eq("role", "assistant");
  return count ?? 0;
}

test.describe.serial("Fase 7: Telegram", () => {
  test.beforeAll(async () => {
    const u = readTestUser();
    const { data, error } = await admin()
      .from("bots")
      .insert({
        owner_id: u.id,
        name: "Kopi Senja Telegram",
        slug: `kopi-tg-${Date.now().toString(36)}`,
        model: process.env.LLM_LIGHT_MODEL ?? "claude-haiku-5-5",
        temperature: 0.2,
        memory_enabled: true,
        welcome_message: "Halo! Selamat datang di Kopi Senja.",
        system_prompt: "Kamu CS toko Kopi Senja. Jawab singkat dalam bahasa Indonesia. Jawab hanya dari knowledge atau hasil alat, jangan mengarang. Jika pengguna menyebut namanya, ingat dan tanggapi ramah.",
      })
      .select("id")
      .single();
    if (error) throw error;
    botId = data.id;
    if (!REMOTE) await startMock();
  });

  test.afterAll(async () => {
    await new Promise((r) => (server ? server.close(r) : r(null)));
  });

  test("Production aman: webhook tanpa koneksi ditolak, kartu Telegram tampil, tanpa token tombol mati", async ({ page, request }) => {
    const r1 = await request.post(`/api/telegram/webhook/${"00000000-0000-4000-8000-000000000000"}`, { data: { update_id: 1 }, headers: { "x-telegram-bot-api-secret-token": "apa-saja" } });
    expect(r1.status()).toBe(404);
    const r2 = await request.post(`/api/telegram/webhook/bukan-uuid`, { data: {} });
    expect(r2.status()).toBe(404);
    // Tanpa login pun halaman publik tidak bocor: API aksi bukan endpoint terbuka
    await login(page);
    await page.goto(`/bots/${botId}/publish`);
    await expect(page.getByTestId("telegram-card")).toBeVisible();
    await expect(page.getByTestId("telegram-card").getByRole("heading", { name: "Telegram" })).toBeVisible();
    await expect(page.getByTestId("telegram-connect")).toBeDisabled();
    await expect(page.getByTestId("telegram-token")).toHaveAttribute("type", "password");
    await shot(page, "p7-01-telegram-card-empty");
  });

  test("DoD 1 + 5: token salah ditolak; token benar tersambung; token tidak bocor", async ({ page }) => {
    test.skip(REMOTE, "Butuh server Telegram tiruan di localhost");
    await login(page);
    await page.goto(`/bots/${botId}/publish`);
    await page.getByTestId("telegram-token").fill("bukan-token-sama-sekali");
    await page.getByTestId("telegram-connect").click();
    await expect(page.getByTestId("telegram-error")).toContainText("Bentuk token tidak sesuai");
    await page.getByTestId("telegram-token").fill(BAD_TOKEN);
    await page.getByTestId("telegram-connect").click();
    await expect(page.getByTestId("telegram-error")).toContainText("Token ditolak Telegram");
    // Pesan galat tidak memuat token
    expect(await page.getByTestId("telegram-error").innerText()).not.toContain(BAD_TOKEN);
    const { count: leftover } = await admin().from("channel_connections").select("id", { count: "exact", head: true }).eq("bot_id", botId);
    expect(leftover).toBe(0); // koneksi gagal tidak meninggalkan baris

    await page.getByTestId("telegram-token").fill(TOKEN);
    await page.getByTestId("telegram-connect").click();
    await expect(page.getByTestId("telegram-status")).toHaveText("Tersambung", { timeout: 30_000 });
    await expect(page.getByTestId("telegram-link")).toHaveAttribute("href", "https://t.me/kopi_tes_bot");

    // Webhook terdaftar otomatis dengan kode rahasia acak dan hanya update "message"
    const wh = calls.filter((c) => c.method === "setWebhook" && c.token === TOKEN).at(-1)!;
    expect(String(wh.body.url)).toMatch(/\/api\/telegram\/webhook\/[0-9a-f-]{36}$/);
    expect(String(wh.body.secret_token).length).toBeGreaterThanOrEqual(32);
    expect(wh.body.allowed_updates).toEqual(["message"]);
    secret = String(wh.body.secret_token);
    connId = String(wh.body.url).split("/").pop()!;

    // Rahasia ada di Vault (hanya server), TIDAK di tabel biasa, TIDAK di HTML
    const db = admin();
    const { data: row } = await db.from("channel_connections").select("*").eq("id", connId).single();
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain(secret);
    const { data: vault } = await db.rpc("get_channel_secrets", { p_connection_id: connId });
    const v = Object.fromEntries((vault as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    expect(v.token).toBe(TOKEN);
    expect(v.webhook_secret).toBe(secret);
    await page.reload();
    const html = await page.content();
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain(secret);
    expect(html).not.toContain("AAH_e2e_test_token");
    await expect(page.getByTestId("telegram-token")).toHaveCount(0); // form tersembunyi saat tersambung
    await shot(page, "p7-02-telegram-connected");
  });

  test("DoD 4: kode rahasia salah/tanpa header ditolak tanpa memanggil model; koneksi tak dikenal 404", async ({ request }) => {
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    const before = { sent: sent.length, msgs: await countAssistant() };
    expect((await post(request, textUpdate(CHAT, "halo"), "rahasia-salah")).status()).toBe(401);
    expect((await post(request, textUpdate(CHAT, "halo"), null)).status()).toBe(401);
    expect((await post(request, textUpdate(CHAT, "halo"), secret.slice(0, -1))).status()).toBe(401); // hampir benar
    expect((await post(request, textUpdate(CHAT, "halo"), secret, "00000000-0000-4000-8000-000000000000")).status()).toBe(404);
    // Isi tak valid dengan kode benar: dibalas 200 (agar Telegram tidak mengulang) tapi diabaikan
    expect((await request.post(`/api/telegram/webhook/${connId}`, { data: "bukan json {{", headers: { "x-telegram-bot-api-secret-token": secret, "content-type": "text/plain" } })).status()).toBe(200);
    expect((await post(request, { update_id: "x" })).status()).toBe(200);
    // Grup diabaikan
    expect((await post(request, { update_id: 77001, message: { message_id: 1, chat: { id: -100, type: "group" }, from: { id: 1, is_bot: false }, text: "halo grup" } })).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 2500));
    expect(sent.length).toBe(before.sent);
    expect(await countAssistant()).toBe(before.msgs);
  });

  test("perintah /start, /baru, pesan non-teks, dan format yang ditolak Telegram", async ({ request }) => {
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    const chat = 5002;
    expect((await post(request, textUpdate(chat, "/start"))).status()).toBe(200);
    await waitReplies(chat, 1);
    expect(plain(msgsFor(chat)[0].text)).toBe("Halo! Selamat datang di Kopi Senja.");
    expect(msgsFor(chat)[0].parse_mode).toBe("HTML");

    expect((await post(request, { update_id: ++updateSeq, message: { message_id: 9, chat: { id: chat, type: "private" }, from: { id: chat, is_bot: false }, photo: [{ file_id: "x" }] } })).status()).toBe(200);
    await waitReplies(chat, 2);
    expect(msgsFor(chat)[1].text).toContain("hanya bisa membaca pesan teks");

    expect((await post(request, textUpdate(chat, "/baru"))).status()).toBe(200);
    await waitReplies(chat, 3);
    expect(msgsFor(chat)[2].text).toContain("Percakapan baru dimulai");

    // Format HTML ditolak Telegram -> kirim ulang sebagai teks biasa (tanpa parse_mode, tanpa tanda **)
    await admin().from("bots").update({ welcome_message: "Halo **MARKER_FALLBACK** selamat datang" }).eq("id", botId);
    expect((await post(request, textUpdate(chat, "/start"))).status()).toBe(200);
    await waitReplies(chat, 4);
    const fb = msgsFor(chat)[3];
    expect(fb.parse_mode).toBeUndefined();
    expect(fb.text).toBe("Halo MARKER_FALLBACK selamat datang");
    expect(calls.filter((c) => c.method === "sendMessage" && String(c.body.text).includes("<b>MARKER_FALLBACK</b>")).length).toBeGreaterThanOrEqual(1); // sempat dicoba dengan HTML
    await admin().from("bots").update({ welcome_message: "Halo! Selamat datang di Kopi Senja." }).eq("id", botId);
  });

  test("siapkan knowledge", async ({ page }) => {
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    await login(page);
    await page.goto(`/bots/${botId}/knowledge`);
    await page.getByRole("tab", { name: "Teks" }).click();
    await page.getByLabel("Judul").fill("Jam operasional toko");
    await page.getByLabel("Isi").fill("Toko Kopi Senja buka setiap hari pukul 08.00 sampai 21.00 WIB, termasuk hari libur nasional.");
    await page.getByRole("button", { name: "Simpan teks" }).click();
    await expect(page.getByTestId("knowledge-source").filter({ hasText: "Jam operasional toko" })).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
  });

  test("DoD 2 + 3: knowledge dengan sumber, memory setelah /baru, skill jam; percakapan muncul di tab Percakapan", async ({ request, page }) => {
    test.setTimeout(360_000);
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    // Knowledge + sumber
    expect((await post(request, textUpdate(CHAT, "Toko buka jam berapa?"))).status()).toBe(200);
    await waitReplies(CHAT, 1);
    const k = plain(msgsFor(CHAT)[0].text);
    expect(k).toContain("08.00");
    expect(k).toMatch(/Sumber: Jam operasional toko/);

    // Memory: perkenalan, tunggu ekstraksi, /baru, lalu tanya nama di percakapan baru
    expect((await post(request, textUpdate(CHAT, "Halo, nama saya Sari dan saya suka teh melati."))).status()).toBe(200);
    await waitReplies(CHAT, 2);
    await expect
      .poll(async () => ((await admin().from("memories").select("content").eq("bot_id", botId)).data ?? []).map((m) => m.content as string).join(" | "), { timeout: 90_000, intervals: [1000, 2000] })
      .toMatch(/Sari/);
    expect((await post(request, textUpdate(CHAT, "/baru"))).status()).toBe(200);
    await waitReplies(CHAT, 3);
    expect((await post(request, textUpdate(CHAT, "Siapa nama saya?"))).status()).toBe(200);
    await waitReplies(CHAT, 4);
    expect(plain(msgsFor(CHAT)[3].text)).toMatch(/Sari/);

    // Skill jam dan tanggal
    expect((await post(request, textUpdate(CHAT, "Jam berapa sekarang?"))).status()).toBe(200);
    await waitReplies(CHAT, 5);
    expect(plain(msgsFor(CHAT)[4].text)).toMatch(/WIB/);
    expect(plain(msgsFor(CHAT)[4].text)).toMatch(/\d{1,2}[.:]\d{2}/);

    // Percakapan: channel telegram, pengguna tg:<chat>, dua percakapan karena /baru
    const db = admin();
    const { data: eu } = await db.from("end_users").select("id, channel, display_name").eq("bot_id", botId).eq("external_id", `tg:${CHAT}`).single();
    expect(eu!.channel).toBe("telegram");
    expect(eu!.display_name).toBe("@budi_tes");
    const { data: convs } = await db.from("conversations").select("id, channel").eq("bot_id", botId).eq("end_user_id", eu!.id);
    expect(convs!.length).toBe(2);
    expect(convs!.every((c) => c.channel === "telegram")).toBe(true);
    await login(page);
    await page.goto(`/bots/${botId}/conversations?channel=telegram`);
    await expect(page.getByText("Telegram", { exact: true }).first()).toBeVisible();
    await expect(page.locator('a[href*="/conversations/"]')).toHaveCount(2);
    await shot(page, "p7-03-conversations-telegram");
  });

  test("DoD 4: update ganda (kirim ulang oleh Telegram) hanya dibalas dan dihitung sekali", async ({ request }) => {
    test.setTimeout(180_000);
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    const chat = 5003;
    const upd = textUpdate(chat, "Toko buka jam berapa?", 880001);
    const before = await countAssistant();
    const [a, b] = await Promise.all([post(request, upd), post(request, upd)]);
    expect([a.status(), b.status()]).toEqual([200, 200]);
    expect((await post(request, upd)).status()).toBe(200);
    await waitReplies(chat, 1);
    await new Promise((r) => setTimeout(r, 6000));
    expect(msgsFor(chat).length).toBe(1);
    expect(await countAssistant()).toBe(before + 1);
    const { count } = await admin().from("channel_updates").select("update_id", { count: "exact", head: true }).eq("connection_id", connId).eq("update_id", 880001);
    expect(count).toBe(1);
  });

  test("DoD 6: batas per menit dan biaya harian berlaku (balasan ramah, model tidak dipanggil)", async ({ request }) => {
    test.setTimeout(240_000);
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    const db = admin();
    // Per menit: batas 2
    await db.from("bots").update({ per_minute_limit: 2 }).eq("id", botId);
    const chat = 5004;
    const before = await countAssistant();
    // Batas per menit memakai jendela menit tetap: mulai di awal menit supaya kelima pesan jatuh di jendela yang sama.
    const sec = new Date().getSeconds();
    if (sec > 40) await new Promise((r) => setTimeout(r, (61 - sec) * 1000));
    for (let i = 0; i < 5; i++) expect((await post(request, textUpdate(chat, `Pertanyaan nomor ${i + 1}: toko buka jam berapa?`))).status()).toBe(200);
    // 2 dijawab bot, 3 ditolak ramah. Tunggu sampai keadaan akhir tercapai (jawaban bot butuh waktu, penolakan cepat).
    await expect.poll(() => msgsFor(chat).filter((m) => m.text.includes("terlalu cepat")).length, { timeout: 150_000, intervals: [500, 1000] }).toBe(3);
    await expect.poll(() => msgsFor(chat).length, { timeout: 150_000, intervals: [1000, 2000] }).toBe(5);
    expect(await countAssistant()).toBe(before + 2);
    await db.from("bots").update({ per_minute_limit: 20 }).eq("id", botId);

    // Biaya harian 0: pesan batas, model tidak dipanggil
    await db.from("bots").update({ daily_cost_limit_usd: 0, limit_message: "Kuota harian habis, coba besok ya." }).eq("id", botId);
    const chat2 = 5005;
    const b2 = await countAssistant();
    expect((await post(request, textUpdate(chat2, "Halo"))).status()).toBe(200);
    await waitReplies(chat2, 1);
    expect(msgsFor(chat2)[0].text).toBe("Kuota harian habis, coba besok ya.");
    await new Promise((r) => setTimeout(r, 2000));
    expect(await countAssistant()).toBe(b2);
    await db.from("bots").update({ daily_cost_limit_usd: 1 }).eq("id", botId);
  });

  test("saklar mati: pesan tidak diproses; nyala lagi: diproses", async ({ page, request }) => {
    test.setTimeout(180_000);
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    await login(page);
    await page.goto(`/bots/${botId}/publish`);
    const sw = page.getByTestId("telegram-toggle");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("telegram-status")).toHaveText("Tersambung, dimatikan");
    const chat = 5006;
    const r = await post(request, textUpdate(chat, "/start"));
    expect(r.status()).toBe(200);
    await new Promise((x) => setTimeout(x, 2500));
    expect(msgsFor(chat).length).toBe(0);
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("telegram-status")).toHaveText("Tersambung");
    expect((await post(request, textUpdate(chat, "/start"))).status()).toBe(200);
    await waitReplies(chat, 1);
    // Waktu pesan terakhir tampil di kartu
    await page.reload();
    await expect(page.getByText(/Pesan terakhir:/)).toBeVisible();
  });

  test("keamanan: anon dan owner lain tidak bisa membaca koneksi, rahasia, atau fungsi rahasia", async () => {
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const anon = createClient(url, key, { auth: { persistSession: false } });
    for (const t of ["channel_connections", "channel_updates", "channel_chats"]) {
      const { data, error } = await anon.from(t).select("*").limit(5);
      expect(error || (data ?? []).length === 0, `anon tidak boleh membaca ${t}`).toBeTruthy();
    }
    for (const [fn, args] of [
      ["get_channel_secrets", { p_connection_id: connId }],
      ["set_channel_secret", { p_connection_id: connId, p_key: "token", p_value: "x" }],
      ["claim_channel_update", { p_connection_id: connId, p_update_id: 1 }],
    ] as const) {
      expect((await anon.rpc(fn, args)).error, `anon tidak boleh memanggil ${fn}`).not.toBeNull();
    }

    const db = admin();
    const email = `e2e-tg-${Date.now().toString(36)}@test.invalid`;
    const password = `Pw-${Math.random().toString(36).slice(2)}-Xx9`;
    const { data: other } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "owner" } });
    try {
      const sb = createClient(url, key, { auth: { persistSession: false } });
      expect((await sb.auth.signInWithPassword({ email, password })).error).toBeNull();
      expect((await sb.from("channel_connections").select("id").limit(5)).data ?? []).toHaveLength(0);
      for (const [fn, args] of [
        ["get_channel_secrets", { p_connection_id: connId }],
        ["set_channel_secret", { p_connection_id: connId, p_key: "token", p_value: "x" }],
      ] as const)
        expect((await sb.rpc(fn, args)).error, `owner lain tidak boleh memanggil ${fn}`).not.toBeNull();
      // Owner pun (login biasa) tidak bisa menulis tabel koneksi dari browser
      expect((await sb.from("channel_connections").insert({ bot_id: botId, channel: "telegram" }).select()).error).not.toBeNull();
    } finally {
      if (other.user) await db.auth.admin.deleteUser(other.user.id);
    }
    // Rahasia di Vault tetap utuh setelah semua percobaan itu
    const { data: vault } = await db.rpc("get_channel_secrets", { p_connection_id: connId });
    expect((vault as { key: string; value: string }[]).find((r) => r.key === "token")?.value).toBe(TOKEN);
  });

  test("DoD 8: putuskan -> webhook dihapus, rahasia ditimpa kosong, pesan berikutnya ditolak, form kembali", async ({ page, request }) => {
    test.skip(REMOTE, "Butuh koneksi Telegram tiruan");
    await login(page);
    await page.goto(`/bots/${botId}/publish`);
    await page.getByTestId("telegram-disconnect").click();
    await page.getByTestId("telegram-disconnect-confirm").click();
    await expect(page.getByTestId("telegram-token")).toBeVisible({ timeout: 30_000 });
    expect(calls.filter((c) => c.method === "deleteWebhook" && c.token === TOKEN).length).toBe(1);
    const db = admin();
    const { count } = await db.from("channel_connections").select("id", { count: "exact", head: true }).eq("id", connId);
    expect(count).toBe(0);
    // Rahasia lama tertimpa kosong: token tidak lagi tersimpan di Vault
    const { data: vault } = await db.rpc("get_channel_secrets", { p_connection_id: connId });
    expect(JSON.stringify(vault ?? [])).not.toContain(TOKEN);
    expect((await post(request, textUpdate(CHAT, "halo"))).status()).toBe(404);
    // Riwayat percakapan tetap ada
    const { count: convs } = await db.from("conversations").select("id", { count: "exact", head: true }).eq("bot_id", botId).eq("channel", "telegram");
    expect(convs).toBeGreaterThanOrEqual(2);
    await shot(page, "p7-04-telegram-disconnected");
  });

  test("hapus bot ikut memutus Telegram (webhook dilepas, token tidak tersisa)", async ({ page }) => {
    test.skip(REMOTE, "Butuh server Telegram tiruan di localhost");
    const u = readTestUser();
    const db = admin();
    const { data: bot2 } = await db.from("bots").insert({ owner_id: u.id, name: "Bot Hapus Telegram", slug: `hapus-tg-${Date.now().toString(36)}`, model: process.env.LLM_LIGHT_MODEL ?? "claude-haiku-5-5", system_prompt: "Tes." }).select("id").single();
    const token2 = "987654321:BBH_e2e_second_token_abcdefghijklmnopq";
    await login(page);
    await page.goto(`/bots/${bot2!.id}/publish`);
    await page.getByTestId("telegram-token").fill(token2);
    await page.getByTestId("telegram-connect").click();
    await expect(page.getByTestId("telegram-status")).toHaveText("Tersambung", { timeout: 30_000 });
    const { data: conn } = await db.from("channel_connections").select("id").eq("bot_id", bot2!.id).single();

    await page.goto(`/bots/${bot2!.id}/persona`);
    await page.getByRole("button", { name: "Hapus bot" }).click();
    await page.getByRole("button", { name: "Hapus permanen" }).click();
    await expect(page.getByRole("heading", { name: "Bot saya" })).toBeVisible();
    expect(calls.filter((c) => c.method === "deleteWebhook" && c.token === token2).length).toBe(1);
    const { count } = await db.from("bots").select("id", { count: "exact", head: true }).eq("id", bot2!.id);
    expect(count).toBe(0);
    const { data: vault } = await db.rpc("get_channel_secrets", { p_connection_id: conn!.id });
    expect(JSON.stringify(vault ?? [])).not.toContain(token2);
  });
});
