import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Room } from "../types";
import { ensure } from "../poker";
import { pruneDetails } from "../room";

export const cloud = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
export function admin() {
  ensure(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Supabase server configuration is incomplete.",
  );
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
const directory = path.join(process.cwd(), ".pocketpot");
const globalState = globalThis as typeof globalThis & {
  pocketpotQueue?: Promise<unknown>;
  pocketpotLimits?: Map<string, { n: number; until: number }>;
};
async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalState.pocketpotQueue ?? Promise.resolve();
  let release!: () => void;
  globalState.pocketpotQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
function file(id: string) {
  ensure(/^[a-f0-9-]{36}$/.test(id), "Invalid room identifier.");
  return path.join(directory, id + ".json");
}
async function write(r: Room) {
  await mkdir(directory, { recursive: true });
  const temp = file(r.id) + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(r), { mode: 0o600 });
  await rename(temp, file(r.id));
}
async function localRead(id: string) {
  try {
    return JSON.parse(await readFile(file(id), "utf8")) as Room;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("Room not found or expired.");
    throw e;
  }
}
function unexpired(r: Room, lastSeen = r.lastSeen) {
  ensure(
    Date.now() - Date.parse(r.finalizedAt ?? lastSeen) < (r.finalizedAt ? 90 : 1) * 86400000,
    r.finalizedAt
      ? "Temporary room history has expired."
      : "This room expired after 24 hours without a connected device.",
  );
}
export async function readRoom(id: string) {
  if (cloud) {
    const { data, error } = await admin()
      .from("pocketpot_rooms")
      .select("state,touched_at")
      .eq("id", id)
      .single();
    ensure(!error && data, "Room not found or expired.");
    const r = data.state as Room;
    unexpired(r, data.touched_at);
    return r;
  }
  ensure(
    !process.env.VERCEL,
    "Configure Supabase before deploying. Local files are not durable on Vercel.",
  );
  const r = await localRead(id);
  unexpired(r);
  return r;
}
export async function findRoom(code: string) {
  ensure(/^[A-Z2-9]{6}$/.test(code), "Enter the six-character room code.");
  if (cloud) {
    const { data } = await admin().from("pocketpot_rooms").select("id").eq("code", code).single();
    ensure(data, "Room not found or expired.");
    return readRoom(data.id);
  }
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory))
    if (name.endsWith(".json")) {
      const r = await localRead(name.slice(0, -5));
      if (r.code === code) {
        unexpired(r);
        return r;
      }
    }
  throw new Error("Room not found or expired.");
}
export async function insertRoom(r: Room) {
  if (cloud) {
    const { error } = await admin().rpc("pocketpot_commit", {
      p_id: r.id,
      p_expected: -1,
      p_state: r,
    });
    if (error) throw new Error(error.message);
    return;
  }
  ensure(!process.env.VERCEL, "Configure Supabase before deploying.");
  await serialized(() => write(r));
}
export async function mutateRoom(id: string, fn: (r: Room) => Room) {
  if (cloud) {
    const previous = await readRoom(id),
      r = fn(previous);
    if (r === previous) return previous;
    const { error } = await admin().rpc("pocketpot_commit", {
      p_id: id,
      p_expected: previous.version,
      p_state: r,
    });
    if (error) {
      if (error.message.includes("conflict")) {
        const current = await readRoom(id);
        if (fn(current) === current) return current;
        throw new Error("The table changed. Review the latest state and try again.");
      }
      throw new Error(error.message);
    }
    return r;
  }
  return serialized(async () => {
    const previous = await readRoom(id);
    const r = fn(previous);
    if (r !== previous) await write(r);
    return r;
  });
}
export async function touchRoom(id: string) {
  if (cloud) {
    const { error } = await admin()
      .from("pocketpot_rooms")
      .update({ touched_at: new Date().toISOString() })
      .eq("id", id);
    ensure(!error, "Could not confirm room presence. Reconnect and try again.");
    return;
  }
  await serialized(async () => {
    const r = await readRoom(id);
    if (Date.now() - Date.parse(r.lastSeen) > 15000) {
      r.lastSeen = new Date().toISOString();
      await write(r);
    }
  });
}
export function identifiers() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return {
    id: randomUUID(),
    code: Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join(""),
  };
}
export async function rateLimit(user: string, bucket: string, max = 80) {
  const key = createHash("sha256")
    .update(user + ":" + bucket)
    .digest("hex");
  if (cloud) {
    const { data, error } = await admin().rpc("pocketpot_rate_limit", { p_key: key, p_max: max });
    ensure(!error && data, "Too many requests. Try again in a minute.");
    return;
  }
  const limits = (globalState.pocketpotLimits ??= new Map());
  const now = Date.now();
  for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const counter = limits.get(key) ?? { n: 0, until: now + 60000 };
  counter.n++;
  limits.set(key, counter);
  ensure(counter.n <= max, "Too many requests. Try again in a minute.");
}
export async function cleanup() {
  if (cloud) {
    const { data, error } = await admin().rpc("pocketpot_cleanup");
    if (error) throw error;
    return data;
  }
  await mkdir(directory, { recursive: true });
  let removed = 0;
  await serialized(async () => {
    for (const name of await readdir(directory))
      if (name.endsWith(".json")) {
        const r = await localRead(name.slice(0, -5));
        if (
          Date.now() - Date.parse(r.finalizedAt ?? r.lastSeen) >
          (r.finalizedAt ? 90 : 1) * 86400000
        ) {
          await unlink(file(r.id));
          removed++;
        } else {
          const original = JSON.stringify(r);
          pruneDetails(r);
          if (JSON.stringify(r) !== original) await write(r);
        }
      }
  });
  return removed;
}
