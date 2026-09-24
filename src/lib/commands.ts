import { z } from "zod";
const amount = z.number().int().min(0).max(1_000_000_000);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(24);
export const configSchema = z
  .object({
    currency: z.enum(["HKD", "IDR"]),
    buyIn: amount,
    minBuyIn: amount,
    maxBuyIn: amount,
    smallBlind: amount,
    bigBlind: amount,
    ante: amount,
    actionMode: z.enum(["individual", "spoken"]).optional(),
    pauseBetweenStreets: z.boolean().optional(),
  })
  .strict();
export const createSchema = z
  .object({ name: z.string().trim().min(1).max(40), playerName: name, config: configSchema })
  .strict();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("play"),
    playerId: id,
    action: z.enum(["fold", "check", "call", "raise", "allin"]),
    amount: amount.optional(),
    override: z.boolean().optional(),
  }),
  ...(["start", "undo", "settle", "finalize", "cancelSettlement"] as const).map((type) =>
    z.object({ type: z.literal(type) }),
  ),
  z.object({ type: z.literal("continue") }),
  z.object({
    type: z.literal("tableSettings"),
    actionMode: z.enum(["individual", "spoken"]),
    pauseBetweenStreets: z.boolean(),
  }),
  z.object({
    type: z.literal("award"),
    potId: amount,
    winners: z.array(id).min(1).max(10),
    odd: z.array(id).max(9),
  }),
  z.object({ type: z.literal("blinds"), smallBlind: amount, bigBlind: amount, ante: amount }),
  z.object({ type: z.literal("seats"), order: z.array(id).min(1).max(10) }),
  z.object({ type: z.literal("sit"), playerId: id, sittingOut: z.boolean() }),
  z.object({
    type: z.literal("request"),
    kind: z.enum(["join", "rebuy", "cashout", "recover", "display"]),
    name,
    amount,
    playerId: id.optional(),
  }),
  ...(["approve", "reject"] as const).map((type) =>
    z.object({ type: z.literal(type), requestId: id }),
  ),
  ...(["cohost", "transfer"] as const).map((type) =>
    z.object({ type: z.literal(type), playerId: id }),
  ),
  z.object({
    type: z.literal("adjust"),
    from: id,
    to: id,
    amount: amount,
    reason: z.string().trim().min(3).max(240),
  }),
  z.object({ type: z.literal("confirm"), disputed: z.boolean(), note: z.string().trim().max(240) }),
  z.object({ type: z.literal("resolve"), playerId: id, note: z.string().trim().min(3).max(240) }),
  z.object({ type: z.literal("revokeDisplay"), userId: id }),
]);
export const envelopeSchema = z
  .object({ key: z.string().uuid(), version: z.number().int().min(0), command: commandSchema })
  .strict();
