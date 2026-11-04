"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ModelSelect({ id, models, value, onChange }: { id?: string; models: string[]; value: string; onChange: (m: string) => void }) {
  const list = models.includes(value) ? models : [value, ...models];
  // Model Claude ditampilkan paling atas.
  const sorted = [...list].sort((a, b) => Number(/claude/i.test(b)) - Number(/claude/i.test(a)) || a.localeCompare(b));
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="font-mono text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {sorted.map((m) => (
          <SelectItem key={m} value={m} className="font-mono text-xs">
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
