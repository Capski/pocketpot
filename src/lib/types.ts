export type Currency = "HKD" | "IDR";
export type Stage = "between" | "preflop" | "flop" | "turn" | "river" | "showdown";
export type Config = {
  currency: Currency;
  buyIn: number;
  minBuyIn: number;
  maxBuyIn: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  actionMode?: "individual" | "spoken";
  pauseBetweenStreets?: boolean;
};
export type Player = {
  id: string;
  name: string;
  seat: number;
  stack: number;
  sittingOut: boolean;
  left: boolean;
  committed: number;
  bet: number;
  folded: boolean;
  inHand: boolean;
  actedAt: number | null;
};
export type Pot = {
  id: number;
  amount: number;
  eligible: string[];
  winners?: string[];
  odd?: string[];
};
export type Game = {
  config: Config;
  players: Player[];
  stage: Stage;
  hand: number;
  dealer: string | null;
  smallBlind: string | null;
  bigBlind: string | null;
  turn: string | null;
  currentBet: number;
  minRaise: number;
  pots: Pot[];
  pendingStage?: "flop" | "turn" | "river";
  lastAction?: {
    version: number;
    playerId: string;
    action: Play["action"];
    amount?: number;
  };
};
export type Funds = Record<string, { buyIn: number; cashOut: number }>;
export type Request = {
  id: string;
  userId: string;
  name: string;
  kind: "join" | "rebuy" | "cashout" | "recover" | "display";
  amount: number;
  playerId?: string;
  status: "pending" | "approved" | "rejected";
  at: string;
};
export type Audit = {
  seq: number;
  at: string;
  actor: string;
  text: string;
  financial?: boolean;
  privateText?: string;
};
export type SettlementRow = {
  id: string;
  name: string;
  buyIn: number;
  cashOut: number;
  net: number;
  confirmation: "pending" | "confirmed" | "disputed" | "resolved";
  note?: string;
};
export type Payment = { from: string; to: string; amount: number };
export type Settlement = { rows: SettlementRow[]; payments: Payment[]; finalized: boolean };
export type Room = {
  id: string;
  code: string;
  name: string;
  version: number;
  host: string;
  cohost: string | null;
  game: Game;
  funds: Funds;
  members: Record<string, string>;
  displays: string[];
  requests: Request[];
  audit: Audit[];
  undo: { game: Game; at: string }[];
  receipts: Record<string, string>;
  createdAt: string;
  lastSeen: string;
  finalizedAt?: string;
  settlement?: Settlement;
};
export type Play = {
  type: "play";
  playerId: string;
  action: "fold" | "check" | "call" | "raise" | "allin";
  amount?: number;
  override?: boolean;
};
export type Command =
  | Play
  | { type: "start" | "undo" | "settle" | "finalize" | "cancelSettlement" }
  | { type: "continue" }
  | { type: "tableSettings"; actionMode: "individual" | "spoken"; pauseBetweenStreets: boolean }
  | { type: "award"; potId: number; winners: string[]; odd: string[] }
  | { type: "blinds"; smallBlind: number; bigBlind: number; ante: number }
  | { type: "seats"; order: string[] }
  | { type: "sit"; playerId: string; sittingOut: boolean }
  | { type: "request"; kind: Request["kind"]; name: string; amount: number; playerId?: string }
  | { type: "approve" | "reject"; requestId: string }
  | { type: "cohost" | "transfer"; playerId: string }
  | { type: "adjust"; from: string; to: string; amount: number; reason: string }
  | { type: "confirm"; disputed: boolean; note: string }
  | { type: "resolve"; playerId: string; note: string }
  | { type: "revokeDisplay"; userId: string };
export type RoomView = {
  id: string;
  code: string;
  name: string;
  version: number;
  host: string;
  cohost: string | null;
  game: Game;
  me: string | null;
  role: "host" | "cohost" | "player" | "display" | "pending";
  audit: Audit[];
  requests: Request[];
  undoCount: number;
  funds?: Funds;
  settlement?: Settlement;
  displays: string[];
  pendingStatus?: string;
};
