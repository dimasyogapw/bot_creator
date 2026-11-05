import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6" aria-busy="true" aria-label="Memuat">
      <Skeleton className="mb-4 h-8 w-2/3 rounded-full" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="mb-2 h-16 rounded-lg" />
      ))}
    </div>
  );
}
