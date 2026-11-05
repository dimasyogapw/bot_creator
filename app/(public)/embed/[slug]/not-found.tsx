export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold">Chat tidak ditemukan</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">Alamatnya mungkin salah, atau chat ini sedang tidak tersedia.</p>
    </main>
  );
}
