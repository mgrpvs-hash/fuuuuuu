export type PlayerStatus = "active" | "debt" | "bankrupt" | "jailed";

export type CellType =
  | "start"
  | "property"
  | "tax"
  | "chance"
  | "jail"
  | "go_to_jail"
  | "free";

export type PropertyColor = "green" | "blue" | "red" | "yellow";

export type TurnPhase =
  | "await_roll"
  | "await_jail_choice"
  | "await_tile_action"
  | "await_end_turn";

export interface PropertyState {
  id: string;
  name: string;
  color: PropertyColor;
  basePrice: number;
  baseRent: number;
  ownerId?: string;
  level: number;
  shield: boolean;
  position: number;
}

export interface BoardCell {
  id: string;
  type: CellType;
  label: string;
  position: number;
  propertyId?: string;
  amount?: number;
}

export interface GamePlayer {
  userId: string;
  name: string;
  avatarUrl?: string;
  balance: number;
  position: number;
  status: PlayerStatus;
  inJailTurns: number;
  jailFreeCards: number;
  doublesInRow: number;
  bankruptAtRound?: number;
}

export interface RoomParticipant {
  userId: string;
  name: string;
  avatarUrl?: string;
}

export interface TradeProposal {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  offerMoney: number;
  requestMoney: number;
  offerPropertyIds: string[];
  requestPropertyIds: string[];
}

export interface ActionButton {
  key:
    | "roll"
    | "buy_property"
    | "upgrade_property"
    | "buyout_property"
    | "apply_shield"
    | "pay_jail"
    | "use_jail_card"
    | "end_turn";
  label: string;
  intent: "primary" | "secondary" | "danger";
  payload?: Record<string, string | number | boolean>;
}

export interface LastDice {
  d1: number;
  d2: number;
  total: number;
  isDouble: boolean;
}

export interface GameLogEntry {
  id: string;
  text: string;
  level: "info" | "success" | "warning" | "danger";
  createdAt: number;
}

export interface GameState {
  roomCode: string;
  entryFee: number;
  multiplier: number;
  maxPlayers: number;
  status: "waiting" | "playing" | "finished";
  players: GamePlayer[];
  board: BoardCell[];
  properties: PropertyState[];
  hostId: string;
  currentTurnPlayerId?: string;
  phase: TurnPhase;
  round: number;
  maxRounds: number;
  lastDice?: LastDice;
  pendingPropertyId?: string;
  pendingBuyoutPropertyId?: string;
  log: GameLogEntry[];
  eliminatedOrder: string[];
  pendingTrades: TradeProposal[];
}

export interface RoomState {
  code: string;
  hostId: string;
  entryFee: number;
  maxPlayers: number;
  status: "waiting" | "playing" | "finished";
  players: RoomParticipant[];
  gameState?: GameState;
  createdAt: number;
}
