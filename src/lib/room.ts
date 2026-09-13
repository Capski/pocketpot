import {
  act,
  award,
  chips,
  emptyGame,
  ensure,
  integer,
  makePlayer,
  seated,
  startHand,
  validateConfig,
} from "./poker";
import { minimizePayments } from "./settlement";
import { createHash } from "node:crypto";
import type { Command, Config, Room, RoomView } from "./types";

export function createRoom(
  id: string,
  code: string,
  userId: string,
  name: string,
  playerName: string,
  config: Config,
  now = new Date().toISOString(),
): Room {
  const game = emptyGame(config);
  game.players.push(makePlayer(id + "-host", playerName, 1, config.buyIn));
  return {
    id,
    code,
    name,
    version: 0,
    host: game.players[0].id,
    cohost: null,
    game,
    funds: { [game.players[0].id]: { buyIn: config.buyIn, cashOut: 0 } },
    members: { [userId]: game.players[0].id },
    displays: [],
    requests: [],
    audit: [
      {
        seq: 0,
        at: now,
        actor: playerName,
        text: "Room opened. Initial buy-in approved.",
        financial: true,
      },
    ],
    undo: [],
    receipts: {},
    createdAt: now,
    lastSeen: now,
  };
}
export function roleFor(r: Room, userId: string): RoomView["role"] {
  const id = r.members[userId];
  return id === r.host
    ? "host"
    : id && id === r.cohost
      ? "cohost"
      : id
        ? "player"
        : r.displays.includes(userId)
          ? "display"
          : "pending";
}
export function visibleAudit(r: Room, userId: string) {
  const role = roleFor(r, userId);
  ensure(
    role !== "pending" && role !== "display",
    "Only approved players can read the activity log.",
  );
  return r.audit
    .filter((e) => role === "host" || !e.financial)
    .map(({ privateText, ...e }) => ({
      ...e,
      text: role === "host" && privateText ? `${e.text} ${privateText}` : e.text,
    }));
}
export function project(r: Room, userId: string): RoomView {
  const role = roleFor(r, userId),
    allowed = role !== "pending",
    host = role === "host";
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    version: r.version,
    host: allowed ? r.host : "",
    cohost: allowed ? r.cohost : null,
    game: allowed ? structuredClone(r.game) : emptyGame(r.game.config),
    me: r.members[userId] ?? null,
    role,
    audit: allowed && role !== "display" ? visibleAudit(r, userId).slice(-100) : [],
    requests: host
      ? r.requests.filter((x) => x.status === "pending")
      : r.requests.filter((x) => x.userId === userId),
    undoCount: role === "host" || role === "cohost" ? r.undo.length : 0,
    ...(host ? { funds: structuredClone(r.funds) } : {}),
    ...(allowed && role !== "display" && r.settlement
      ? { settlement: structuredClone(r.settlement) }
      : {}),
    displays: host ? r.displays : [],
    pendingStatus: r.requests.filter((x) => x.userId === userId).at(-1)?.status,
  };
}
export function assertRoom(r: Room) {
  for (const p of r.game.players) {
    integer(p.stack, "Stack");
    integer(p.committed, "Commitment");
    integer(p.bet, "Bet");
    ensure(p.bet <= p.committed, "Bet exceeds commitment.");
  }
  const net = Object.values(r.funds).reduce((n, f) => n + f.buyIn - f.cashOut, 0);
  ensure(chips(r.game) === net, "Ledger does not balance. No changes were saved.");
  ensure(seated(r.game).length <= 10, "A table supports at most 10 players.");
  ensure(
    !r.settlement || r.settlement.rows.reduce((n, p) => n + p.net, 0) === 0,
    "Settlement must balance.",
  );
}

