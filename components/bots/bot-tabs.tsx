"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { TabLinks } from "@/components/ui/tabs";

// Tab fase berikutnya (, Skills, dst.) ditambahkan di fasenya masing-masing.
export function BotTabs({ botId }: { botId: string }) {
  const seg = useSelectedLayoutSegment() ?? "playground";
  return (
    <TabLinks
      active={seg}
      items={[
        { key: "playground", label: "Playground", href: `/bots/${botId}/playground` },
        { key: "persona", label: "Persona", href: `/bots/${botId}/persona` },
        { key: "knowledge", label: "Knowledge", href: `/bots/${botId}/knowledge` },
        { key: "memory", label: "Memory", href: `/bots/${botId}/memory` },
        { key: "skills", label: "Skills", href: `/bots/${botId}/skills` },
        { key: "publish", label: "Publikasi", href: `/bots/${botId}/publish` },
        { key: "conversations", label: "Percakapan", href: `/bots/${botId}/conversations` },
      ]}
    />
  );
}
