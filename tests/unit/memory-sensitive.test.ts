import { describe, expect, it } from "vitest";
import { sensitiveReason } from "@/lib/memory/sensitive";

describe("filter data sensitif memory", () => {
  it.each([
    ["Nomor kartu kreditnya 4111 1111 1111 1111", "card"],
    ["NIK saya 3201234567890001", "nik"],
    ["Nomor rekening BCA 1234567890", "account"],
    ["Password saya kucing123", "secret"],
    ["PIN ATM-nya 123456", "secret"],
    ["Kata sandi: rahasia", "secret"],
    ["Kode OTP 482913", "secret"],
    ["Nomor KTP 320123456789", "id_number"],
  ])("menolak: %s", (text, reason) => expect(sensitiveReason(text)).toBe(reason));

  it.each([
    "Nama pengguna Budi",
    "Suka kopi hitam tanpa gula",
    "Tinggal di Bandung, bekerja sebagai guru",
    "Pernah lupa password dan minta reset",
    "Ulang tahun 12 Mei",
    "Punya 2 anak",
    "Nomor HP 0812-3456-7890",
  ])("mengizinkan: %s", (text) => expect(sensitiveReason(text)).toBeNull());
});
