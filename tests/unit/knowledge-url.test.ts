import { describe, expect, it } from "vitest";
import { assertAllowedUrl, isBlockedIp } from "@/lib/knowledge/fetch-url";

describe("keamanan URL (SSRF)", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "menolak %s",
    (ip) => expect(isBlockedIp(ip)).toBe(true),
  );

  it.each(["8.8.8.8", "104.16.1.1", "2606:4700::1111"])("mengizinkan %s", (ip) => expect(isBlockedIp(ip)).toBe(false));

  it.each([
    "file:///etc/passwd",
    "ftp://contoh.com",
    "http://localhost/admin",
    "http://app.localhost",
    "http://127.0.0.1",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://user:pass@contoh.com",
    "http://contoh.com:8080",
    "bukan url",
  ])("menolak URL %s", (u) => expect(() => assertAllowedUrl(u)).toThrow());

  it("mengizinkan https publik", () => {
    expect(assertAllowedUrl("https://contoh.com/halaman?a=1").hostname).toBe("contoh.com");
  });
});
