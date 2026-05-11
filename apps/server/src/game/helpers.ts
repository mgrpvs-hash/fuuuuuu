import { BOARD_CELLS, getRent, getUpgradeCost, scaleByEntry } from "@monopoly/shared";
import { GameState, PlayerState, PropertyState } from "@monopoly/shared";

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function createProperties(economyMultiplier: number): PropertyState[] {
  return BOARD_CELLS.filter((cell) => cell.type === "property").map((cell) => ({
    cellIndex: cell.index,
    ownerId: null,
    level: 0,
    shielded: false,
    totalUpgradeSpent: 0,
    frozenTurns: 0,
    scaledPrice: scaleByEntry(cell.price ?? 0, economyMultiplier),
    scaledBaseRent: scaleByEntry(cell.baseRent ?? 0, economyMultiplier)
  })) as PropertyState[];
}

export function getPropertyState(game: GameState, cellIndex: number): PropertyState | undefined {
  return game.properties.find((property) => property.cellIndex === cellIndex);
}

export function getPlayer(game: GameState, playerId: string): PlayerState | undefined {
  return game.players.find((player) => player.id === playerId);
}

export function getNextActivePlayerIndex(game: GameState, fromIndex: number): number {
  let index = fromIndex;
  for (let i = 0; i < game.players.length; i += 1) {
    index = (index + 1) % game.players.length;
    if (!game.players[index]?.isBankrupt) {
      return index;
    }
  }
  return fromIndex;
}

export function calculateRent(property: PropertyState): number {
  return getRent(property.scaledBaseRent, property.level);
}

export function calculateUpgradeCost(property: PropertyState, nextLevel: number): number {
  return getUpgradeCost(property.scaledPrice, nextLevel);
}

export function createHistoryEntry(message: string): string {
  const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `[${time}] ${message}`;
}
