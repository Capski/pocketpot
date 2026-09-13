import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRoom, applyCommand } from "../src/lib/room";
import type { Room } from "../src/lib/types";

let db: PGlite;
const host = randomUUID(),
  guest = randomUUID(),
  outsider = randomUUID();
let room: Room;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,is_anonymous boolean,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create publication supabase_realtime;
  `);
  for (const migration of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  }
  for (const [id, anonymous] of [
    [host, false],
    [guest, true],
    [outsider, true],
  ])
    await db.query("insert into auth.users(id,is_anonymous) values($1,$2)", [id, anonymous]);
  room = createRoom(randomUUID(), "ABC234", host, "Database test", "Alex", {
    currency: "HKD",
    buyIn: 500,
    minBuyIn: 100,
    maxBuyIn: 2000,
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
  });
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function commit(r: Room, version: number) {
  await db.query("select public.pocketpot_commit($1,$2,$3)", [r.id, version, JSON.stringify(r)]);
}
async function asUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

describe("Supabase migration on PostgreSQL", () => {
  it("creates a private room and version signal in one transaction", async () => {
    await commit(room, -1);
    const result = await db.query<{ version: number }>(
      "select version from pocketpot_rooms where id=$1",
      [room.id],
    );
    expect(Number(result.rows[0].version)).toBe(0);
    const events = await db.query("select * from pocketpot_events");
    expect(events.rows).toHaveLength(1);
  });
  it("denies direct state and event access, even for an approved host", async () => {
    await asUser(host, async () => {
      await expect(db.query("select state from pocketpot_rooms")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query("select event from pocketpot_events")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("select pocketpot_commit($1,$2,$3)", [room.id, 0, JSON.stringify(room)]),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("shows version signals only to approved members", async () => {
    const visible = await asUser(host, () => db.query("select * from pocketpot_signals"));
    expect(visible.rows).toHaveLength(1);
    const hidden = await asUser(outsider, () => db.query("select * from pocketpot_signals"));
    expect(hidden.rows).toHaveLength(0);
  });
  it("commits approval with membership and rejects stale updates atomically", async () => {
    const key = randomUUID();
    let next = applyCommand(
      room,
      guest,
      { type: "request", kind: "join", name: "Sam", amount: 500 },
      key,
      room.version,
    );
    await commit(next, room.version);
    room = next;
    next = applyCommand(
      room,
      host,
      { type: "approve", requestId: key },
      randomUUID(),
      room.version,
    );
    await commit(next, room.version);
    await expect(commit(next, room.version)).rejects.toThrow(/conflict/);
    room = next;
    const view = await asUser(guest, () => db.query("select * from pocketpot_signals"));
    expect(view.rows).toHaveLength(1);
    const events = await db.query("select * from pocketpot_events");
    expect(events.rows).toHaveLength(3);
  });
  it("does not let guests keep an abandoned room alive with join requests", async () => {
    const old = new Date(Date.now() - 23 * 3600000).toISOString();
    await db.query("update pocketpot_rooms set touched_at=$1 where id=$2", [old, room.id]);
    room.lastSeen = old;
    const next = applyCommand(
      room,
      outsider,
      { type: "request", kind: "display", name: "TV", amount: 0 },
      randomUUID(),
      room.version,
    );
    await commit(next, room.version);
    room = next;
    const rows = await db.query<{ touched_at: Date }>(
      "select touched_at from pocketpot_rooms where id=$1",
      [room.id],
    );
    expect(new Date(rows.rows[0].touched_at).getTime()).toBe(Date.parse(old));
  });
  it("rate-limits across requests and isolates buckets", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await db.query<{ pocketpot_rate_limit: boolean }>(
        "select pocketpot_rate_limit('test',2)",
      );
      expect(result.rows[0].pocketpot_rate_limit).toBe(i < 2);
    }
    const other = await db.query<{ pocketpot_rate_limit: boolean }>(
      "select pocketpot_rate_limit('other',2)",
    );
    expect(other.rows[0].pocketpot_rate_limit).toBe(true);
  });
  it("retains only the registered player's own summary after finalization", async () => {
    const pending = room.requests.find((q) => q.status === "pending")!;
    for (const command of [
      { type: "reject" as const, requestId: pending.id },
      { type: "settle" as const },
      { type: "finalize" as const },
    ]) {
      const next = applyCommand(room, host, command, randomUUID(), room.version);
      await commit(next, room.version);
      room = next;
    }
    const summaries = await db.query<{ user_id: string; summary: { name: string } }>(
      "select * from pocketpot_summaries",
    );
    expect(summaries.rows).toHaveLength(1);
    expect(summaries.rows[0].user_id).toBe(host);
    expect(summaries.rows[0].summary.name).toBe("Alex");
    const hidden = await asUser(guest, () => db.query("select * from pocketpot_summaries"));
    expect(hidden.rows).toHaveLength(0);
  });
  it("prunes 90-day details in a still-active room while preserving receipt fingerprints", async () => {
    const active = createRoom(
      randomUUID(),
      "JKM789",
      host,
      "Long-running",
      "Alex",
      room.game.config,
    );
    const oldDate = new Date(Date.now() - 91 * 86400000).toISOString();
    active.audit[0].at = oldDate;
    active.undo = [{ game: structuredClone(active.game), at: oldDate }];
    active.requests = [
      {
        id: randomUUID(),
        userId: outsider,
        name: "Old guest",
        kind: "join",
        amount: 500,
        status: "rejected",
        at: oldDate,
      },
    ];
    active.receipts.old = JSON.stringify({ type: "start" });
    await commit(active, -1);
    await db.query("update pocketpot_events set created_at=$1 where room_id=$2", [
      oldDate,
      active.id,
    ]);
    await db.query("select pocketpot_cleanup()");
    const result = await db.query<{ state: Room }>(
      "select state from pocketpot_rooms where id=$1",
      [active.id],
    );
    expect(result.rows[0].state.audit).toEqual([]);
    expect(result.rows[0].state.undo).toEqual([]);
    expect(result.rows[0].state.requests).toEqual([]);
    expect(result.rows[0].state.receipts.old).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.rows[0].state.game.players[0].stack).toBe(500);
    expect(
      (await db.query("select * from pocketpot_events where room_id=$1", [active.id])).rows,
    ).toHaveLength(0);
    await db.query("delete from pocketpot_rooms where id=$1", [active.id]);
  });
  it("expires unfinished rooms at 24 hours and detailed results at 90 days", async () => {
    const old = createRoom(randomUUID(), "DEF567", host, "Expired", "Alex", room.game.config);
    await commit(old, -1);
    await db.query("update pocketpot_rooms set touched_at=now()-interval '25 hours' where id=$1", [
      old.id,
    ]);
    await db.query("update pocketpot_rooms set finalized_at=now()-interval '91 days' where id=$1", [
      room.id,
    ]);
    await db.query("select pocketpot_cleanup()");
    expect((await db.query("select * from pocketpot_rooms")).rows).toHaveLength(0);
    expect((await db.query("select * from pocketpot_events")).rows).toHaveLength(0);
    expect((await db.query("select * from pocketpot_members")).rows).toHaveLength(0);
    expect((await db.query("select * from pocketpot_summaries")).rows).toHaveLength(1);
  });
  it("lets a registered user delete their own retained summary", async () => {
    await asUser(host, () => db.query("delete from pocketpot_summaries"));
    expect((await db.query("select * from pocketpot_summaries")).rows).toHaveLength(0);
  });
});
