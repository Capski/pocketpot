import { test, expect, APIRequestContext, type Browser } from "@playwright/test";
import type { RoomView, Command } from "../../src/lib/types";
import { randomUUID } from "node:crypto";
import { device, origin } from "./device";
const cloud = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
const config = {
  currency: "HKD",
  buyIn: 500,
  minBuyIn: 100,
  maxBuyIn: 2000,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
};
async function init(api: APIRequestContext) {
  const response = await api.post("/api/session", { headers: { origin } });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function create(api: APIRequestContext) {
  await init(api);
  const response = await api.post("/api/rooms", {
    headers: { origin },
    data: { name: "Friday night test", playerName: "Alex", config },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as RoomView;
}
async function command(api: APIRequestContext, r: RoomView, c: Command, key = randomUUID()) {
  const response = await api.post(`/api/rooms/${r.id}/commands`, {
    headers: { origin },
    data: { key, version: r.version, command: c },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as RoomView;
}

async function playable(api: APIRequestContext, browser: Browser) {
  if (!cloud) {
    await init(api);
    const response = await api.post("/api/demo", { headers: { origin }, data: {} });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()) as RoomView;
  }
  let r = await create(api);
  const guest = await device(browser);
  try {
    const pending = await command(guest.request, r, {
      type: "request",
      kind: "join",
      name: "Test guest",
      amount: 500,
    });
    r = await command(api, pending, { type: "approve", requestId: pending.requests.at(-1)!.id });
    return await command(api, r, { type: "start" });
  } finally {
    await guest.close();
  }
}

test("mobile creation, host controls, practice table and responsive layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /All the poker/ })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Create a room" }).click();
  await page.getByLabel("Your display name").fill("Alex");
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page.getByRole("heading", { name: "Friday night poker" })).toBeVisible();
  await expect(page.getByText("Waiting for another player.")).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-room.png", fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  if (!cloud) {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a practice table" }).click();
    await expect(page.getByRole("heading", { name: "The Friday Table" })).toBeVisible();
    await page.getByLabel("Record spoken action").check();
    await page.getByRole("button", { name: "Fold", exact: true }).click();
    await expect(page.getByText("Your chips are safe. Enjoy the game.")).not.toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: "test-results/mobile-practice.png", fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/desktop-table.png", fullPage: true });
  await page.goto("/");
  await expect(page.locator(".home-page")).toHaveAttribute("data-ready", "true");
  await page.screenshot({ path: "test-results/desktop-home.png", fullPage: true });
});

test("separate devices join, approve, play a whole hand, assign pot, dispute, finalize", async ({
  browser,
}) => {
  const host = await device(browser),
    guest = await device(browser),
    outsider = await device(browser);
  let r = await create(host.request);
  await init(guest.request);
  await init(outsider.request);
  const hp = await host.newPage(),
    gp = await guest.newPage();
  await hp.goto(`/room/${r.id}`);
  await gp.goto(`/?code=${r.code}`);
  await gp.getByRole("button", { name: "Find my table" }).click();
  await gp.getByLabel("Your display name").fill("Sam");
  await gp.getByRole("button", { name: "Request a seat" }).click();
  await expect(gp.getByText("Your seat is almost ready.")).toBeVisible();
  let pending = (await (await host.request.get(`/api/rooms/${r.id}`)).json()) as RoomView;
  expect(pending.requests).toHaveLength(1);
  await hp.getByRole("button", { name: /Room & players/ }).click();
  await hp.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(gp.getByText("Let’s get the cards out.")).toBeVisible();
  r = await (await host.request.get(`/api/rooms/${r.id}`)).json();
  const guestView = await (await guest.request.get(`/api/rooms/${r.id}`)).json();
  expect(guestView.funds).toBeUndefined();
  expect(guestView.members).toBeUndefined();
  expect(guestView.undo).toBeUndefined();
  const outsiderView = await (await outsider.request.get(`/api/rooms/${r.id}`)).json();
  expect(outsiderView.game.players).toHaveLength(0);
  r = await command(host.request, r, { type: "start" });
  while (r.game.stage !== "showdown") {
    const actor = r.game.turn!;
    const p = r.game.players.find((p) => p.id === actor)!;
    r = await command(actor === r.host ? host.request : guest.request, r, {
      type: "play",
      playerId: actor,
      action: p.bet < r.game.currentBet ? "call" : "check",
    });
  }
  r = await command(host.request, r, { type: "award", potId: 0, winners: [guestView.me], odd: [] });
  expect(r.game.players.reduce((n, p) => n + p.stack, 0)).toBe(1000);
  r = await command(host.request, r, { type: "settle" });
  r = await command(guest.request, r, {
    type: "confirm",
    disputed: true,
    note: "Please verify my total",
  });
  r = await command(host.request, r, {
    type: "resolve",
    playerId: guestView.me,
    note: "Counted and checked together",
  });
  r = await command(host.request, r, { type: "finalize" });
  expect(r.settlement?.finalized).toBe(true);
  expect(r.settlement?.payments).toHaveLength(1);
  await host.close();
  await guest.close();
  await outsider.close();
});

