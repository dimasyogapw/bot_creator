import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">Halaman tidak ditemukan</h1>
      <p className="mt-2 text-sm text-muted-foreground">Alamatnya mungkin salah atau bot sudah dihapus.</p>
      <Button asChild className="mt-6">
        <Link href="/">Kembali ke daftar bot</Link>
      </Button>
    </main>
  );
}
