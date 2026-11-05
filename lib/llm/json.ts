/** Ambil objek JSON pertama dari respons model (boleh dibungkus ```json). */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("respons bukan JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}
