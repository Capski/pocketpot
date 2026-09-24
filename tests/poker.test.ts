import { describe, expect, it } from "vitest";
import {
  act,
  award,
  buildPots,
  chips,
  continueHand,
  emptyGame,
  legal,
  makePlayer,
  nextPositions,
  startHand,
} from "../src/lib/poker";
import { applyCommand, assertRoom, createRoom, project, pruneDetails } from "../src/lib/room";
import { minimizePayments } from "../src/lib/settlement";
import type { Command, Game } from "../src/lib/types";

export const config = {
  currency: "HKD" as const,
  buyIn: 500,
  minBuyIn: 20,
  maxBuyIn: 2000,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
};
function table(stacks = [500, 500, 500], ante = 0) {
  const g = emptyGame({ ...config, ante });
  g.players = stacks.map((stack, i) => makePlayer(String(i), `Player ${i}`, i + 1, stack));
  startHand(g);
  return g;
}
function play(g: Game, action: "check" | "call" | "fold" | "allin" | "raise", amount?: number) {
  act(g, { type: "play", playerId: g.turn!, action, amount });
}

describe("betting and rotation", () => {
  it("posts 3-handed blinds and gives UTG first action", () => {
    const g = table();
    expect([g.dealer, g.smallBlind, g.bigBlind, g.turn]).toEqual(["0", "1", "2", "0"]);
    expect(chips(g)).toBe(1500);
  });
  it("gives the heads-up button the small blind and first preflop action", () => {
    const g = table([500, 500]);
    expect([g.dealer, g.smallBlind, g.bigBlind, g.turn]).toEqual(["0", "0", "1", "0"]);
    play(g, "call");
    play(g, "check");
    expect(g.stage).toBe("flop");
    expect(g.turn).toBe("1");
  });
  it("requires a check from the big blind then progresses every street", () => {
    const g = table();
    play(g, "call");
    play(g, "call");
    expect(g.stage).toBe("preflop");
    play(g, "check");
    for (const street of ["flop", "turn", "river"]) {
      expect(g.stage).toBe(street);
      for (let i = 0; i < 3; i++) play(g, "check");
    }
    expect(g.stage).toBe("showdown");
    expect(g.pots[0].amount).toBe(30);
  });
  it("waits for card reveal between streets and blocks actions until continued", () => {
    const g = emptyGame({ ...config, pauseBetweenStreets: true });
    g.players = [makePlayer("0", "A", 1, 500), makePlayer("1", "B", 2, 500)];
    startHand(g);
    play(g, "call");
    play(g, "check");
    expect(g.stage).toBe("preflop");
    expect(g.pendingStage).toBe("flop");
    expect(g.turn).toBeNull();
    expect(legal(g, "0")).toBeNull();
    expect(() => act(g, { type: "play", playerId: "0", action: "check", override: true })).toThrow(
      "cards",
    );
    continueHand(g);
    expect(g.stage).toBe("flop");
    expect(g.pendingStage).toBeUndefined();
    expect(g.turn).toBe("1");
    expect(chips(g)).toBe(1000);
  });
  it("skips card pauses when all betting decisions are finished by all-ins", () => {
    const g = emptyGame({ ...config, pauseBetweenStreets: true });
    g.players = [makePlayer("0", "A", 1, 100), makePlayer("1", "B", 2, 100)];
    startHand(g);
    play(g, "allin");
    play(g, "call");
    expect(g.stage).toBe("showdown");
    expect(g.pendingStage).toBeUndefined();
  });
  it("rejects out-of-turn actions, illegal checks, and undersized raises", () => {
    const g = table();
    expect(() => act(g, { type: "play", playerId: "1", action: "call" })).toThrow("turn");
    expect(() => play(g, "check")).toThrow("call");
    expect(() => play(g, "raise", 15)).toThrow("Minimum");
  });
  it("does not reopen a full raise after one short all-in", () => {
    const g = table([500, 25, 500]);
    play(g, "raise", 20);
    play(g, "allin");
    play(g, "call");
    expect(g.turn).toBe("0");
    expect(legal(g, "0")?.canRaise).toBe(false);
    expect(() => play(g, "raise", 40)).toThrow("reopened");
    play(g, "call");
    expect(g.stage).toBe("flop");
  });
  it("reopens after cumulative short all-ins equal a full raise", () => {
    const g = table([500, 25, 30, 500]);
    expect(g.turn).toBe("3");
    play(g, "raise", 20);
    play(g, "call");
    play(g, "allin");
    play(g, "allin");
    expect(g.turn).toBe("3");
    expect(legal(g, "3")?.canRaise).toBe(true);
    expect(legal(g, "3")?.min).toBe(40);
  });
  it("returns an uncalled all-in and builds main/side pots", () => {
    const g = table([300, 200, 100]);
    play(g, "allin");
    play(g, "allin");
    play(g, "allin");
    expect(g.stage).toBe("showdown");
    expect(g.players[0].stack).toBe(100);
    expect(g.pots.map((p) => p.amount)).toEqual([300, 200]);
    expect(g.pots[1].eligible).toEqual(["0", "1"]);
    expect(chips(g)).toBe(600);
  });
  it("folds to a winner without requiring showdown", () => {
    const g = table();
    play(g, "fold");
    play(g, "fold");
    expect(g.stage).toBe("between");
    expect(g.players.map((p) => p.stack)).toEqual([500, 495, 505]);
    expect(g.pots[0].amount).toBe(10);
  });
  it("does not let a folded contributor win a pot", () => {
    const g = table();
    play(g, "call");
    play(g, "call");
    play(g, "check");
    play(g, "fold");
    play(g, "check");
    play(g, "check");
    while (g.stage !== "showdown") play(g, "check");
    expect(g.pots[0].eligible).not.toContain("1");
    expect(() => award(g, 0, ["1"], [])).toThrow("eligible");
  });
  it("counts antes in the pot without raising the call amount", () => {
    const g = table([500, 500, 500], 1);
    expect(legal(g, "0")?.call).toBe(10);
    expect(chips(g)).toBe(1500);
    expect(g.players.reduce((n, p) => n + p.committed, 0)).toBe(18);
  });
  it("handles a blind all-in for less than a big blind", () => {
    const g = table([100, 100, 6]);
    expect(legal(g, "0")?.call).toBe(10);
    play(g, "call");
    play(g, "call");
    expect(g.stage).toBe("flop");
    expect(chips(g)).toBe(206);
  });
  it("goes directly to showdown when everyone is all-in from antes", () => {
    const g = table([1, 1, 1], 1);
    expect(g.stage).toBe("showdown");
    expect(g.pots[0].amount).toBe(3);
  });
  it("requires explicit recipients for every leftover unit", () => {
    const g = table([1, 1, 1], 1);
    expect(() => award(g, 0, ["0", "1"], [])).toThrow("leftover");
    award(g, 0, ["0", "1"], ["1"]);
    expect(g.players.map((p) => p.stack)).toEqual([1, 2, 0]);
    expect(chips(g)).toBe(3);
  });
  it("keeps the button attached to its player on reordering", () => {
    const g = table();
    play(g, "fold");
    play(g, "fold");
    g.players[0].seat = 3;
    g.players[1].seat = 1;
    g.players[2].seat = 2;
    expect(nextPositions(g)?.dealer).toBe("1");
  });
  it("skips sitting out players without missed blinds", () => {
    const g = table();
    play(g, "fold");
    play(g, "fold");
    g.players[1].sittingOut = true;
    startHand(g);
    expect(g.dealer).toBe("2");
    expect(g.smallBlind).toBe("2");
    expect(g.bigBlind).toBe("0");
  });
  it("coalesces pot layers with identical eligibility", () => {
    const g = table();
    g.players[0].committed = 10;
    g.players[1].committed = 20;
    g.players[2].committed = 20;
    g.players[0].folded = true;
    expect(buildPots(g.players)).toHaveLength(1);
  });
});