test("server rejects stale concurrent actions and treats identical retries as once", async ({
  browser,
}) => {
  const ctx = await device(browser);
  let r = await playable(ctx.request, browser);
  const envelope = {
    key: randomUUID(),
    version: r.version,
    command: { type: "play", playerId: r.game.turn!, action: "call", override: true },
  };
  const results = await Promise.all([
    ctx.request.post(`/api/rooms/${r.id}/commands`, { headers: { origin }, data: envelope }),
    ctx.request.post(`/api/rooms/${r.id}/commands`, { headers: { origin }, data: envelope }),
  ]);
  expect(results.every((x) => x.ok())).toBeTruthy();
  const after = await (await ctx.request.get(`/api/rooms/${r.id}`)).json();
  expect(after.version).toBe(r.version + 1);
  const stale = await ctx.request.post(`/api/rooms/${r.id}/commands`, {
    headers: { origin },
    data: { ...envelope, key: randomUUID() },
  });
  expect(stale.status()).toBe(409);
  const csrf = await ctx.request.post(`/api/rooms/${r.id}/commands`, {
    headers: { origin: "https://evil.example" },
    data: { key: randomUUID(), version: after.version, command: { type: "undo" } },
  });
  expect(csrf.ok()).toBe(false);
  await ctx.close();
});

test("offline state pauses actions and recovers to the same version", async ({ browser }) => {
  const context = await device(browser);
  const r = await playable(context.request, browser);
  const page = await context.newPage();
  await page.goto(`/room/${r.id}`);
  await page.getByLabel("Record spoken action").check();
  await context.setOffline(true);
  await expect(page.getByText(/Connection lost. Play is paused/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Fold", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Fold", exact: true })).toBeEnabled();
  const after = await (await context.request.get(`/api/rooms/${r.id}`)).json();
  expect(after.version).toBe(r.version);
  await context.close();
});

