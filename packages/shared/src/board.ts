import { BoardCell } from "./types.js";

export const BASE_ENTRY_FEE = 1000;
export const START_BONUS = 220;
export const JAIL_FINE = 180;

export const BOARD_CELLS: BoardCell[] = [
  { index: 0, type: "start", name: "START" },
  { index: 1, type: "property", name: "Emerald Alley", group: "green", price: 120, baseRent: 18 },
  { index: 2, type: "chance", name: "Chance" },
  { index: 3, type: "property", name: "Sunset Walk", group: "orange", price: 140, baseRent: 22 },
  { index: 4, type: "tax", name: "Royal Tax", tax: 110 },
  { index: 5, type: "property", name: "Azure Street", group: "blue", price: 180, baseRent: 28 },
  { index: 6, type: "chance", name: "Chance" },
  { index: 7, type: "property", name: "Ruby Avenue", group: "red", price: 210, baseRent: 36 },
  { index: 8, type: "property", name: "Lavender Gate", group: "purple", price: 230, baseRent: 40 },
  { index: 9, type: "tax", name: "City Tax", tax: 160 },
  { index: 10, type: "jail", name: "JAIL" },
  { index: 11, type: "property", name: "Cedar Row", group: "green", price: 250, baseRent: 46 },
  { index: 12, type: "chance", name: "Chance" },
  { index: 13, type: "property", name: "Golden Mile", group: "yellow", price: 280, baseRent: 50 },
  { index: 14, type: "property", name: "Oak District", group: "brown", price: 300, baseRent: 56 },
  { index: 15, type: "tax", name: "Luxury Tax", tax: 220 },
  { index: 16, type: "property", name: "Crystal Court", group: "blue", price: 330, baseRent: 60 },
  { index: 17, type: "chance", name: "Chance" },
  { index: 18, type: "property", name: "Coral Heights", group: "red", price: 360, baseRent: 68 },
  { index: 19, type: "property", name: "Maple Rise", group: "orange", price: 390, baseRent: 74 },
  { index: 20, type: "free_parking", name: "FREE PARKING" },
  { index: 21, type: "property", name: "Pearl Harbor", group: "white", price: 420, baseRent: 80 },
  { index: 22, type: "chance", name: "Chance" },
  { index: 23, type: "property", name: "Silver Lane", group: "gray", price: 450, baseRent: 86 },
  { index: 24, type: "tax", name: "Crown Tax", tax: 270 },
  { index: 25, type: "property", name: "Topaz Harbor", group: "teal", price: 480, baseRent: 94 },
  { index: 26, type: "chance", name: "Chance" },
  { index: 27, type: "property", name: "Ivory Crescent", group: "yellow", price: 510, baseRent: 102 },
  { index: 28, type: "property", name: "Scarlet Plaza", group: "red", price: 550, baseRent: 112 },
  { index: 29, type: "property", name: "Jade Boulevard", group: "green", price: 590, baseRent: 120 },
  { index: 30, type: "go_to_jail", name: "GO TO JAIL" },
  { index: 31, type: "property", name: "Nimbus Quay", group: "blue", price: 620, baseRent: 130 },
  { index: 32, type: "chance", name: "Chance" },
  { index: 33, type: "property", name: "Rose District", group: "purple", price: 650, baseRent: 138 },
  { index: 34, type: "property", name: "Onyx Port", group: "black", price: 700, baseRent: 148 },
  { index: 35, type: "tax", name: "Imperial Tax", tax: 320 },
  { index: 36, type: "property", name: "Amber Heights", group: "orange", price: 760, baseRent: 162 },
  { index: 37, type: "chance", name: "Chance" },
  { index: 38, type: "property", name: "Royal Marina", group: "gold", price: 820, baseRent: 178 },
  { index: 39, type: "property", name: "King's Square", group: "gold", price: 900, baseRent: 196 }
];

export const UPGRADE_LEVEL_NAMES = [
  "Empty",
  "Small House",
  "Big House",
  "Hotel",
  "Luxury Hotel",
  "Royal Palace"
] as const;

export function scaleByEntry(baseValue: number, economyMultiplier: number): number {
  return Math.max(10, Math.round(baseValue * economyMultiplier));
}

export function getUpgradeCost(price: number, targetLevel: number): number {
  const multipliers = [0, 0.35, 0.55, 0.8, 1.05, 1.35];
  return Math.round(price * multipliers[targetLevel]);
}

export function getRent(baseRent: number, level: number): number {
  const levelMultiplier = [1, 1.4, 2, 2.8, 3.9, 5.4][level] ?? 1;
  return Math.round(baseRent * levelMultiplier);
}

export function getBuyoutPrice(price: number, totalUpgradeSpent: number): number {
  return Math.round(price + totalUpgradeSpent * 1.7 + price * 0.5);
}

export function getSellPrice(price: number, totalUpgradeSpent: number): number {
  return Math.round(price * 0.5 + totalUpgradeSpent * 0.5);
}
