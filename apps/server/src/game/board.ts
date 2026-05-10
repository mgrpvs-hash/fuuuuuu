import { BoardCell, PropertyState, PropertyColor } from "./types";

interface PropertyBlueprint {
  id: string;
  name: string;
  color: PropertyColor;
  position: number;
  price: number;
  rent: number;
}

const PROPERTY_BLUEPRINTS: PropertyBlueprint[] = [
  { id: "p1", name: "Emerald Alley", color: "green", position: 1, price: 220, rent: 40 },
  { id: "p2", name: "Ivy Boulevard", color: "green", position: 3, price: 280, rent: 55 },
  { id: "p3", name: "Royal Bay", color: "blue", position: 6, price: 350, rent: 70 },
  { id: "p4", name: "Azure Heights", color: "blue", position: 8, price: 420, rent: 84 },
  { id: "p5", name: "Crimson Mile", color: "red", position: 11, price: 520, rent: 110 },
  { id: "p6", name: "Ruby Square", color: "red", position: 13, price: 620, rent: 124 },
  { id: "p7", name: "Sunrise Vista", color: "yellow", position: 16, price: 760, rent: 150 },
  { id: "p8", name: "Golden Arcade", color: "yellow", position: 18, price: 840, rent: 168 },
  { id: "p9", name: "Capital Crescent", color: "green", position: 21, price: 960, rent: 200 },
  { id: "p10", name: "Imperial Gardens", color: "blue", position: 23, price: 1200, rent: 240 }
];

const SCALE_MIN = 0.5;

const roundScaled = (value: number, multiplier: number) =>
  Math.max(10, Math.round(value * Math.max(SCALE_MIN, multiplier)));

export const upgradeCost = (basePrice: number, nextLevel: number) =>
  Math.max(20, Math.round(basePrice * (0.4 + nextLevel * 0.16)));

export const calculateRent = (
  property: PropertyState,
  ownerHoldsColorSet: boolean
): number => {
  const levelMultiplier = 1 + property.level * 0.5;
  const setMultiplier = ownerHoldsColorSet ? 2 : 1;
  return Math.round(property.baseRent * levelMultiplier * setMultiplier);
};

export const getUpgradeTitle = (level: number): string => {
  switch (level) {
    case 0:
      return "Пусто";
    case 1:
      return "Дом";
    case 2:
      return "Большой дом";
    case 3:
      return "Отель";
    case 4:
      return "Luxury";
    case 5:
      return "Palace 👑";
    default:
      return "Неизвестно";
  }
};

export const createBoard = (multiplier: number): { cells: BoardCell[]; properties: PropertyState[] } => {
  const propertyMap = new Map<string, PropertyState>();

  for (const blueprint of PROPERTY_BLUEPRINTS) {
    propertyMap.set(blueprint.id, {
      id: blueprint.id,
      name: blueprint.name,
      color: blueprint.color,
      basePrice: roundScaled(blueprint.price, multiplier),
      baseRent: roundScaled(blueprint.rent, multiplier),
      level: 0,
      shield: false,
      position: blueprint.position
    });
  }

  const cells: BoardCell[] = [
    { id: "c0", type: "start", label: "START", position: 0 },
    { id: "c1", type: "property", label: "Emerald Alley", position: 1, propertyId: "p1" },
    { id: "c2", type: "chance", label: "Карта", position: 2 },
    { id: "c3", type: "property", label: "Ivy Boulevard", position: 3, propertyId: "p2" },
    { id: "c4", type: "tax", label: "Налог", position: 4, amount: roundScaled(120, multiplier) },
    { id: "c5", type: "jail", label: "Тюрьма", position: 5 },
    { id: "c6", type: "property", label: "Royal Bay", position: 6, propertyId: "p3" },
    { id: "c7", type: "chance", label: "Карта", position: 7 },
    { id: "c8", type: "property", label: "Azure Heights", position: 8, propertyId: "p4" },
    { id: "c9", type: "free", label: "Free Parking", position: 9 },
    { id: "c10", type: "go_to_jail", label: "В Тюрьму", position: 10 },
    { id: "c11", type: "property", label: "Crimson Mile", position: 11, propertyId: "p5" },
    { id: "c12", type: "chance", label: "Карта", position: 12 },
    { id: "c13", type: "property", label: "Ruby Square", position: 13, propertyId: "p6" },
    { id: "c14", type: "tax", label: "Luxury Tax", position: 14, amount: roundScaled(200, multiplier) },
    { id: "c15", type: "free", label: "Бизнес-ланч", position: 15 },
    { id: "c16", type: "property", label: "Sunrise Vista", position: 16, propertyId: "p7" },
    { id: "c17", type: "chance", label: "Карта", position: 17 },
    { id: "c18", type: "property", label: "Golden Arcade", position: 18, propertyId: "p8" },
    { id: "c19", type: "tax", label: "Комиссия банка", position: 19, amount: roundScaled(260, multiplier) },
    { id: "c20", type: "free", label: "Премия", position: 20 },
    { id: "c21", type: "property", label: "Capital Crescent", position: 21, propertyId: "p9" },
    { id: "c22", type: "chance", label: "Карта", position: 22 },
    { id: "c23", type: "property", label: "Imperial Gardens", position: 23, propertyId: "p10" }
  ];

  return {
    cells,
    properties: Array.from(propertyMap.values())
  };
};
