import type { Citation } from "@/lib/db/types";

export interface UIMessage {
  id: string; // id database, atau "tmp-..." sebelum tersimpan
  role: "user" | "assistant";
  text: string;
  status: "complete" | "stopped" | "error" | "streaming";
  feedback: -1 | 0 | 1;
  citations?: Citation[];
  /** Skill yang sedang dipakai (hanya saat streaming), mis. "Mencari di knowledge". */
  activity?: { label: string; detail?: string };
  images?: { url: string }[];
}

export type StreamEvent =
  | { type: "start"; conversationId: string; userMessageId: string | null }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; label: string; detail?: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; message: { id: string; content: { text: string; citations?: Citation[] }; status: "complete" | "stopped" | "error"; feedback: -1 | 0 | 1 } }
  | { type: "error"; message: string };

/** Baca respons NDJSON baris per baris. */
export async function* readNdjson(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as StreamEvent;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as StreamEvent;
}
