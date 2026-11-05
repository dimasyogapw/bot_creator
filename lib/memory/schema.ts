import { z } from "zod";

export const MAX_MEMORIES_PER_USER = 50;

/** Output model ringan: daftar operasi memory. Dibatasi supaya output rusak tidak bisa merusak banyak data. */
export const memoryOpsSchema = z.object({
  operations: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("add"), content: z.string().trim().min(1).max(500), importance: z.coerce.number().int().min(1).max(5).default(3) }),
        z.object({
          op: z.literal("update"),
          id: z.string().uuid(),
          content: z.string().trim().min(1).max(500),
          importance: z.coerce.number().int().min(1).max(5).optional(),
        }),
        z.object({ op: z.literal("delete"), id: z.string().uuid() }),
      ]),
    )
    .max(20),
});
export type MemoryOp = z.infer<typeof memoryOpsSchema>["operations"][number];
