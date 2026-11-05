import { expect, test, type Page } from "@playwright/test";
import { readTestUser } from "./test-user";

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

test.describe.serial("Fase 1", () => {
  test("halaman terlindungi mengarah ke login, password salah ditolak", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await shot(page, "01-login");
    const u = readTestUser();
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password").fill("salah-password");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByText("Email atau password salah.")).toBeVisible();
  });

  test("API chat menolak tanpa login", async ({ request }) => {
    const r = await request.post("/api/bots/00000000-0000-0000-0000-000000000000/chat", { data: { message: "hai" } });
    expect(r.status()).toBe(401);
  });

  test("login, empty state, buat bot Tes dengan asisten persona", async ({ page }) => {
    await login(page);
    await expect(page.getByText("Belum ada bot")).toBeVisible();
    await shot(page, "02-empty-state");

    await page.getByRole("link", { name: "Buat bot pertama" }).click();
    await page.getByLabel("Nama bot *").fill("Tes");

    // Asisten persona (memanggil model ringan sungguhan)
    await page.getByRole("button", { name: "Bantu buatkan persona" }).click();
    await page.getByLabel("Bot ini untuk apa? *").fill("Menjawab pertanyaan pelanggan toko kopi online tentang produk dan cara seduh.");
    await page.getByLabel("Siapa yang akan chat dengan bot?").fill("Pembeli umum");
    await shot(page, "03-persona-assistant");
    await page.getByRole("button", { name: "Susun draf" }).click();
    await expect(page.getByLabel("Draf instruksi")).not.toBeEmpty({ timeout: 90_000 });
    const draft = await page.getByLabel("Draf instruksi").inputValue();
    expect(draft.length).toBeGreaterThan(100);
    await shot(page, "04-persona-draft");
    await page.getByRole("button", { name: "Pakai draf ini" }).click();
    await expect(page.getByLabel("Instruksi (system prompt)")).toHaveValue(draft);
    await shot(page, "05-new-bot-form");

    await page.getByRole("button", { name: "Buat bot" }).click();
    await expect(page).toHaveURL(/\/bots\/[0-9a-f-]+\/playground$/);
    await expect(page.getByRole("heading", { name: "Tes", level: 1 })).toBeVisible();
    await shot(page, "06-playground-empty");
  });

  test("chat dengan streaming, riwayat tetap ada setelah refresh", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: /Tes/ }).first().click();
    await expect(page).toHaveURL(/playground/);

    await page.getByLabel("Ketik pesan").fill("Jelaskan 3 cara menyeduh kopi, masing-masing satu paragraf.");
    await page.keyboard.press("Enter");

    const answer = page.locator('[data-role="assistant"]').last();
    // Streaming: teks terlihat bertambah sebelum jawaban selesai.
    await expect(answer).toHaveAttribute("data-status", "streaming");
    const lengths: number[] = [];
    for (let i = 0; i < 40; i++) {
      const status = await answer.getAttribute("data-status");
      lengths.push((await answer.innerText()).length);
      if (status !== "streaming") break;
      await page.waitForTimeout(250);
    }
    await expect(answer).toHaveAttribute("data-status", "complete", { timeout: 90_000 });
    const growing = lengths.filter((l, i) => i > 0 && l > lengths[i - 1]).length;
    expect(growing, `panjang teks per 250ms: ${lengths.join(",")}`).toBeGreaterThanOrEqual(2);
    const finalText = await answer.innerText();
    await expect(page).toHaveURL(/\?c=[0-9a-f-]+/);
    // Riwayat di panel kanan ikut diperbarui
    await expect(page.getByRole("complementary", { name: "Setelan playground" })).toContainText("3 cara menyeduh kopi");
    await shot(page, "07-playground-chat");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: `${SHOTS}/07-playground-chat-dark-1440.png` });
    await page.emulateMedia({ colorScheme: "light" });

    // Feedback
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
    await answer.getByRole("button", { name: "Jawaban bagus" }).click();
    await saved;
    await expect(answer.getByRole("button", { name: "Jawaban bagus" })).toHaveAttribute("aria-pressed", "true");

    // Refresh: riwayat tetap ada
    await page.reload();
    await expect(page.locator('[data-role="user"]').last()).toContainText("3 cara menyeduh kopi");
    const reloaded = page.locator('[data-role="assistant"]').last();
    // Bandingkan isi tanpa spasi/baris: innerText bisa berbeda tata letak sesaat setelah refresh.
    const squash = (t: string) => t.replace(/\s+/g, "");
    await expect.poll(async () => squash(await reloaded.innerText()).slice(0, 60)).toBe(squash(finalText).slice(0, 60));
    await expect(reloaded.getByRole("button", { name: "Jawaban bagus" })).toHaveAttribute("aria-pressed", "true");
  });

  test("stop dan regenerate", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: /Tes/ }).first().click();
    await page.getByLabel("Ketik pesan").fill("Tulis cerita panjang 600 kata tentang petani kopi di Gayo.");
    await page.getByRole("button", { name: "Kirim pesan" }).click();
    const answer = page.locator('[data-role="assistant"]').last();
    await expect(answer.locator(".markdown")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Hentikan jawaban" }).click();
    await expect(answer).toHaveAttribute("data-status", "stopped");
    await expect(answer).toContainText("Dihentikan");

    await answer.getByRole("button", { name: "Ulangi jawaban" }).click();
    const again = page.locator('[data-role="assistant"]').last();
    await expect(again).toHaveAttribute("data-status", "complete", { timeout: 90_000 });
  });

  test("tampilan HP: panel setelan bisa dibuka", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);
    await page.getByRole("link", { name: /Tes/ }).first().click();
    await page.getByRole("button", { name: "Setelan" }).click();
    await expect(page.getByRole("dialog")).toContainText("Riwayat playground");
    await page.waitForTimeout(500); // tunggu animasi panel selesai
    await page.screenshot({ path: `${SHOTS}/08-mobile-settings-375.png` });
    // Panel setelan tidak melewati tepi layar
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    const inner = await page.getByRole("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(inner).toBe(true);
    // Tidak ada scroll horizontal
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("pindah tab cepat tidak tersangkut di halaman lama", async ({ page }) => {
    await login(page);
    for (let i = 0; i < 4; i++) {
      await page.getByRole("link", { name: /Tes/ }).first().click();
      await page.getByRole("link", { name: "Persona", exact: true }).click();
      await expect(page.getByLabel("Pesan sambutan")).toBeVisible({ timeout: 10_000 });
      await page.getByRole("link", { name: "Playground", exact: true }).click();
      await page.getByRole("link", { name: "Persona", exact: true }).click();
      await expect(page.getByLabel("Pesan sambutan")).toBeVisible({ timeout: 10_000 });
      await page.goto("/");
    }
  });

  test("daftar bot, edit persona, lalu hapus", async ({ page }) => {
    await login(page);
    await expect(page.getByText("chat dalam 7 hari")).toBeVisible();
    await shot(page, "09-bot-list");
    await page.getByRole("link", { name: /Tes/ }).first().click();
    await page.getByRole("link", { name: "Persona", exact: true }).click();
    await page.getByLabel("Pesan sambutan").fill("Halo, saya bot tes!");
    await page.getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(page.getByText("Perubahan disimpan")).toBeVisible();
    await shot(page, "10-persona-edit");

    await page.getByRole("button", { name: "Hapus bot" }).click();
    await page.getByRole("button", { name: "Hapus permanen" }).click();
    await expect(page.getByText("Belum ada bot")).toBeVisible();
  });
});

test("akun hasil daftar sendiri (bukan owner) ditolak", async ({ page }) => {
  const { admin } = await import("./test-user");
  const crypto = await import("node:crypto");
  const email = `e2e-stranger-${crypto.randomBytes(3).toString("hex")}@test.invalid`;
  const password = crypto.randomBytes(12).toString("hex");
  const { data } = await admin().auth.admin.createUser({ email, password, email_confirm: true }); // tanpa role owner
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByText("Akun ini tidak punya akses ke dashboard.")).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await admin().auth.admin.deleteUser(data.user!.id);
  }
});