describe("room authority and ledger", () => {
  const initial = () => createRoom("room", "ABCDEF", "host-device", "Friday game", "Alex", config);
  function add(r: ReturnType<typeof initial>, device = "guest", name = "Sam", key = "join") {
    r = applyCommand(
      r,
      device,
      { type: "request", kind: "join", amount: 500, name },
      key,
      r.version,
    );
    return applyCommand(
      r,
      "host-device",
      { type: "approve", requestId: key },
      key + "-approve",
      r.version,
    );
  }
  it("requires approval and protects private fields", () => {
    let r = initial();
    r = applyCommand(
      r,
      "guest",
      { type: "request", kind: "join", amount: 500, name: "Sam" },
      "join",
      r.version,
    );
    expect(project(r, "guest").game.players).toHaveLength(0);
    r = applyCommand(
      r,
      "host-device",
      { type: "approve", requestId: "join" },
      "approve",
      r.version,
    );
    const v = project(r, "guest");
    expect(v.role).toBe("player");
    expect(v).not.toHaveProperty("funds");
    expect(v).not.toHaveProperty("members");
    expect(v).not.toHaveProperty("undo");
    expect(v.audit.every((e) => !e.financial)).toBe(true);
    expect(v.audit.every((e) => !e.privateText && !e.text.includes("Approved amount"))).toBe(true);
    expect(
      project(r, "host-device").audit.some((e) => e.text.includes("Approved amount: 500")),
    ).toBe(true);
  });
  it("applies retries once and rejects key reuse / stale commands", () => {
    const r = add(initial());
    const c: Command = { type: "start" };
    const next = applyCommand(r, "host-device", c, "x", r.version);
    expect(applyCommand(next, "host-device", c, "x", r.version)).toBe(next);
    expect(() => applyCommand(next, "host-device", { type: "undo" }, "x", next.version)).toThrow(
      "different",
    );
    expect(() => applyCommand(next, "host-device", { type: "undo" }, "y", r.version)).toThrow(
      "changed",
    );
  });
  it("undo restores chips but appends an audit event", () => {
    let r = add(initial());
    const before = structuredClone(r.game);
    r = applyCommand(r, "host-device", { type: "start" }, "start", r.version);
    expect(() =>
      applyCommand(
        r,
        "host-device",
        { type: "tableSettings", actionMode: "individual", pauseBetweenStreets: false },
        "settings-during-hand",
        r.version,
      ),
    ).toThrow("between hands");
    r = applyCommand(r, "host-device", { type: "undo" }, "undo", r.version);
    expect(r.game).toEqual(before);
    expect(r.audit.at(-1)?.text).toContain("Undid");
    assertRoom(r);
  });
  it("co-host cannot approve money, adjust, or finalize", () => {
    let r = add(initial());
    r = applyCommand(r, "host-device", { type: "cohost", playerId: "join" }, "cohost", r.version);
    for (const c of [
      { type: "approve", requestId: "x" },
      { type: "adjust", from: r.host, to: "join", amount: 10, reason: "Correction" },
      { type: "finalize" },
    ] as Command[])
      expect(() => applyCommand(r, "guest", c, "x", r.version)).toThrow("host");
  });
  it("supports an audited cohost action on behalf of another player", () => {
    let r = add(initial());
    r = applyCommand(r, "host-device", { type: "start" }, "start", r.version);
    r = applyCommand(
      r,
      "host-device",
      { type: "play", playerId: r.game.turn!, action: "call", override: true },
      "play",
      r.version,
    );
    expect(r.audit.at(-1)?.text).toContain("override");
  });
  it("enforces spoken recording and host-only settings between hands", () => {
    let r = add(
      createRoom("room", "ABCDEF", "host-device", "Friday game", "Alex", {
        ...config,
        pauseBetweenStreets: true,
      }),
    );
    const settings: Command = {
      type: "tableSettings",
      actionMode: "spoken",
      pauseBetweenStreets: true,
    };
    expect(() => applyCommand(r, "guest", settings, "settings-guest", r.version)).toThrow("host");
    r = applyCommand(r, "host-device", settings, "settings", r.version);
    r = applyCommand(r, "host-device", { type: "cohost", playerId: "join" }, "cohost", r.version);
    r = applyCommand(r, "host-device", { type: "start" }, "start", r.version);
    expect(() => applyCommand(r, "guest", settings, "settings-active", r.version)).toThrow("host");
    expect(() =>
      applyCommand(
        r,
        "guest",
        { type: "play", playerId: "join", action: "check" },
        "self",
        r.version,
      ),
    ).toThrow("host or co-host");
    r = applyCommand(
      r,
      "guest",
      { type: "play", playerId: r.game.turn!, action: "call", override: true },
      "spoken",
      r.version,
    );
    expect(r.game.lastAction?.playerId).toBe(r.host);
    expect(project(r, "guest").game.lastAction?.action).toBe("call");
    expect(r.audit.at(-1)?.text).toContain("Recorded by host/co-host");
    r = applyCommand(
      r,
      "host-device",
      { type: "play", playerId: r.game.turn!, action: "check", override: true },
      "check",
      r.version,
    );
    expect(r.game.pendingStage).toBe("flop");
    expect(() =>
      applyCommand(
        r,
        "guest",
        { type: "tableSettings", actionMode: "individual", pauseBetweenStreets: false },
        "settings-mid",
        r.version,
      ),
    ).toThrow("host");
    r = applyCommand(r, "guest", { type: "continue" }, "continue", r.version);
    expect(r.game.stage).toBe("flop");
    expect(r.game.turn).toBe("join");
  });
  it("rejects someone acting for another player without override", () => {
    let r = add(initial());
    r = applyCommand(r, "host-device", { type: "start" }, "start", r.version);
    expect(() =>
      applyCommand(
        r,
        "guest",
        { type: "play", playerId: r.host, action: "call" },
        "play",
        r.version,
      ),
    ).toThrow("own");
  });
  it("history deletion preserves at-most-once commands without retaining their details", () => {
    let r = add(initial());
    const version = r.version;
    r = applyCommand(r, "host-device", { type: "start" }, "old-command", version);
    const oldDate = new Date(Date.now() - 91 * 86400000).toISOString();
    r.audit.forEach((e) => (e.at = oldDate));
    r.undo.forEach((e) => (e.at = oldDate));
    pruneDetails(r);
    expect(r.audit).toEqual([]);
    expect(r.undo).toEqual([]);
    expect(Object.values(r.receipts).every((v) => /^sha256:[a-f0-9]{64}$/.test(v))).toBe(true);
    expect(applyCommand(r, "host-device", { type: "start" }, "old-command", version)).toBe(r);
  });
  it("recovery revokes the old device", () => {
    let r = add(initial());
    r = applyCommand(
      r,
      "new-device",
      { type: "request", kind: "recover", name: "Sam", playerId: "join", amount: 0 },
      "recover",
      r.version,
    );
    r = applyCommand(
      r,
      "host-device",
      { type: "approve", requestId: "recover" },
      "approve-recover",
      r.version,
    );
    expect(project(r, "guest").role).toBe("pending");
    expect(project(r, "new-device").me).toBe("join");
  });
  it("pairs a read-only display without buy-ins or settlement", () => {
    let r = add(initial());
    r = applyCommand(
      r,
      "tv",
      { type: "request", kind: "display", name: "TV", amount: 0 },
      "pair",
      r.version,
    );
    r = applyCommand(
      r,
      "host-device",
      { type: "approve", requestId: "pair" },
      "pair-approve",
      r.version,
    );
    const v = project(r, "tv");
    expect(v.role).toBe("display");
    expect(v.funds).toBeUndefined();
    expect(v.audit).toEqual([]);
    expect(() => applyCommand(r, "tv", { type: "start" }, "start", r.version)).toThrow("read-only");
  });
  it("preserves net funds through financial changes and audited transfers", () => {
    let r = add(initial());
    r = applyCommand(
      r,
      "host-device",
      { type: "adjust", from: r.host, to: "join", amount: 50, reason: "Correct spoken result" },
      "adjust",
      r.version,
    );
    r = applyCommand(
      r,
      "guest",
      { type: "request", kind: "cashout", name: "Sam", amount: 0 },
      "cashout",
      r.version,
    );
    r = applyCommand(
      r,
      "host-device",
      { type: "approve", requestId: "cashout" },
      "cashout-approve",
      r.version,
    );
    expect(r.funds.join.cashOut).toBe(550);
    assertRoom(r);
  });
  it("settles exactly, resolves disputes and finalizes without unanimity", () => {
    let r = add(initial());
    r = applyCommand(
      r,
      "host-device",
      { type: "adjust", from: r.host, to: "join", amount: 50, reason: "Correction" },
      "adjust",
      r.version,
    );
    r = applyCommand(r, "host-device", { type: "settle" }, "settle", r.version);
    expect(r.settlement?.payments).toEqual([{ from: r.host, to: "join", amount: 50 }]);
    r = applyCommand(
      r,
      "guest",
      { type: "confirm", disputed: true, note: "Check my total" },
      "confirm",
      r.version,
    );
    expect(() =>
      applyCommand(r, "host-device", { type: "finalize" }, "finalize", r.version),
    ).toThrow("disagreements");
    r = applyCommand(
      r,
      "host-device",
      { type: "resolve", playerId: "join", note: "Verified together" },
      "resolve",
      r.version,
    );
    r = applyCommand(r, "host-device", { type: "finalize" }, "finalize", r.version);
    expect(r.settlement?.finalized).toBe(true);
  });
});

