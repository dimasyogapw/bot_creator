import { expect, test, type Page } from "@playwright/test";
import { admin, readTestUser } from "./test-user";

/**
 * Fase 3 (Definition of Done):
 * 1. Percakapan A "nama saya Budi, suka kopi hitam" -> percakapan baru B tahu nama + minuman
 * 2. Memory dihapus -> bot benar-benar lupa
 * 3. Memory dimatikan -> bot tidak mengingat apa pun dan tidak membuat memory
 * 4. Tab Percakapan: daftar, filter channel, detail, feedback
 * 5. Percakapan > 30 pesan tetap dijawab, ringkasan tersimpan
 * 6. Data sensitif tidak masuk memory
 */

const SHOTS = "tests/e2e/screenshots";

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

async function ask(page: Page, question: string) {
  await page.getByLabel("Ketik pesan").fill(question);
  await page.keyboard.press("Enter");
  const answer = page.locator('[data-role="assistant"]').last();
  await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 120_000 });
  return answer;
}

async function newChat(page: Page) {
  await page.goto(`/bots/${botId}/playground`);
  await page.getByRole("button", { name: "Chat baru" }).first().click();
  await expect(page.locator('[data-role="assistant"]')).toHaveCount(0);
}

/** Tunggu ekstraksi memory di background selesai untuk percakapan aktif (memory_until mencapai jawaban terakhir). */
async function waitExtracted(page: Page) {
  const convId = new URL(page.url()).searchParams.get("c")!;
  const db = admin();
  await expect
    .poll(
      async () => {
        const { data: last } = await db.from("messages").select("created_at").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(1).single();
        const { data: conv } = await db.from("conversations").select("memory_until").eq("id", convId).single();
        return !!conv?.memory_until && Date.parse(conv.memory_until) >= Date.parse(last!.created_at);
      },
      { timeout: 90_000, intervals: [1000, 2000] },
    )
    .toBe(true);
  return convId;
}

async function memories() {
  const { data } = await admin().from("memories").select("content").eq("bot_id", botId);
  return (data ?? []).map((m) => m.content as string);
}

const NOT_KNOW = /tidak (tahu|mengetahui|ingat|memiliki|punya)|belum (tahu|mengenal|memberi|menyebut)|siapa nama(mu| kamu| anda)|boleh (saya )?tahu|tidak ada informasi/i;

let botId = "";

