"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { TabLinks } from "@/components/ui/tabs";

// Tab fase berikutnya (Knowledge, Memory, Skills, dst.) ditambahkan di fasenya masing-masing.
export function BotTabs({ botId }: { botId: string }) {
  const seg = useSelectedLayoutSegment() ?? "playground";
  return (
    <TabLinks
      active={seg}
      items={[
        { key: "playground", label: "Playground", href: `/bots/${botId}/playground` },
        { key: "persona", label: "Persona", href: `/bots/${botId}/persona` },
      ]}
    />
  );
}
