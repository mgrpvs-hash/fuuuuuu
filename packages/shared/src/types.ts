export type GameStatus = "waiting" | "active" | "finished";

export type TileType =
  | "start"
  | "property"
  | "chance"
  | "tax"
  | "railroad"
  | "utility"
  | "jail"
  | "free_parking"
  | "go_to_jail";

export type PropertyColorGroup =
  | "brown"
  | "lightBlue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "darkBlue";

export type OwnableTileType = "property" | "railroad" | "utility";

export interface BoardTileBase<T extends TileType = TileType> {
  index: number;
  name: string;
  type: T;
}

export interface BasicBoardTile extends BoardTileBase<
  "start" | "chance" | "jail" | "free_parking" | "go_to_jail"
> {}

export interface TaxTile extends BoardTileBase<"tax"> {
  amount: number;
}

export interface OwnableBoardTile extends BoardTileBase<OwnableTileType> {
  colorGroup: PropertyColorGroup | "railroad" | "utility";
  price: number;
  baseRent: number;
  rentByLevel: number[];
  upgradeCosts: number[];
}

export type BoardTile = BasicBoardTile | TaxTile | OwnableBoardTile;

export interface PropertyState {
  id: string;
  boardIndex: number;
  name: string;
  type: OwnableTileType;
  colorGroup: PropertyColorGroup | "railroad" | "utility";
  price: number;
  baseRent: number;
  rentByLevel: number[];
  upgradeCosts: number[];
  ownerId: string | null;
  upgradeLevel: number;
  shield: boolean;
}

export interface PlayerState {
  id: string;
  socketId: string;
  name: string;
  color: string;
  position: number;
  balance: number;
  hasRolledThisTurn: boolean;
  doublesCount: number;
  inJail: boolean;
  jailTurns: number;
  hasJailCard: boolean;
  isBankrupt: boolean;
  properties: string[];
  wins: number;
  lifetimeProfit: number;
}

export interface GameEvent {
  id: string;
  createdAt: number;
  message: string;
}

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  offeredPropertyIds: string[];
  requestedPropertyIds: string[];
  offeredMoney: number;
  requestedMoney: number;
  createdAt: number;
}

export interface ActionPrompt {
  playerId: string;
  propertyId: string;
  type: "buy" | "upgrade" | "buyout";
  targetOwnerId?: string;
  rentDue?: number;
}

export interface LeaderboardEntry {
  playerName: string;
  wins: number;
  totalProfit: number;
}

export interface GameState {
  id: string;
  status: GameStatus;
  startedAt: number | null;
  turn: number;
  currentTurnPlayerId: string | null;
  players: PlayerState[];
  properties: Record<string, PropertyState>;
  latestEvent: GameEvent | null;
  history: GameEvent[];
  freeParkingPot: number;
  pendingTrade: TradeOffer | null;
  actionPrompt: ActionPrompt | null;
  lastDiceRoll: [number, number] | null;
  canEndTurn: boolean;
  winnerId: string | null;
  leaderboard: {
    byWins: LeaderboardEntry[];
    byProfit: LeaderboardEntry[];
  };
}

export interface PublicGameState extends GameState {}

export const PLAYER_COLORS = [
  "#f97316",
  "#22c55e",
  "#38bdf8",
  "#f43f5e",
  "#a78bfa",
  "#f59e0b",
] as const;

export interface DiceRollResult {
  dice: [number, number];
  total: number;
  isDouble: boolean;
}
