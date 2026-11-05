/**
 * Lapis kedua penolakan data sensitif untuk memory (lapis pertama: instruksi ke model ringan).
 * Lebih baik menolak memory yang aman daripada menyimpan data sensitif.
 */

function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const SECRET_WORDS =
  /\b(password|passwd|kata\s*sandi|sandi|pin|otp|kode\s*(verifikasi|otp|keamanan)|cvv|cvc|token|api\s*key|secret|seed\s*phrase|mnemonic|private\s*key)\b/i;
const ACCOUNT_WORDS = /\b(rekening|no\.?\s*rek|norek|account\s*number|va|virtual\s*account|iban)\b/i;
const ID_WORDS = /\b(nik|ktp|kk|kartu\s*keluarga|npwp|paspor|passport|sim)\b/i;

export type SensitiveReason = "secret" | "card" | "nik" | "account" | "id_number";

/** Kembalikan alasan jika teks memuat data sensitif, atau null jika aman. */
export function sensitiveReason(text: string): SensitiveReason | null {
  const t = text.normalize("NFKC");
  // Rangkaian angka (boleh dipisah spasi, titik, atau tanda hubung).
  const runs = [...t.matchAll(/\d(?:[\s.-]?\d){5,}/g)].map((m) => m[0].replace(/\D/g, ""));

  if (SECRET_WORDS.test(t)) {
    // "lupa password" atau "minta reset PIN" tanpa nilai tetap boleh.
    // Kata rahasia + angka, atau + penanda nilai ("adalah", ":", "=", "saya X"), ditolak.
    const valueAfter = new RegExp(SECRET_WORDS.source + String.raw`\s*(saya|ku|nya|aku)?\s*(adalah|yaitu|ialah|:|=|\S*\d)`, "i");
    if (/\d/.test(t) || valueAfter.test(t) || new RegExp(SECRET_WORDS.source + String.raw`\s*(saya|ku|nya|aku)\s+\S+`, "i").test(t)) return "secret";
  }
  for (const r of runs) {
    if (r.length >= 13 && r.length <= 19 && luhnValid(r)) return "card";
    if (r.length === 16) return "nik"; // NIK dan nomor KK 16 digit
  }
  if (runs.some((r) => r.length >= 8) && ACCOUNT_WORDS.test(t)) return "account";
  if (runs.some((r) => r.length >= 6) && ID_WORDS.test(t)) return "id_number";
  return null;
}

export function isSensitive(text: string) {
  return sensitiveReason(text) !== null;
}
