"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE } from "@/lib/llm/capabilities";

export interface Attachment {
  id: string;
  previewUrl: string;
  path?: string;
  mime: string;
  uploading: boolean;
}

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  botId,
  imagesSupported,
}: {
  onSend: (t: string, images: { path: string; mime: string; previewUrl: string }[]) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  botId?: string;
  imagesSupported?: boolean;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);

  async function addFiles(list: FileList | File[]) {
    if (!botId || !imagesSupported) return;
    let count = files.length;
    for (const f of Array.from(list)) {
      if (!(f.type in IMAGE_TYPES)) {
        toast.error(`${f.name}: hanya JPG, PNG, WebP, atau GIF.`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        toast.error(`${f.name}: maksimal 5 MB.`);
        continue;
      }
      if (count >= MAX_IMAGES_PER_MESSAGE) {
        toast.error(`Maksimal ${MAX_IMAGES_PER_MESSAGE} gambar per pesan.`);
        break;
      }
      count++;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = URL.createObjectURL(f);
      setFiles((fs) => [...fs, { id, previewUrl, mime: f.type, uploading: true }]);
      try {
        const res = await fetch(`/api/bots/${botId}/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mime: f.type, size: f.size }) });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error ?? "Gambar gagal diupload.");
        const put = await fetch(j.url, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
        if (!put.ok) throw new Error("Gambar gagal diupload.");
        setFiles((fs) => fs.map((x) => (x.id === id ? { ...x, path: j.path, uploading: false } : x)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gambar gagal diupload.");
        setFiles((fs) => fs.filter((x) => x.id !== id));
      }
    }
  }

  const uploading = files.some((f) => f.uploading);
  const ready = files.filter((f) => f.path);

  function submit() {
    const t = text.trim();
    if ((!t && !ready.length) || streaming || disabled || uploading) return;
    onSend(
      t,
      ready.map((f) => ({ path: f.path!, mime: f.mime, previewUrl: f.previewUrl })),
    );
    setText("");
    setFiles([]);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-xl border bg-background p-2 shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30"
    >
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2 px-1" aria-label="Gambar terlampir">
          {files.map((f) => (
            <li key={f.id} className="relative size-16 overflow-hidden rounded-lg border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.previewUrl} alt="Gambar terlampir" className="size-full object-cover" />
              {f.uploading && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="size-4 animate-spin" aria-label="Mengunggah" />
                </span>
              )}
              <button
                type="button"
                onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                className="absolute top-0.5 right-0.5 inline-flex size-6 items-center justify-center rounded-full bg-background/90 shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label="Hapus gambar"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        {botId && (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInput.current?.click()}
              disabled={!imagesSupported || disabled || files.length >= MAX_IMAGES_PER_MESSAGE}
              aria-label="Lampirkan gambar"
              title={imagesSupported ? "Lampirkan gambar (maks 5 MB)" : "Model bot ini tidak bisa membaca gambar"}
            >
              <ImagePlus />
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={Object.keys(IMAGE_TYPES).join(",")}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label="Pilih gambar"
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}
        <label htmlFor="chat-input" className="sr-only">
          Ketik pesan
        </label>
        <textarea
          id="chat-input"
          ref={ref}
          rows={1}
          value={text}
          maxLength={8000}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
            if (imgs.length && imagesSupported) {
              e.preventDefault();
              void addFiles(imgs);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ketik pesan..."
          className="max-h-[200px] min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base outline-none placeholder:text-muted-foreground sm:min-h-9 sm:py-1.5 md:text-sm"
        />
        {streaming ? (
          <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Hentikan jawaban">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={(!text.trim() && !ready.length) || disabled || uploading} aria-label="Kirim pesan">
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );
}
