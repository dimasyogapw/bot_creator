"use client";

import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createCaseFromConversation, draftCaseFromMessage, type CaseDraft } from "@/lib/evals/actions";
import { CaseDialog, EMPTY_CASE } from "./case-dialog";

/**
 * Tombol di tab Percakapan: menyiapkan draf test case dari satu jawaban bot.
 * Draf (pertanyaan + saran perilaku dari model) dibuka di dialog dan baru disimpan setelah pemilik menekan Simpan.
 */
export function CaseFromMessage({ botId, conversationId, messageId, highlight }: { botId: string; conversationId: string; messageId: string; highlight?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CaseDraft | null>(null);

  async function begin() {
    setOpen(true);
    setLoading(true);
    setDraft(null);
    const r = await draftCaseFromMessage(botId, messageId);
    setLoading(false);
    if (!r.ok || !r.data) {
      setOpen(false);
      toast.error(r.ok ? "Draf tidak tersedia." : r.error);
      return;
    }
    setDraft(r.data);
  }

  return (
    <>
      <Button
        variant={highlight ? "outline" : "ghost"}
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={begin}
        disabled={loading}
        data-testid="make-eval-case"
        aria-label="Buat test case dari jawaban ini"
      >
        {loading ? <Loader2 className="animate-spin" /> : <FlaskConical />} Buat test case
      </Button>
      <CaseDialog
        open={open}
        onOpenChange={setOpen}
        loading={loading}
        title="Buat test case dari jawaban ini"
        description="Periksa dan perbaiki dulu. Saran perilaku dibuat otomatis oleh model dan bisa salah. Test case baru disimpan setelah kamu menekan Simpan."
        initial={draft ? { ...EMPTY_CASE, input: draft.input, setup: draft.setup, expected_behavior: draft.expected_behavior, tags: draft.tags } : EMPTY_CASE}
        badAnswer={draft?.badAnswer}
        onSubmit={async (v) => {
          const r = await createCaseFromConversation(botId, conversationId, v);
          if (!r.ok) return r;
          setOpen(false);
          toast.success("Test case disimpan", {
            action: { label: "Buka Evals", onClick: () => window.location.assign(`/bots/${botId}/evals`) },
          });
          return { ok: true };
        }}
      />
    </>
  );
}
