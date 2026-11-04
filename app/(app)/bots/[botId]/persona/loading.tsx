import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6" aria-busy="true" aria-label="Memuat">
      <Skeleton className="mb-4 h-40 rounded-xl" />
      <Skeleton className="mb-4 h-16 w-3/4 rounded-xl" />
      <Skeleton className="ml-auto h-16 w-2/3 rounded-xl" />
    </div>
  );
}
