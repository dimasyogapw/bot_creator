/**
 * Model yang bisa membaca gambar. Diuji lewat SumoPod 2026-11-05: claude-haiku-5-5 bisa, deepseek-v4-flash tidak.
 * Model lain di daftar ini mengikuti dokumentasi providernya; model yang tidak dikenal dianggap tidak bisa.
 */
export function supportsVision(model: string): boolean {
  return /claude|gemini|gpt-(4o|4\.1|5)|qwen[\w.-]*vl|llama-4/i.test(model);
}

export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;
export type ImageMime = keyof typeof IMAGE_TYPES;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;

export function imagePathPattern(botId: string) {
  return new RegExp(`^${botId}/uploads/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`);
}
