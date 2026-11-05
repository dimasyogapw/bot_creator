import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6" aria-busy="true" aria-label="Memuat">
      <Skeleton className="mb-6 h-24 rounded-xl" />
      <Skeleton className="mb-3 h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
