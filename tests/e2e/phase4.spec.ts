import http from "node:http";
import zlib from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { admin, readTestUser } from "./test-user";

/**
 * Fase 4 (Definition of Done):
 * 1. Skill webhook ke URL tes: bot memanggilnya saat relevan dan menjawab dari hasilnya
 * 2. Skill yang dimatikan tidak pernah dipanggil
 * 3. URL di luar allowlist ditolak
 * 4. Webhook error/timeout: bot menjawab sopan, tidak crash
 * 5. "Jam berapa sekarang" sesuai zona waktu bot
 * 6. Baca halaman web (hanya di aplikasi online) / cari di internet (jika API key ada)
 * 7. "Saya mau bicara dengan manusia" tercatat dan muncul di aplikasi
 * 8. Gambar yang diupload dibaca bot
 * 9. Header rahasia tidak pernah muncul di browser
 * + Simpan data pelanggan dan unduh CSV
 */

const SHOTS = "tests/e2e/screenshots";
const REMOTE = !!process.env.E2E_BASE_URL;
const SECRET = "Bearer rahasia-e2e-7Q9x";
const MOCK_PORT = 3199;

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

async function newChat(page: Page) {
  await page.goto(`/bots/${botId}/playground`);
  await page.getByRole("button", { name: "Chat baru" }).first().click();
}

async function ask(page: Page, question: string) {
  await page.getByLabel("Ketik pesan").fill(question);
  await page.keyboard.press("Enter");
  const answer = page.locator('[data-role="assistant"]').last();
  await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 120_000 });
  return answer;
}

function card(page: Page, type: string) {
  return page.locator(`[data-testid="skill-card"][data-skill="${type}"]`);
}

