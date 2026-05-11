export const PLAYER_COLORS = [
  "yellow",
  "blue",
  "red",
  "green",
  "purple",
  "orange"
] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];
export type RoomStatus = "lobby" | "in_game" | "finished";
export type CellType =
  | "start"
  | "property"
  | "chance"
  | "tax"
  | "jail"
  | "go_to_jail"
  | "free_parking";

export type CardCategory = "negative" | "chaos" | "positive";

export interface BoardCell {
  index: number;
  type: CellType;
  name: string;
  group?: string;
  price?: number;
  baseRent?: number;
  tax?: number;
}

export interface PropertyState {
  cellIndex: number;
  ownerId: string | null;
  level: number;
  shielded: boolean;
  totalUpgradeSpent: number;
  frozenTurns: number;
  scaledPrice: number;
  scaledBaseRent: number;
}

export interface PlayerState {
  id: string;
  name: string;
  avatarUrl?: string;
  color: PlayerColor;
  balance: number;
  position: number;
  isBankrupt: boolean;
  debtMode: boolean;
  properties: number[];
  skipTurns: number;
  cannotUpgradeTurns: number;
  inJail: boolean;
  jailAttempts: number;
  getOutOfJailCards: number;
  doubleStreak: number;
  buyoutDiscountTurns: number;
  joinedAt: number;
}

export type PendingActionType =
  | "none"
  | "draw_card"
  | "buy_property"
  | "upgrade_property"
  | "buyout_property"
  | "debt_sell"
  | "jail_choice";

export interface PendingAction {
  type: PendingActionType;
  playerId?: string;
  cellIndex?: number;
  details?: Record<string, unknown>;
}

export interface LastMove {
  playerId: string;
  from: number;
  to: number;
  steps: number;
  dice: [number, number];
}

export interface CardResult {
  cardId: string;
  title: string;
  description: string;
  category: CardCategory;
  icon: string;
  effectText: string;
}

export interface TradeOffer {
  id: string;
  roomCode: string;
  fromPlayerId: string;
  toPlayerId: string;
  offeredPropertyIds: number[];
  requestedPropertyIds: number[];
  moneyFrom: number;
  moneyTo: number;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "countered";
  createdAt: number;
  updatedAt: number;
  counterOfId?: string;
}

export interface GameState {
  roomCode: string;
  status: RoomStatus;
  entryFee: number;
  economyMultiplier: number;
  round: number;
  maxRounds: number;
  turnIndex: number;
  currentTurnPlayerId: string | null;
  players: PlayerState[];
  board: BoardCell[];
  properties: PropertyState[];
  pendingAction: PendingAction;
  lastEvent: string;
  history: string[];
  trades: TradeOffer[];
  lastMove?: LastMove;
  lastCard?: CardResult;
  winnerIds: string[];
}

export interface RoomSummary {
  code: string;
  creatorName: string;
  entryFee: number;
  maxPlayers: number;
  currentPlayers: number;
  status: RoomStatus;
}

export interface RoomState {
  code: string;
  creatorId: string;
  creatorName: string;
  entryFee: number;
  maxPlayers: number;
  status: RoomStatus;
  playerIds: string[];
  game: GameState | null;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  avatarUrl?: string;
  wins: number;
  totalProfit: number;
  bestWin: number;
}

export interface ProfileState {
  id: string;
  name: string;
  avatarUrl?: string;
  balance: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  bestWin: number;
}

export interface CreateRoomPayload {
  code?: string;
  entryFee: number;
  maxPlayers: number;
  playerId: string;
  playerName: string;
  avatarUrl?: string;
}

export interface JoinRoomPayload {
  code: string;
  playerId: string;
  playerName: string;
  avatarUrl?: string;
}

export interface SocketAuthPayload {
  roomCode: string;
  playerId: string;
  playerName: string;
  avatarUrl?: string;
}
