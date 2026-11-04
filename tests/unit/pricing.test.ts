import { describe, expect, it } from "vitest";
import { computeCostUsd, normalizeUsage } from "@/lib/bot/pricing";

const price = { model: "m", input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3, cache_write_per_mtok: 3.75 };

describe("pricing", () => {
  it("menghitung biaya tanpa cache", () => {
    expect(computeCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 100_000 }, price)).toBe(4.5);
  });

  it("tidak menghitung token cache dua kali", () => {
    // 14022 prompt, 14013 di antaranya dibaca dari cache (data nyata dari SumoPod)
    const cost = computeCostUsd({ prompt_tokens: 14022, completion_tokens: 10, cache_read_input_tokens: 14013 }, price);
    const expected = (9 * 3 + 14013 * 0.3 + 10 * 15) / 1e6;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it("memakai biaya provider jika harga belum diisi", () => {
    expect(computeCostUsd({ prompt_tokens: 10, completion_tokens: 5, cost: 0.000364 }, null)).toBe(0.000364);
  });

  it("null jika tidak ada usage atau harga", () => {
    expect(computeCostUsd(undefined, price)).toBeNull();
    expect(computeCostUsd({ prompt_tokens: 1 }, null)).toBeNull();
  });

  it("membaca cached_tokens dari prompt_tokens_details", () => {
    expect(normalizeUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 40 } }).tokensCached).toBe(40);
  });
});