export function pruneDetails(r: Room, now = new Date().toISOString()) {
  const cutoff = Date.parse(now) - 90 * 86400000;
  r.audit = r.audit.filter((e) => Date.parse(e.at) >= cutoff);
  r.undo = r.undo.filter((e) => Date.parse(e.at ?? r.createdAt) >= cutoff);
  r.requests = r.requests.filter((e) => Date.parse(e.at ?? r.createdAt) >= cutoff);
  for (const key of Object.keys(r.receipts))
    if (!r.receipts[key].startsWith("sha256:")) {
      r.receipts[key] = "sha256:" + createHash("sha256").update(r.receipts[key]).digest("hex");
    }
  return r;
}
export function applyCommand(
  original: Room,
  userId: string,
  command: Command,
  key: string,
  expected: number,
  now = new Date().toISOString(),
): Room {
  const receipt = userId + ":" + key,
    raw = JSON.stringify(command),
    fingerprint = "sha256:" + createHash("sha256").update(raw).digest("hex");
  if (original.receipts[receipt]) {
    ensure(
      original.receipts[receipt] === fingerprint || original.receipts[receipt] === raw,
      "This command key was already used for a different action.",
    );
    return original;
  }
  ensure(
    original.version === expected,
    "The table changed. Review the latest state and try again.",
  );
  ensure(
    !original.settlement?.finalized || command.type === "revokeDisplay",
    "This room is finalized.",
  );
  const r = pruneDetails(structuredClone(original), now),
    c = command,
    me = r.members[userId],
    role = roleFor(r, userId);
  const host = () => ensure(role === "host", "Only the host can do this.");
  const manage = () =>
    ensure(role === "host" || role === "cohost", "Only the host or co-host can manage play.");
  const between = () =>
    ensure(r.game.stage === "between", "This change is only allowed between hands.");
  const player = (id: string) => {
    const p = r.game.players.find((p) => p.id === id);
    ensure(p, "Player not found.");
    return p;
  };
  const pname = (id: string) => player(id).name;
  const snapshot = () => {
    r.undo.push({ game: structuredClone(r.game), at: now });
  };
  let text = "",
    financial = false,
    privateText: string | undefined;
  ensure(role !== "display", "Paired displays are read-only.");
  ensure(
    !r.settlement ||
      [
        "confirm",
        "resolve",
        "finalize",
        "cancelSettlement",
        "transfer",
        "request",
        "approve",
        "reject",
        "revokeDisplay",
      ].includes(c.type),
    "Resolve or reopen the settlement before changing the table.",
  );
  switch (c.type) {
    case "start":
      manage();
      snapshot();
      startHand(r.game);
      text = `Hand #${r.game.hand} started. ${pname(r.game.dealer!)} has the button.`;
      break;
    case "play": {
      ensure(me, "You must be approved to play.");
      if (c.override) manage();
      else ensure(me === c.playerId, "You can only record your own action.");
      snapshot();
      const before = r.game.stage;
      const acting = player(c.playerId);
      const detail =
        c.action === "raise"
          ? ` to ${c.amount}`
          : c.action === "call"
            ? ` ${Math.min(acting.stack, Math.max(0, r.game.currentBet - acting.bet))}`
            : c.action === "allin"
              ? ` for ${acting.stack} (total ${acting.stack + acting.bet})`
              : "";
      act(r.game, c);
      text = `${pname(c.playerId)}: ${c.action === "allin" ? "all-in" : c.action}${detail}.${c.override ? " Host/co-host override." : ""}${before !== r.game.stage ? ` → ${r.game.stage}.` : ""}`;
      break;
    }
    case "award":
      manage();
      snapshot();
      award(r.game, c.potId, c.winners, c.odd);
      text = `Pot ${c.potId + 1} awarded to ${c.winners.map(pname).join(", ")}.${c.odd.length ? ` Leftover units: ${c.odd.map(pname).join(", ")} (+1 each).` : ""}`;
      break;
    case "undo":
      manage();
      ensure(r.undo.length, "Nothing to undo across the last financial or seating change.");
      {
        const previous = r.undo.pop()!;
        r.game = previous.game ?? (previous as unknown as Room["game"]);
      }
      text = "Undid the previous gameplay step. Earlier events remain in the audit.";
      break;
    case "blinds":
      manage();
      between();
      validateConfig({ ...r.game.config, ...c });
      r.game.config.smallBlind = c.smallBlind;
      r.game.config.bigBlind = c.bigBlind;
      r.game.config.ante = c.ante;
      r.undo = [];
      text = `Blinds changed to ${c.smallBlind}/${c.bigBlind}, ante ${c.ante}.`;
      break;
    case "seats": {
      manage();
      between();
      const ids = seated(r.game).map((p) => p.id);
      ensure(
        ids.length === c.order.length &&
          new Set(c.order).size === ids.length &&
          ids.every((id) => c.order.includes(id)),
        "Include each seated player exactly once.",
      );
      c.order.forEach((id, i) => (player(id).seat = i + 1));
      r.undo = [];
      text = `Seat order: ${c.order.map(pname).join(" → ")}. Button stays with its player.`;
      break;
    }
    case "sit":
      ensure(
        me === c.playerId || role === "host" || role === "cohost",
        "You can only change your own availability.",
      );
      between();
      ensure(!player(c.playerId).left, "This player has cashed out.");
      player(c.playerId).sittingOut = c.sittingOut;
      r.undo = [];
      text = `${pname(c.playerId)} ${c.sittingOut ? "is sitting out" : "returned; no missed blinds owed"}.`;
      break;
    case "request": {
      ensure(
        r.requests.filter((q) => q.status === "pending").length < 30,
        "The request queue is full.",
      );
      ensure(
        !r.requests.some((q) => q.userId === userId && q.status === "pending"),
        "You already have a pending request.",
      );
      if (c.kind === "join" || c.kind === "display" || c.kind === "recover")
        ensure(!me, "This device already has a seat.");
      if (c.kind === "rebuy" || c.kind === "cashout") {
        ensure(me, "Join the room first.");
        between();
        ensure(!player(me).left, "This seat has already cashed out.");
      }
      if (r.settlement)
        ensure(c.kind === "recover", "Only device recovery is available during settlement.");
      if (c.kind === "join" || c.kind === "rebuy") {
        integer(c.amount, "Buy-in", r.game.config.minBuyIn);
        ensure(c.amount <= r.game.config.maxBuyIn, "Buy-in exceeds the maximum.");
      }
      let recoveryId = c.playerId;
      if (c.kind === "recover") {
        ensure(c.playerId, "Enter your existing player name.");
        const existing = r.game.players.find(
          (p) => p.id === c.playerId || p.name.toLowerCase() === c.playerId!.toLowerCase(),
        );
        ensure(
          existing,
          "No existing seat matches that name. Ask the host for your exact display name.",
        );
        recoveryId = existing.id;
      }
      r.requests.push({
        id: key,
        at: now,
        userId,
        name: c.name,
        kind: c.kind,
        amount: c.kind === "cashout" ? player(me).stack : c.amount,
        playerId: me || recoveryId,
        status: "pending",
      });
      text = `${c.name} requested ${c.kind === "recover" ? "device recovery" : c.kind}.`;
      break;
    }
    case "approve":
    case "reject": {
      host();
      const q = r.requests.find((q) => q.id === c.requestId && q.status === "pending");
      ensure(q, "Request not found.");
      if (c.type === "reject") {
        q.status = "rejected";
        text = `${q.name}'s ${q.kind} request was declined.`;
        break;
      }
      if (r.settlement)
        ensure(q.kind === "recover", "Only recovery can be approved during settlement.");
      if (q.kind === "join" || q.kind === "rebuy" || q.kind === "cashout") between();
      if (q.kind === "join") {
        ensure(seated(r.game).length < 10, "All 10 seats are occupied.");
        ensure(
          r.game.players.length < 10,
          "This MVP supports 10 participants per session, including cashed-out seats.",
        );
        ensure(!Object.values(r.members).includes(q.id), "Already approved.");
        ensure(
          !r.game.players.some((p) => p.name.toLowerCase() === q.name.toLowerCase()),
          "Choose a display name different from an existing player.",
        );
        const p = makePlayer(
          q.id,
          q.name,
          Math.max(0, ...r.game.players.map((p) => p.seat)) + 1,
          q.amount,
        );
        r.game.players.push(p);
        r.members[q.userId] = p.id;
        r.funds[p.id] = { buyIn: q.amount, cashOut: 0 };
      } else if (q.kind === "rebuy") {
        const p = player(q.playerId!);
        ensure(!p.left, "Player already left.");
        p.stack += q.amount;
        r.funds[p.id].buyIn += q.amount;
      } else if (q.kind === "cashout") {
        const p = player(q.playerId!);
        ensure(p.id !== r.host, "Transfer host ownership before cashing out.");
        ensure(!p.left, "Already cashed out.");
        r.funds[p.id].cashOut += p.stack;
        p.stack = 0;
        p.left = true;
        p.sittingOut = true;
        if (r.cohost === p.id) r.cohost = null;
      } else if (q.kind === "recover") {
        for (const [device, id] of Object.entries(r.members))
          if (id === q.playerId) delete r.members[device];
        r.members[q.userId] = q.playerId!;
      } else {
        ensure(!r.displays.includes(q.userId), "Already paired.");
        r.displays.push(q.userId);
      }
      q.status = "approved";
      r.undo = [];
      if (q.kind === "join" || q.kind === "rebuy")
        privateText = `Approved amount: ${q.amount} ${r.game.config.currency}.`;
      if (q.kind === "cashout")
        privateText = `Cash-out total: ${r.funds[q.playerId!].cashOut} ${r.game.config.currency}.`;
      // Public audit shows approvals; the private ledger carries the amounts.
      text = `${q.name}'s ${q.kind} request was approved.${q.kind === "recover" ? " Previous device access revoked." : ""}`;
      break;
    }
    case "cohost":
      host();
      ensure(!player(c.playerId).left && c.playerId !== r.host, "Choose another active player.");
      r.cohost = c.playerId;
      text = `${pname(c.playerId)} is now co-host.`;
      break;
    case "transfer":
      host();
      ensure(!player(c.playerId).left && c.playerId !== r.host, "Choose another active player.");
      r.host = c.playerId;
      if (r.cohost === c.playerId) r.cohost = null;
      r.undo = [];
      text = `Full host ownership transferred to ${pname(c.playerId)}.`;
      break;
    case "adjust": {
      host();
      between();
      ensure(c.from !== c.to, "Choose two different players.");
      integer(c.amount, "Adjustment", 1);
      const from = player(c.from),
        to = player(c.to);
      ensure(
        !from.left && !to.left && from.stack >= c.amount,
        "Insufficient chips or a player has left.",
      );
      from.stack -= c.amount;
      to.stack += c.amount;
      r.undo = [];
      text = `Stack correction: ${c.amount} from ${from.name} to ${to.name}. Reason: ${c.reason}`;
      break;
    }
    case "settle": {
      host();
      between();
      ensure(
        !r.requests.some(
          (q) => q.status === "pending" && ["join", "rebuy", "cashout"].includes(q.kind),
        ),
        "Approve or decline pending financial requests first.",
      );
      const rows = r.game.players.map((p) => ({
        id: p.id,
        name: p.name,
        buyIn: r.funds[p.id].buyIn,
        cashOut: r.funds[p.id].cashOut + p.stack,
        net: r.funds[p.id].cashOut + p.stack - r.funds[p.id].buyIn,
        confirmation: "pending" as const,
      }));
      r.settlement = { rows, payments: minimizePayments(rows), finalized: false };
      r.undo = [];
      text = "Settlement opened. Everyone can review and confirm their own totals.";
      break;
    }
    case "cancelSettlement":
      host();
      ensure(r.settlement, "No settlement to reopen.");
      delete r.settlement;
      text = "Settlement reopened for corrections. Confirmations reset.";
      break;
    case "confirm": {
      ensure(me && r.settlement, "No settlement to confirm.");
      const row = r.settlement.rows.find((p) => p.id === me)!;
      ensure(!c.disputed || c.note.trim().length >= 3, "Explain the disagreement.");
      row.confirmation = c.disputed ? "disputed" : "confirmed";
      row.note = c.note;
      text = `${pname(me)} ${c.disputed ? "flagged a disagreement" : "confirmed their totals"}.`;
      break;
    }
    case "resolve":
      host();
      ensure(r.settlement, "No settlement.");
      {
        const row = r.settlement.rows.find((p) => p.id === c.playerId);
        ensure(row && row.confirmation === "disputed", "No dispute for this player.");
        row.confirmation = "resolved";
        row.note = c.note;
        text = `${row.name}'s dispute resolved: ${c.note}`;
      }
      break;
    case "finalize":
      host();
      ensure(r.settlement, "Open settlement first.");
      ensure(
        !r.settlement.rows.some((p) => p.confirmation === "disputed"),
        "Resolve flagged disagreements before finalizing.",
      );
      r.settlement.finalized = true;
      r.finalizedAt = now;
      text = "Session finalized. Payments take place externally.";
      break;
    case "revokeDisplay":
      host();
      ensure(r.displays.includes(c.userId), "Display not found.");
      r.displays = r.displays.filter((id) => id !== c.userId);
      text = "Shared display access revoked.";
      break;
    default: {
      const unreachable: never = c;
      throw new Error(`Unknown command: ${unreachable}`);
    }
  }
  r.version++;
  if (role !== "pending") r.lastSeen = now;
  r.receipts[receipt] = fingerprint;
  r.audit.push({
    seq: r.version,
    at: now,
    actor: me ? pname(me) : "Guest",
    text,
    financial,
    ...(privateText ? { privateText } : {}),
  });
  assertRoom(r);
  return r;
}
