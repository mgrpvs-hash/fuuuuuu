export type RoomStatus = "waiting" | "playing" | "finished";
export type TurnPhase = "await_roll" | "await_jail_choice" | "await_tile_action" | "await_end_turn";

export interface RoomListItem {
  code: string;
  entryFee: number;
  maxPlayers: number;
  players: number;
  status: RoomStatus;
}

export interface RoomParticipant {
  userId: string;
  name: string;
  avatarUrl?: string;
}

export interface LastDice {
  d1: number;
  d2: number;
  total: number;
  isDouble: boolean;
}

export interface PropertyState {
  id: string;
  name: string;
  color: "green" | "blue" | "red" | "yellow";
  basePrice: number;
  baseRent: number;
  ownerId?: string;
  level: number;
  shield: boolean;
  position: number;
}

export interface BoardCell {
  id: string;
  type: "start" | "property" | "tax" | "chance" | "jail" | "go_to_jail" | "free";
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
  status: "active" | "debt" | "bankrupt" | "jailed";
  inJailTurns: number;
  jailFreeCards: number;
  doublesInRow: number;
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

export interface GameState {
  roomCode: string;
  entryFee: number;
  multiplier: number;
  maxPlayers: number;
  status: RoomStatus;
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
  log: Array<{
    id: string;
    text: string;
    level: "info" | "success" | "warning" | "danger";
    createdAt: number;
  }>;
  pendingTrades: TradeProposal[];
}

export interface RoomPayload {
  code: string;
  hostId: string;
  entryFee: number;
  maxPlayers: number;
  status: RoomStatus;
  players: RoomParticipant[];
  gameState?: GameState;
}

export interface ProfileResponse {
  id: string;
  name: string;
  avatarUrl?: string | null;
  balance: number;
  wins: number;
  gamesPlayed: number;
  totalPayout: number;
  totalEntryFees: number;
  profit: number;
}
