import type { BoardCellDefinition, CellType } from "./board";

export type RoomStatus = "lobby" | "playing" | "finished";
export type PlayerColor = "yellow" | "blue" | "red" | "green" | "purple" | "orange";

export interface SessionPlayer {
  id: string;
  name: string;
  avatar: string;
  color: PlayerColor;
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  totalProfit: number;
  bestWin: number;
}

export interface RoomPlayerSummary extends SessionPlayer {
  isHost: boolean;
}

export interface RoomSummary {
  code: string;
  hostId: string;
  hostName: string;
  entryFee: number;
  maxPlayers: number;
  playersCount: number;
  status: RoomStatus;
}

export interface RoomDetails extends RoomSummary {
  players: RoomPlayerSummary[];
}

export interface PropertyState {
  cellId: number;
  ownerId: string | null;
  upgradeLevel: number;
  shield: boolean;
  frozenTurns: number;
}

export interface RuntimePlayer extends SessionPlayer {
  balance: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  bankrupt: boolean;
  inDebt: boolean;
  hasRolledThisTurn: boolean;
  doublesCount: number;
  canRollAgain: boolean;
  skipTurns: number;
  jailFreeCards: number;
  buyoutDiscount: boolean;
  pendingShields: number;
  cannotUpgradeTurns: number;
  x2RentTurns: number;
}

export interface BoardCellState extends BoardCellDefinition {
  ownerId: string | null;
  upgradeLevel: number;
  shield: boolean;
  frozenTurns: number;
}

export interface DiceResult {
  die1: number;
  die2: number;
  total: number;
  isDouble: boolean;
}

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  fromCellIds: number[];
  toCellIds: number[];
  fromCoins: number;
  toCoins: number;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt: number;
}

export interface GameState {
  roomCode: string;
  entryFee: number;
  prizePool: number;
  status: RoomStatus;
  players: RuntimePlayer[];
  cells: BoardCellState[];
  currentPlayerId: string;
  round: number;
  maxRounds: number;
  recentEvent: string;
  eventLog: string[];
  winnerId: string | null;
  pendingTradeOffers: TradeOffer[];
}

export interface GameResultPlayer {
  playerId: string;
  playerName: string;
  place: number;
  prizeWon: number;
  balance: number;
}

export interface GameEndedPayload {
  roomCode: string;
  winnerId: string;
  prizePool: number;
  results: GameResultPlayer[];
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  avatar: string;
  wins: number;
  totalProfit: number;
}

export interface ProfileResponse extends SessionPlayer, PlayerStats {
  balance: number;
}

export interface SocketCommandPayload {
  roomCode: string;
  cellId?: number;
  tradeId?: string;
  tradeData?: Omit<TradeOffer, "id" | "status" | "createdAt">;
  counterOffer?: Omit<TradeOffer, "id" | "status" | "createdAt" | "fromPlayerId" | "toPlayerId">;
}

export const isPurchasableCell = (cellType: CellType): boolean => {
  return cellType === "property" || cellType === "railroad" || cellType === "utility";
};
