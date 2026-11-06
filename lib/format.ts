/** Biaya dalam USD, 4 desimal (biaya per pesan sangat kecil). */
export function formatUsd(n: number | string | null | undefined): string {
  return `$${Number(n ?? 0).toFixed(4)}`;
}

/** Angka ribuan gaya Indonesia. */
export function formatInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("id-ID");
}

export function formatSeconds(ms: number | null | undefined): string {
  return `${(Number(ms ?? 0) / 1000).toFixed(1).replace(".", ",")} dtk`;
}