describe("minimized external payments", () => {
  it("finds fewer transfers than largest-first greedy", () => {
    const rows = [8, 7, -5, -3, -7].map((net, i) => ({ id: String(i), net }));
    const payments = minimizePayments(rows);
    expect(payments).toHaveLength(3);
    for (const row of rows)
      expect(
        payments.filter((p) => p.to === row.id).reduce((n, p) => n + p.amount, 0) -
          payments.filter((p) => p.from === row.id).reduce((n, p) => n + p.amount, 0),
      ).toBe(row.net);
  });
  it("returns no payments for a balanced zero game", () =>
    expect(minimizePayments([{ id: "a", net: 0 }])).toEqual([]));
  it("rejects imbalances and decimal amounts", () => {
    expect(() => minimizePayments([{ id: "a", net: 5 }])).toThrow("balance");
    expect(() =>
      minimizePayments([
        { id: "a", net: 0.5 },
        { id: "b", net: -0.5 },
      ]),
    ).toThrow("amount");
  });
});

it("conserves chips over 150 deterministic random hands", () => {
  let seed = 72541;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let test = 0; test < 150; test++) {
    const stacks = Array.from(
      { length: 2 + Math.floor(random() * 9) },
      () => 20 + Math.floor(random() * 500),
    );
    const g = table(stacks, Math.floor(random() * 3));
    const total = stacks.reduce((n, v) => n + v, 0);
    let steps = 0;
    while (g.stage !== "between" && steps++ < 150) {
      if (g.stage === "showdown") {
        const p = g.pots.find((p) => !p.winners)!;
        award(g, p.id, [p.eligible[Math.floor(random() * p.eligible.length)]], []);
      } else {
        const l = legal(g, g.turn!)!;
        const roll = random();
        play(
          g,
          roll < 0.15
            ? "fold"
            : roll < 0.4 && l.canRaise && l.max > g.currentBet
              ? "allin"
              : l.check
                ? "check"
                : "call",
        );
      }
      expect(chips(g)).toBe(total);
      expect(g.players.every((p) => p.stack >= 0 && Number.isInteger(p.stack))).toBe(true);
    }
    expect(g.stage).toBe("between");
  }
});
