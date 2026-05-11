import { boardPath } from "./board";
import type { BoardCellState, RuntimePlayer } from "./types";

export const BASE_ENTRY_FEE = 1000;
export const MAX_ROUNDS = 30;

const rentMultipliersByLevel = [0.15, 0.35, 0.7, 1.2, 1.8, 2.7];
const upgradeMultipliersByTargetLevel = [0.5, 0.8, 1.2, 1.8, 2.5];

export const buildInitialCells = (): BoardCellState[] =>
  boardPath.map((cell) => ({
    ...cell,
    ownerId: null,
    upgradeLevel: 0,
    shield: false,
    frozenTurns: 0
  }));

export const entryMultiplier = (entryFee: number): number => entryFee / BASE_ENTRY_FEE;

export const scaledPrice = (basePrice: number | undefined, entryFee: number): number => {
  if (!basePrice) {
    return 0;
  }

  return Math.round(basePrice * entryMultiplier(entryFee));
};

export const scaledTax = (baseAmount: number | undefined, entryFee: number): number => {
  if (!baseAmount) {
    return 0;
  }
  return Math.round(baseAmount * entryMultiplier(entryFee));
};

export const getPropertyPrice = (cellId: number, entryFee: number): number => {
  const cell = boardPath[cellId];
  return scaledPrice(cell.basePrice, entryFee);
};

export const getRentAmount = (
  cell: BoardCellState,
  entryFee: number,
  ownerOwnsFullGroup: boolean,
  tenantHasDiscount = false
): number => {
  if (!cell.basePrice) {
    return 0;
  }

  const base = scaledPrice(cell.basePrice, entryFee);
  let rent = Math.round(base * rentMultipliersByLevel[cell.upgradeLevel] * (ownerOwnsFullGroup ? 2 : 1));
  if (tenantHasDiscount) {
    rent = Math.max(0, Math.round(rent * 0.5));
  }
  return rent;
};

export const getUpgradeCost = (cell: BoardCellState, entryFee: number): number => {
  if (!cell.basePrice || cell.upgradeLevel >= 5) {
    return 0;
  }
  const nextLevel = cell.upgradeLevel;
  const base = scaledPrice(cell.basePrice, entryFee);
  return Math.round(base * upgradeMultipliersByTargetLevel[nextLevel]);
};

export const getTotalUpgradeSpent = (cell: BoardCellState, entryFee: number): number => {
  if (!cell.basePrice || cell.upgradeLevel === 0) {
    return 0;
  }
  const base = scaledPrice(cell.basePrice, entryFee);
  let sum = 0;
  for (let lvl = 0; lvl < cell.upgradeLevel; lvl += 1) {
    sum += Math.round(base * upgradeMultipliersByTargetLevel[lvl]);
  }
  return sum;
};

export const getBuyoutPrice = (cell: BoardCellState, entryFee: number): number => {
  if (!cell.basePrice) {
    return 0;
  }
  const price = scaledPrice(cell.basePrice, entryFee);
  const upgrades = getTotalUpgradeSpent(cell, entryFee);
  return Math.round(price + upgrades * 1.7 + price * 0.5);
};

export const getSellPrice = (cell: BoardCellState, entryFee: number): number => {
  if (!cell.basePrice) {
    return 0;
  }
  const price = scaledPrice(cell.basePrice, entryFee);
  const upgrades = getTotalUpgradeSpent(cell, entryFee);
  return Math.round(price * 0.5 + upgrades * 0.5);
};

export const jailPenalty = (entryFee: number): number => Math.max(100, Math.round(entryFee * 0.1));

export const hasFullColorGroup = (ownerId: string, cell: BoardCellState, cells: BoardCellState[]): boolean => {
  if (!cell.colorGroup) {
    return false;
  }
  const groupCells = cells.filter((c) => c.colorGroup === cell.colorGroup);
  return groupCells.every((c) => c.ownerId === ownerId);
};

export const alivePlayers = (players: RuntimePlayer[]): RuntimePlayer[] => players.filter((p) => !p.bankrupt);
