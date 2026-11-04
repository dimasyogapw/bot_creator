"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Composer({ onSend, onStop, streaming, disabled }: { onSend: (t: string) => void; onStop: () => void; streaming: boolean; disabled?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);

  function submit() {
    const t = text.trim();
    if (!t || streaming || disabled) return;
    onSend(t);
    setText("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30"
    >
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
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ketik pesan... (Enter kirim, Shift+Enter baris baru)"
        className="max-h-[200px] min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base outline-none placeholder:text-muted-foreground sm:min-h-9 sm:py-1.5 md:text-sm"
      />
      {streaming ? (
        <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Hentikan jawaban">
          <Square className="fill-current" />
        </Button>
      ) : (
        <Button type="submit" size="icon" disabled={!text.trim() || disabled} aria-label="Kirim pesan">
          <ArrowUp />
        </Button>
      )}
    </form>
  );
}
