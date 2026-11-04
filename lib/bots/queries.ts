import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import type { Bot } from "@/lib/db/types";

/** Ambil bot milik owner (RLS). 404 jika tidak ada. Di-cache per request. */
export const getBotOr404 = cache(async (botId: string): Promise<Bot> => {
  if (!z.string().uuid().safeParse(botId).success) notFound();
  const { supabase } = await getUser();
  const { data, error } = await supabase.from("bots").select("*").eq("id", botId).maybeSingle<Bot>();
  if (error) throw error;
  if (!data) notFound();
  return data;
});
