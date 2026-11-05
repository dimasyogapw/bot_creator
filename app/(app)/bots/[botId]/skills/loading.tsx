import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6" aria-busy="true" aria-label="Memuat">
      <Skeleton className="mb-6 h-5 w-2/3 rounded-md" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="mb-3 h-20 rounded-xl" />
      ))}
    </div>
  );
}