/** PNG polos satu warna (tanpa library). */
function png(w: number, h: number, rgb: [number, number, number]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let botId = "";
const hits: { path: string; auth?: string }[] = [];
let server: http.Server | undefined;

test.describe.serial("Fase 4: skills", () => {
  test.beforeAll(async () => {
    const u = readTestUser();
    const { data, error } = await admin()
      .from("bots")
      .insert({
        owner_id: u.id,
        name: "Toko Kopi",
        slug: `toko-kopi-${Date.now().toString(36)}`,
        model: process.env.LLM_DEFAULT_MODEL ?? "claude-haiku-5-5",
        temperature: 0.2,
        system_prompt: "Kamu CS toko kopi online. Jawab singkat dalam bahasa Indonesia. Jangan mengarang data ongkir, stok, atau harga.",
      })
      .select("id")
      .single();
    if (error) throw error;
    botId = data.id;

    if (!REMOTE) {
      // Server API tiruan (hanya untuk aplikasi lokal; aplikasi diizinkan menghubungi localhost lewat E2E_ALLOW_PRIVATE_HOSTS).
      server = http.createServer((req, res) => {
        const url = new URL(req.url!, "http://localhost");
        hits.push({ path: url.pathname, auth: req.headers.authorization });
        if (req.headers.authorization !== SECRET) {
          res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
          return;
        }
        if (url.pathname.startsWith("/lambat")) {
          setTimeout(() => res.writeHead(200).end("{}"), 6000);
          return;
        }
        const kota = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ kota, ongkir_rupiah: 23500, estimasi_hari: 2, echo_auth: req.headers.authorization }));
      });
      await new Promise<void>((r) => server!.listen(MOCK_PORT, "localhost", () => r()));
    }
  });

  test.afterAll(async () => {
    await new Promise((r) => (server ? server.close(r) : r(null)));
  });

  test("tab Skills: daftar skill bawaan, tes skill jam", async ({ page }) => {
    await login(page);
    await page.goto(`/bots/${botId}/skills`);
    await expect(card(page, "search_knowledge")).toBeVisible();
    await expect(card(page, "current_datetime")).toHaveAttribute("data-enabled", "false");
    await shot(page, "p4-01-skills");

    // DoD 5 bagian 1: nyalakan jam/tanggal dan tes
    await card(page, "current_datetime").getByRole("switch").click();
    await expect(page.getByText("Jam dan tanggal dinyalakan")).toBeVisible();
    await card(page, "current_datetime").getByRole("button", { name: "Pengaturan dan tes" }).click();
    await card(page, "current_datetime").getByRole("button", { name: "Jalankan tes" }).click();
    await expect(card(page, "current_datetime").getByText(/Berhasil:/)).toBeVisible();
  });

  test("DoD 3 + 9: webhook di luar allowlist ditolak; header rahasia tersimpan aman", async ({ page }) => {
    test.skip(REMOTE, "Butuh server API tiruan di localhost");
    await login(page);
    await page.goto(`/bots/${botId}/skills`);
    await page.getByRole("button", { name: "Tambah integrasi" }).click();
    await page.locator("#wh-name").fill("Cek ongkir");
    await page.locator("#wh-desc").fill("Hitung ongkos kirim saat pengguna menanyakan ongkir ke sebuah kota.");
    await page.locator("#wh-url").fill(`http://localhost:${MOCK_PORT}/ongkir/{kota}`);
    await page.locator("#wh-method").selectOption("GET");
    await page.locator("#wh-domains").fill("api.lain.com");
    await page.getByRole("button", { name: "Tambah parameter" }).click();
    await page.locator("#p-name-0").fill("kota");
    await page.locator("#p-desc-0").fill("Nama kota tujuan");
    await page.getByRole("button", { name: "Tambah header" }).click();
    await page.locator("#h-name-0").fill("Authorization");
    await page.locator("#h-val-0").fill(SECRET);
    await page.getByRole("button", { name: "Simpan integrasi" }).click();
    // DoD 3: domain di luar allowlist
    await expect(page.getByRole("alert").filter({ hasText: "Domain alamat harus ada di daftar domain yang diizinkan" })).toBeVisible();

    await page.locator("#wh-domains").fill("localhost");
    await page.getByRole("button", { name: "Simpan integrasi" }).click();
    await expect(page.getByText("Integrasi disimpan")).toBeVisible();
    const hook = card(page, "http_webhook");
    await expect(hook).toContainText("Cek ongkir");

    // DoD 9: nilai rahasia tidak pernah dikirim ke browser
    await page.reload();
    await hook.getByRole("button", { name: "Pengaturan dan tes" }).click();
    await hook.getByRole("button", { name: "Ubah" }).click();
    await expect(page.locator("#h-val-0")).toHaveValue("");
    await expect(page.locator("#h-val-0")).toHaveAttribute("placeholder", /Tersimpan aman/);
    expect(await page.content()).not.toContain("rahasia-e2e");
    const { data: row } = await admin().from("skills").select("config").eq("bot_id", botId).eq("type", "http_webhook").single();
    expect(JSON.stringify(row!.config)).not.toContain("rahasia-e2e");
    await page.getByRole("button", { name: "Batal" }).click();

    // Tes skill: memanggil API tiruan dengan header rahasia, hasil tersensor
    await hook.getByRole("button", { name: "Pengaturan dan tes" }).click();
    await hook.locator("textarea").fill('{"kota":"Bogor"}');
    await hook.getByRole("button", { name: "Jalankan tes" }).click();
    await expect(hook.getByText(/Berhasil: status 200/)).toBeVisible();
    await expect(hook.locator("pre")).toContainText("23500");
    await expect(hook.locator("pre")).toContainText("[RAHASIA]");
    expect(hits.at(-1)).toEqual({ path: "/ongkir/Bogor", auth: SECRET });
    await shot(page, "p4-02-webhook");
  });

  test("DoD 1 + 2: bot memanggil webhook saat relevan; dimatikan tidak pernah dipanggil", async ({ page }) => {
    test.skip(REMOTE, "Butuh server API tiruan di localhost");
    await login(page);
    await newChat(page);
    const before = hits.length;
    const answer = await ask(page, "Berapa ongkir kirim kopi ke Bandung?");
    await expect(answer).toContainText(/23[.,]?500/);
    expect(hits.slice(before).some((h) => h.path === "/ongkir/Bandung")).toBe(true);
    // Rahasia tidak bocor ke jawaban/halaman walau API memantulkannya
    expect(await page.content()).not.toContain("rahasia-e2e");
    await shot(page, "p4-03-playground-webhook");

    // Matikan
    await page.goto(`/bots/${botId}/skills`);
    await card(page, "http_webhook").getByRole("switch").click();
    await expect(page.getByText("Integrasi dimatikan")).toBeVisible();
    await newChat(page);
    const n = hits.length;
    const a2 = await ask(page, "Berapa ongkir kirim kopi ke Surabaya?");
    await expect(a2).not.toContainText(/23[.,]?500/);
    expect(hits.length).toBe(n);

    // Nyalakan lagi untuk test berikutnya
    await page.goto(`/bots/${botId}/skills`);
    await card(page, "http_webhook").getByRole("switch").click();
    await expect(page.getByText("Integrasi dinyalakan")).toBeVisible();
  });

  test("DoD 4: webhook timeout, bot menjawab sopan", async ({ page }) => {
    test.skip(REMOTE, "Butuh server API tiruan di localhost");
    const db = admin();
    const { data: s } = await db.from("skills").select("id, config").eq("bot_id", botId).eq("type", "http_webhook").single();
    await db
      .from("skills")
      .update({ config: { ...(s!.config as object), url: `http://localhost:${MOCK_PORT}/lambat/{kota}`, timeoutMs: 2000 } })
      .eq("id", s!.id);
    await login(page);
    await newChat(page);
    const answer = await ask(page, "Tolong cek ongkir ke Medan dong.");
    await expect(answer).toContainText(/maaf|belum bisa|tidak bisa|sedang|coba lagi/i);
    await expect(answer).not.toContainText(/23[.,]?500/);
    const { data: m } = await db
      .from("messages")
      .select("content, conversations!inner(bot_id)")
      .eq("conversations.bot_id", botId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const tools = (m!.content as { tools?: { ok: boolean; summary: string }[] }).tools ?? [];
    expect(tools.some((t) => !t.ok && /2 detik/.test(t.summary))).toBe(true);
  });

  test("DoD 5: jam berapa sekarang sesuai zona waktu", async ({ page }) => {
    await login(page);
    await newChat(page);
    const answer = await ask(page, "Jam berapa sekarang?");
    const now = new Date();
    const hours = [0, 1].map((d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23" }).format(new Date(now.getTime() - d * 120_000)));
    const text = await answer.innerText();
    expect(hours.some((h) => new RegExp(`\\b${h}[.:]\\d{2}`).test(text) || new RegExp(`\\b${Number(h)}[.:]\\d{2}`).test(text))).toBe(true);
    await expect(answer).toContainText(/WIB/);
  });

  test("DoD 7: minta bicara dengan manusia tercatat dan muncul di tab Percakapan", async ({ page }) => {
    await login(page);
    await page.goto(`/bots/${botId}/skills`);
    await card(page, "handoff_to_human").getByRole("switch").click();
    await expect(page.getByText("Alihkan ke manusia dinyalakan")).toBeVisible();
    await newChat(page);
    await ask(page, "Saya mau bicara langsung dengan admin manusia soal pesanan saya yang belum sampai.");
    await expect.poll(async () => (await admin().from("handoff_requests").select("id").eq("bot_id", botId).eq("status", "open")).data?.length ?? 0).toBe(1);

    await page.goto(`/bots/${botId}/conversations?handoff=open`);
    const row = page.getByTestId("conversation-row").first();
    await expect(row.getByTestId("handoff-badge")).toBeVisible();
    await row.click();
    await expect(page.getByTestId("handoff-item")).toHaveAttribute("data-status", "open");
    await expect(page.getByTestId("tool-calls").first()).toContainText("Menghubungi tim");
    await shot(page, "p4-04-handoff");
    await page.getByRole("button", { name: "Tandai selesai" }).click();
    await expect(page.getByTestId("handoff-item")).toHaveAttribute("data-status", "resolved");
  });

  test("simpan data pelanggan, tampil di halaman data, unduh CSV", async ({ page }) => {
    await login(page);
    await page.goto(`/bots/${botId}/skills`);
    await card(page, "capture_lead").getByRole("switch").click();
    await expect(page.getByText("Simpan data pelanggan dinyalakan")).toBeVisible();
    await newChat(page);
    await ask(page, "Saya mau dihubungi untuk pesan 5 kg kopi. Nama saya Rina Wulandari, nomor WA 0812-1111-2222. Silakan simpan data saya.");
    await expect.poll(async () => (await admin().from("leads").select("data").eq("bot_id", botId)).data?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.goto(`/bots/${botId}/skills/leads`);
    await expect(page.getByTestId("leads-table")).toContainText("Rina");
    await shot(page, "p4-05-leads");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Unduh CSV" }).click()]);
    const path = await download.path();
    const csv = (await import("node:fs")).readFileSync(path!, "utf8");
    expect(csv).toContain("Rina");
    expect(csv).toContain("0812-1111-2222");
  });

  test("DoD 8: gambar dari pengguna dibaca bot", async ({ page }) => {
    await login(page);
    await newChat(page);
    await page.getByLabel("Pilih gambar").setInputFiles({ name: "warna.png", mimeType: "image/png", buffer: png(64, 64, [220, 20, 20]) });
    await expect(page.getByRole("img", { name: "Gambar terlampir" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kirim pesan" })).toBeEnabled({ timeout: 20_000 });
    const answer = await ask(page, "Apa warna dominan gambar ini? Jawab satu kata.");
    await expect(answer).toContainText(/merah/i);
    await expect(page.getByTestId("user-images").last()).toBeVisible();
    await shot(page, "p4-06-image");
    // Setelah refresh gambar tetap tampil (signed URL dari bucket privat)
    await page.reload();
    await expect(page.getByTestId("user-images").last().locator("img")).toBeVisible();
  });

  test("DoD 6: baca halaman web (aplikasi online)", async ({ page }) => {
    test.skip(!REMOTE, "Claude Code web memblokir situs luar; dijalankan ke aplikasi online");
    await login(page);
    await page.goto(`/bots/${botId}/skills`);
    await card(page, "web_fetch").getByRole("switch").click();
    await expect(page.getByText("Baca halaman web dinyalakan")).toBeVisible();
    await newChat(page);
    const answer = await ask(page, "Buka https://id.wikipedia.org/wiki/Monumen_Nasional lalu sebutkan tinggi Monas menurut halaman itu.");
    await expect(answer).toContainText(/132/);
  });

  test("DoD 6: cari di internet (jika API key Tavily ada)", async ({ page }) => {
    test.skip(!process.env.E2E_WEB_SEARCH, "Isi E2E_WEB_SEARCH=1 jika TAVILY_API_KEY sudah diisi di server");
    await login(page);
    await page.goto(`/bots/${botId}/skills`);
    await card(page, "web_search").getByRole("switch").click();
    await expect(page.getByText("Cari di internet dinyalakan")).toBeVisible();
    await newChat(page);
    const answer = await ask(page, "Cari di internet: siapa presiden Indonesia saat ini? Sebutkan sumbernya.");
    await expect(answer).toContainText(/https?:\/\//);
  });
});
