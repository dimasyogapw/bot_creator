import { cn } from "@/lib/utils";

export interface BarSeries {
  key: string;
  label: string;
  /** Kelas Tailwind fill untuk batang dan legenda. */
  fill: string;
  swatch: string;
}

export interface BarDatum {
  /** Tanggal ISO (YYYY-MM-DD). */
  day: string;
  values: Record<string, number>;
}

const dayFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const label = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

/**
 * Grafik batang bertumpuk per hari, SVG murni (tanpa pustaka). Dirender di server.
 * Ada tabel tersembunyi untuk pembaca layar.
 */
export function BarChart({
  title,
  series,
  data,
  format,
  testId,
}: {
  title: string;
  series: BarSeries[];
  data: BarDatum[];
  format: (n: number) => string;
  testId?: string;
}) {
  const W = 640;
  const H = 190;
  const padL = 8;
  const padB = 30;
  const padT = 8;
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const max = Math.max(...totals, 0);
  const slot = (W - padL * 2) / Math.max(data.length, 1);
  const bw = Math.max(2, slot * 0.7);
  const scale = max > 0 ? (H - padB - padT) / max : 0;
  const tickEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <figure className="rounded-xl border p-4" data-testid={testId}>
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block size-2.5 rounded-sm", s.swatch)} aria-hidden /> {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <p className="mb-1 text-xs text-muted-foreground">Tertinggi dalam sehari: {format(max)}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Tertinggi ${format(max)}.`} className="h-auto w-full">
        <line x1={padL} x2={W - padL} y1={H - padB} y2={H - padB} className="stroke-border" />
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          let y = H - padB;
          return (
            <g key={d.day}>
              <title>{`${label(d.day)}: ${format(totals[i])}`}</title>
              {series.map((s) => {
                const h = (d.values[s.key] ?? 0) * scale;
                y -= h;
                return h > 0 ? <rect key={s.key} x={x} y={y} width={bw} height={h} rx={1.5} className={s.fill} /> : null;
              })}
              {i % tickEvery === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={20} className="fill-muted-foreground">
                  {label(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Tanggal</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{label(d.day)}</td>
              {series.map((s) => (
                <td key={s.key}>{format(d.values[s.key] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