test.describe.serial("Fase 3: percakapan + memory", () => {
  test.beforeAll(async () => {
    const u = readTestUser();
    const { data, error } = await admin()
      .from("bots")
      .insert({
        owner_id: u.id,
        name: "Barista",
        slug: `barista-${Date.now().toString(36)}`,
        model: process.env.LLM_DEFAULT_MODEL ?? "claude-haiku-5-5",
        temperature: 0.2,
        system_prompt: "Kamu barista ramah di kedai kopi. Jawab singkat dalam bahasa Indonesia. Jika tidak tahu sesuatu tentang pengguna, katakan terus terang.",
      })
      .select("id, memory_enabled")
      .single();
    if (error) throw error;
    expect(data.memory_enabled).toBe(false); // keputusan owner: mati secara bawaan
    botId = data.id;
  });

  test("memory mati secara bawaan, lalu dinyalakan dari tab Memory", async ({ page }) => {
    await login(page);
    await page.goto(`/bots/${botId}/memory`);
    await expect(page.getByText("Belum ada memory")).toBeVisible();
    const sw = page.getByRole("switch", { name: "Ingat pengguna" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await shot(page, "p3-01-memory-off");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Memory aktif")).toBeVisible();
    await expect.poll(async () => (await admin().from("bots").select("memory_enabled").eq("id", botId).single()).data?.memory_enabled).toBe(true);
  });

  test("DoD 1 + 6: bot ingat nama dan minuman di percakapan baru; data sensitif tidak disimpan", async ({ page }) => {
    await login(page);
    await newChat(page);
    await expect(page.getByTestId("memory-status").last()).toContainText("Aktif");
    await ask(page, "Halo! Nama saya Budi dan saya suka kopi hitam tanpa gula.");
    const warn = await ask(page, "Oh ya, tolong ingat nomor kartu kredit saya 4111 1111 1111 1111 dan NIK saya 3201234567890001.");
    // Memory aktif: bot tidak boleh mengaku tidak bisa mengingat antar percakapan.
    await expect(warn).not.toContainText(/tidak (bisa|dapat) mengingat/i);
    await waitExtracted(page);

    const mem = await memories();
    expect(mem.join(" | ")).toMatch(/Budi/);
    expect(mem.join(" | ")).toMatch(/kopi hitam/i);
    // DoD 6: tidak ada nomor kartu / NIK di memory
    for (const m of mem) expect(m.replace(/\D/g, "")).not.toMatch(/4111111111111111|3201234567890001/);

    // Percakapan baru B
    await newChat(page);
    const answer = await ask(page, "Kamu ingat siapa nama saya dan minuman favorit saya?");
    await expect(answer).toContainText(/Budi/);
    await expect(answer).toContainText(/kopi hitam/i);
    await shot(page, "p3-02-playground-remembers");
    await waitExtracted(page); // pastikan background percakapan B selesai sebelum memory dihapus
  });

  test("DoD 2: memory dihapus di tab Memory, bot benar-benar lupa", async ({ page }) => {
    await login(page);
    await page.goto(`/bots/${botId}/memory`);
    await expect(page.getByTestId("memory-item").first()).toBeVisible();
    await shot(page, "p3-03-memory-list");
    await page.getByRole("button", { name: "Hapus semua" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Hapus semua" }).click();
    await expect(page.getByText("Belum ada memory")).toBeVisible();
    expect(await memories()).toEqual([]);

    await newChat(page);
    const answer = await ask(page, "Siapa nama saya dan apa minuman favorit saya?");
    await expect(answer).not.toContainText(/Budi/);
    await expect(answer).toContainText(NOT_KNOW);
    await waitExtracted(page);
  });

  test("DoD 3: memory dimatikan, bot tidak mengingat dan tidak membuat memory", async ({ page }) => {
    const db = admin();
    // Memory lama tetap ada di database, tapi tidak boleh dipakai saat memory mati.
    const { data: eu } = await db.from("end_users").select("id").eq("bot_id", botId).eq("external_id", "owner").single();
    await db.from("memories").insert({ bot_id: botId, end_user_id: eu!.id, content: "Nama pengguna Sari, suka teh tarik", importance: 5 });

    await login(page);
    await page.goto(`/bots/${botId}/memory`);
    await page.getByRole("switch", { name: "Ingat pengguna" }).click();
    await expect(page.getByText(/Memory mati/)).toBeVisible();
    await expect.poll(async () => (await db.from("bots").select("memory_enabled").eq("id", botId).single()).data?.memory_enabled).toBe(false);

    await newChat(page);
    await expect(page.getByTestId("memory-status").last()).toContainText("Mati");
    await ask(page, "Saya tinggal di Medan dan punya kucing bernama Oyen.");
    const answer = await ask(page, "Siapa nama saya?");
    await expect(answer).not.toContainText(/Sari/);
    await page.waitForTimeout(8000); // beri waktu jika ada pekerjaan background
    const mem = await memories();
    expect(mem).toEqual(["Nama pengguna Sari, suka teh tarik"]);
    expect(mem.join(" ")).not.toMatch(/Medan|Oyen/);
  });

  test("DoD 4: tab Percakapan, filter channel, detail, feedback", async ({ page }) => {
    await login(page);
    await page.goto(`/bots/${botId}/conversations`);
    const rows = page.getByTestId("conversation-row");
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    expect(total).toBeGreaterThanOrEqual(4);
    await shot(page, "p3-04-conversations");

    const filters = page.getByRole("navigation", { name: "Filter percakapan" });
    await filters.getByRole("link", { name: "Link publik" }).click();
    await expect(page.getByText("Tidak ada percakapan dengan filter ini")).toBeVisible();
    // Klik langsung setelah navigasi sebelumnya (dulu membuat navigasi tersangkut).
    await filters.getByRole("link", { name: "Playground", exact: true }).click();
    await expect(page).toHaveURL(/channel=playground/);
    await expect(rows).toHaveCount(total);

    // Detail + feedback jempol bawah
    await rows.filter({ hasText: "Halo! Nama saya Budi" }).click();
    await expect(page.locator('[data-role="user"]').first()).toContainText("Nama saya Budi");
    await expect(page.getByTestId("message-meta").first()).toContainText(/token masuk/);
    const firstAnswer = page.locator('[data-role="assistant"]').first();
    await firstAnswer.getByRole("button", { name: "Jawaban buruk" }).click();
    await expect(firstAnswer.getByRole("button", { name: "Jawaban buruk" })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "p3-05-conversation-detail");

    await page.getByRole("link", { name: "Semua percakapan" }).click();
    await page.getByRole("navigation", { name: "Filter percakapan" }).getByRole("link", { name: "Ada jempol bawah" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Halo! Nama saya Budi");
  });

  test("DoD 5: percakapan lebih dari 30 pesan tetap dijawab dan diringkas", async ({ page }) => {
    const db = admin();
    const { data: eu } = await db.from("end_users").select("id").eq("bot_id", botId).eq("external_id", "owner").single();
    const { data: conv } = await db
      .from("conversations")
      .insert({ bot_id: botId, channel: "playground", title: "Diskusi panjang menu kopi", end_user_id: eu!.id })
      .select("id")
      .single();
    const base = Date.now() - 3600_000;
    const rowsToInsert = Array.from({ length: 34 }, (_, i) => ({
      conversation_id: conv!.id,
      role: i % 2 ? "assistant" : "user",
      content: { text: i % 2 ? `Baik, menu nomor ${(i + 1) / 2} adalah ${["espresso", "latte", "cappuccino", "mocha"][i % 4]}.` : `Sebutkan menu kopi nomor ${i / 2 + 1}.` },
      created_at: new Date(base + i * 1000).toISOString(),
    }));
    rowsToInsert[0].content.text = "Kode pesanan saya hari ini KOPI-77. Sebutkan menu kopi nomor 1.";
    const { error } = await db.from("messages").insert(rowsToInsert);
    if (error) throw error;

    await login(page);
    await page.goto(`/bots/${botId}/playground?c=${conv!.id}`);
    await ask(page, "Terima kasih. Apa kode pesanan saya tadi di awal percakapan?");
    await expect
      .poll(async () => (await db.from("conversations").select("summary").eq("id", conv!.id).single()).data?.summary ?? null, { timeout: 90_000, intervals: [1000, 2000] })
      .not.toBeNull();
    const { data: after } = await db.from("conversations").select("summary, summary_until").eq("id", conv!.id).single();
    expect(after!.summary!.length).toBeGreaterThan(20);
    expect(after!.summary_until).not.toBeNull();

    // Pesan berikutnya memakai ringkasan: kode dari awal percakapan tetap diketahui.
    const answer = await ask(page, "Sebutkan lagi kode pesanan saya.");
    await expect(answer).toContainText(/KOPI-77/);

    await page.goto(`/bots/${botId}/conversations/${conv!.id}`);
    await expect(page.getByTestId("conversation-summary")).toBeVisible();
  });
});
