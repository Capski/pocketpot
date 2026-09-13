"use client";
import { createClient } from "@supabase/supabase-js";
export const cloudMode = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabase = cloudMode
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  : null;
let ready: Promise<void> | undefined;
async function initialize() {
  if (!ready)
    ready = (async () => {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          const { error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
        }
      } else {
        const r = await fetch("/api/session", { method: "POST" });
        if (!r.ok) throw new Error("Could not initialize this device.");
      }
    })().catch((e) => {
      ready = undefined;
      throw e;
    });
  await ready;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  await initialize();
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error ?? "Request failed.", response.status);
  return result;
}