test("ten seats fit a narrow phone, with recovery and display privacy", async ({ browser }) => {
  const host = await device(browser);
  let r = await create(host.request);
  const guests = [];
  for (let i = 1; i <= 9; i++) {
    const guest = await device(browser);
    guests.push(guest);
    await init(guest.request);
    const own = await command(guest.request, r, {
      type: "request",
      kind: "join",
      name: `Friend ${i}`,
      amount: 500,
    });
    const req = own.requests.at(-1)!;
    r = await command(host.request, own, { type: "approve", requestId: req.id });
  }
  const page = await host.newPage();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/room/${r.id}`);
  await expect(page.locator(".table-seat")).toHaveCount(10);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const boxes = await page.locator(".table-seat").evaluateAll((elements) =>
    elements.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      const intersection =
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      expect(intersection).toBe(0);
    }
  await page.screenshot({ path: "test-results/mobile-ten-seats.png", fullPage: true });
  const tv = await device(browser);
  await init(tv.request);
  let view = await command(tv.request, r, {
    type: "request",
    kind: "display",
    name: "TV",
    amount: 0,
  });
  r = await command(host.request, view, { type: "approve", requestId: view.requests.at(-1)!.id });
  view = await (await tv.request.get(`/api/rooms/${r.id}`)).json();
  expect(view.role).toBe("display");
  expect(view.funds).toBeUndefined();
  expect(view.audit).toEqual([]);
  const denied = await tv.request.get(`/api/rooms/${r.id}/audit`);
  expect(denied.ok()).toBe(false);
  const replacement = await device(browser);
  await init(replacement.request);
  view = await command(replacement.request, r, {
    type: "request",
    kind: "recover",
    name: "Friend 1",
    playerId: "Friend 1",
    amount: 0,
  });
  r = await command(host.request, view, { type: "approve", requestId: view.requests.at(-1)!.id });
  const old = await (await guests[0].request.get(`/api/rooms/${r.id}`)).json();
  expect(old.role).toBe("pending");
  const recovered = await (await replacement.request.get(`/api/rooms/${r.id}`)).json();
  expect(recovered.me).toBe(r.game.players.find((p) => p.name === "Friend 1")!.id);
  r = await command(host.request, r, { type: "revokeDisplay", userId: r.displays[0] });
  const revoked = await (await tv.request.get(`/api/rooms/${r.id}`)).json();
  expect(revoked.role).toBe("pending");
  expect(revoked.game.players).toEqual([]);
  await host.close();
  await tv.close();
  await replacement.close();
  for (const guest of guests) await guest.close();
});

test("Supabase realtime updates another device with polling disabled", async ({ browser }) => {
  test.skip(!cloud, "Requires a live Supabase project.");
  const host = await device(browser),
    guest = await device(browser);
  try {
    let r = await create(host.request);
    const pending = await command(guest.request, r, {
      type: "request",
      kind: "join",
      name: "Realtime guest",
      amount: 500,
    });
    r = await command(host.request, pending, {
      type: "approve",
      requestId: pending.requests.at(-1)!.id,
    });
    await guest.addInitScript(() => {
      const original = window.setInterval.bind(window);
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        original(
          handler,
          timeout === 3000 ? 3600000 : timeout,
          ...args,
        )) as typeof window.setInterval;
    });
    const page = await guest.newPage();
    const messages: Array<{ event?: string; payload?: any }> = [];
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/realtime/")) return;
      socket.on("socketerror", (error) => console.log("Realtime socket error:", error));
      socket.on("framereceived", ({ payload }) => {
        try {
          const frame = JSON.parse(payload.toString());
          // Realtime protocol v2 uses [join_ref, ref, topic, event, payload].
          const message = Array.isArray(frame) ? { event: frame[3], payload: frame[4] } : frame;
          messages.push(message);
        } catch {}
      });
    });
    await page.goto(`/room/${r.id}`);
    await expect(page.getByText("Let’s get the cards out.")).toBeVisible();
    await expect
      .poll(
        () =>
          messages.some(
            (m) =>
              m.event === "phx_reply" &&
              m.payload?.status === "ok" &&
              m.payload?.response?.postgres_changes?.length > 0,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    await expect
      .poll(() => messages.some((m) => m.event === "system" && m.payload?.status === "ok"), {
        timeout: 20000,
      })
      .toBe(true);
    r = await command(host.request, r, { type: "start" });
    r = await command(host.request, r, { type: "play", playerId: r.game.turn!, action: "call" });
    await expect(page.getByRole("button", { name: "Check", exact: true })).toBeEnabled({
      timeout: 15000,
    });
    expect(
      messages.some(
        (m) => m.event === "postgres_changes" && m.payload?.data?.record?.room_id === r.id,
      ),
    ).toBe(true);
    const response = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/rooms/${r.id}/commands`) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Check", exact: true }).click();
    expect((await response).ok()).toBe(true);
    const updated = await (await host.request.get(`/api/rooms/${r.id}`)).json();
    expect(updated.game.stage).toBe("flop");
    expect(updated.version).toBe(r.version + 1);
  } finally {
    await host.close();
    await guest.close();
  }
});

test("hosted cleanup requires its secret and executes successfully", async ({ request }) => {
  test.skip(!cloud, "Requires a live Supabase project.");
  expect(process.env.CRON_SECRET, "Set CRON_SECRET for hosted cleanup verification").toBeTruthy();
  expect((await request.get("/api/cleanup")).status()).toBe(401);
  const response = await request.get("/api/cleanup", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  expect((await response.json()).removed).toEqual(expect.any(Number));
});
