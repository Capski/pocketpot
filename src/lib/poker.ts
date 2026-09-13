import type { Config, Game, Player, Play, Pot } from "./types";

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function integer(value: number, label = "Amount", minimum = 0) {
  ensure(
    Number.isSafeInteger(value) && value >= minimum && value <= 1_000_000_000,
    `${label} must be a whole number between ${minimum} and 1,000,000,000.`,
  );
}
export function validateConfig(c: Config) {
  ensure(c.currency === "HKD" || c.currency === "IDR", "Choose HKD or IDR.");
  integer(c.smallBlind, "Small blind", 1);
  integer(c.bigBlind, "Big blind", c.smallBlind + 1);
  integer(c.ante, "Ante");
  integer(c.minBuyIn, "Minimum buy-in", c.bigBlind);
  integer(c.maxBuyIn, "Maximum buy-in", c.minBuyIn);
  integer(c.buyIn, "Buy-in", c.minBuyIn);
  ensure(c.buyIn <= c.maxBuyIn, "Initial buy-in exceeds the maximum.");
}
export function emptyGame(config: Config): Game {
  validateConfig(config);
  return {
    config,
    players: [],
    stage: "between",
    hand: 0,
    dealer: null,
    smallBlind: null,
    bigBlind: null,
    turn: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    pots: [],
  };
}
export function makePlayer(id: string, name: string, seat: number, stack: number): Player {
  return {
    id,
    name,
    seat,
    stack,
    sittingOut: false,
    left: false,
    committed: 0,
    bet: 0,
    folded: false,
    inHand: false,
    actedAt: null,
  };
}
export function seated(g: Game) {
  return g.players.filter((p) => !p.left).sort((a, b) => a.seat - b.seat);
}
function after(g: Game, id: string | null, valid: (p: Player) => boolean) {
  const all = [...g.players].sort((a, b) => a.seat - b.seat);
  const start = all.findIndex((p) => p.id === id);
  for (let i = 1; i <= all.length; i++) {
    const p = all[(start + i) % all.length];
    if (valid(p)) return p;
  }
  return undefined;
}
export function nextPositions(g: Game) {
  const active = (p: Player) => !p.left && !p.sittingOut && p.stack > 0;
  const count = g.players.filter(active).length;
  if (count < 2) return null;
  const dealer = after(g, g.dealer, active)!;
  const sb = count === 2 ? dealer : after(g, dealer.id, active)!;
  const bb = after(g, sb.id, active)!;
  return { dealer: dealer.id, smallBlind: sb.id, bigBlind: bb.id };
}
function commit(p: Player, amount: number, street = true) {
  const n = Math.min(amount, p.stack);
  p.stack -= n;
  p.committed += n;
  if (street) p.bet += n;
}
export function startHand(g: Game) {
  ensure(g.stage === "between", "Finish the current hand first.");
  const positions = nextPositions(g);
  ensure(positions, "At least two seated players need chips.");
  Object.assign(g, positions);
  g.hand++;
  g.stage = "preflop";
  g.pots = [];
  g.currentBet = g.config.bigBlind;
  g.minRaise = g.config.bigBlind;
  for (const p of g.players) {
    p.inHand = !p.left && !p.sittingOut && p.stack > 0;
    p.folded = false;
    p.committed = 0;
    p.bet = 0;
    p.actedAt = null;
    if (p.inHand) commit(p, g.config.ante, false);
  }
  commit(
    g.players.find((p) => p.id === g.smallBlind)!,
    g.config.smallBlind,
  );
  commit(
    g.players.find((p) => p.id === g.bigBlind)!,
    g.config.bigBlind,
  );
  progress(g, g.bigBlind!);
}
export function legal(g: Game, id: string) {
  const p = g.players.find((p) => p.id === id);
  if (
    !p ||
    !p.inHand ||
    p.folded ||
    p.stack === 0 ||
    g.stage === "between" ||
    g.stage === "showdown"
  )
    return null;
  const call = Math.min(p.stack, Math.max(0, g.currentBet - p.bet));
  const canRaise =
    (p.actedAt === null || g.currentBet - p.actedAt >= g.minRaise) &&
    g.players.some((q) => q.id !== id && q.inHand && !q.folded && q.stack > 0);
  return {
    call,
    min: g.currentBet + g.minRaise,
    max: p.bet + p.stack,
    canRaise,
    check: call === 0,
  };
}
export function act(g: Game, c: Play) {
  const p = g.players.find((p) => p.id === c.playerId);
  const l = legal(g, c.playerId);
  ensure(p && l, "This player cannot act now.");
  ensure(g.turn === p.id || c.override, "Wait for your turn.");
  if (c.action === "fold") p.folded = true;
  else if (c.action === "check") ensure(l.check, "There is a bet to call.");
  else if (c.action === "call") {
    ensure(l.call > 0, "Check when there is no bet to call.");
    commit(p, l.call);
  } else {
    const target = c.action === "allin" ? l.max : c.amount!;
    integer(target, "Raise total", 1);
    ensure(target <= l.max, "That exceeds this player's stack.");
    if (target <= g.currentBet) {
      ensure(c.action === "allin", "A raise must exceed the current bet.");
      commit(p, p.stack);
    } else {
      ensure(l.canRaise, "Betting has not reopened, or no opponent can call a raise.");
      ensure(
        target >= l.min || target === l.max,
        `Minimum raise is to ${l.min}. A smaller raise must be all-in.`,
      );
      const increment = target - g.currentBet;
      if (increment >= g.minRaise) g.minRaise = increment;
      commit(p, target - p.bet);
      g.currentBet = target;
    }
  }
  p.actedAt = g.currentBet;
  progress(g, p.id);
}
function returnUncalled(g: Game) {
  const ranked = g.players.filter((p) => p.inHand).sort((a, b) => b.bet - a.bet);
  if (ranked.length < 2) return;
  const extra = ranked[0].bet - ranked[1].bet;
  if (extra > 0) {
    ranked[0].stack += extra;
    ranked[0].bet -= extra;
    ranked[0].committed -= extra;
  }
}
export function buildPots(players: Player[]): Pot[] {
  const levels = [...new Set(players.map((p) => p.committed).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  );
  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = players.filter((p) => p.committed >= level);
    const eligible = contributors.filter((p) => p.inHand && !p.folded).map((p) => p.id);
    const amount = (level - previous) * contributors.length;
    previous = level;
    ensure(eligible.length, "A pot has no eligible player. Undo the last override.");
    const prior = pots[pots.length - 1];
    if (prior && prior.eligible.join() === eligible.join()) prior.amount += amount;
    else pots.push({ id: pots.length, amount, eligible });
  }
  return pots;
}
function showdown(g: Game) {
  returnUncalled(g);
  g.pots = buildPots(g.players);
  for (const p of g.players) {
    p.committed = 0;
    p.bet = 0;
  }
  g.stage = "showdown";
  g.turn = null;
  g.currentBet = 0;
  for (const pot of g.pots) if (pot.eligible.length === 1) award(g, pot.id, pot.eligible, []);
}
function progress(g: Game, from: string) {
  const live = g.players.filter((p) => p.inHand && !p.folded);
  if (live.length === 1) {
    returnUncalled(g);
    const amount = g.players.reduce((n, p) => n + p.committed, 0);
    live[0].stack += amount;
    for (const p of g.players) {
      p.committed = 0;
      p.bet = 0;
    }
    g.pots = [{ id: 0, amount, eligible: [live[0].id], winners: [live[0].id], odd: [] }];
    g.stage = "between";
    g.turn = null;
    g.currentBet = 0;
    return;
  }
  const able = live.filter((p) => p.stack > 0);
  // With only one stack remaining, only an outstanding call needs a decision.
  const needs = (p: Player) =>
    p.inHand &&
    !p.folded &&
    p.stack > 0 &&
    (p.bet < g.currentBet || (able.length > 1 && p.actedAt === null));
  const next = after(g, from, needs);
  if (next) {
    g.turn = next.id;
    return;
  }
  returnUncalled(g);
  if (g.stage === "river" || able.length <= 1) {
    showdown(g);
    return;
  }
  g.stage = ({ preflop: "flop", flop: "turn", turn: "river" } as const)[
    g.stage as "preflop" | "flop" | "turn"
  ];
  g.currentBet = 0;
  g.minRaise = g.config.bigBlind;
  for (const p of g.players) {
    p.bet = 0;
    p.actedAt = null;
  }
  g.turn = after(g, g.dealer, (p) => p.inHand && !p.folded && p.stack > 0)!.id;
}
export function award(g: Game, potId: number, winners: string[], odd: string[]) {
  ensure(g.stage === "showdown", "There are no pots to assign.");
  const pot = g.pots.find((p) => p.id === potId);
  ensure(pot && !pot.winners, "Pot already assigned or missing.");
  ensure(
    winners.length > 0 &&
      new Set(winners).size === winners.length &&
      winners.every((id) => pot.eligible.includes(id)),
    "Choose eligible winners only.",
  );
  const remainder = pot.amount % winners.length;
  ensure(
    odd.length === remainder &&
      new Set(odd).size === odd.length &&
      odd.every((id) => winners.includes(id)),
    `Choose ${remainder} winner(s) to receive one leftover unit each.`,
  );
  const share = Math.floor(pot.amount / winners.length);
  for (const id of winners)
    g.players.find((p) => p.id === id)!.stack += share + (odd.includes(id) ? 1 : 0);
  pot.winners = winners;
  pot.odd = odd;
  if (g.pots.every((p) => p.winners)) {
    g.stage = "between";
    g.turn = null;
  }
}
export function chips(g: Game) {
  return (
    g.players.reduce((n, p) => n + p.stack + p.committed, 0) +
    g.pots.filter((p) => !p.winners).reduce((n, p) => n + p.amount, 0)
  );
}
