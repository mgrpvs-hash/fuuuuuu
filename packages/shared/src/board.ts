export type CellType =
  | "start"
  | "property"
  | "chance"
  | "tax"
  | "railroad"
  | "utility"
  | "jail"
  | "free_parking"
  | "go_to_jail";

export type ColorGroup =
  | "brown"
  | "lightBlue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "darkBlue";

export interface BoardCellDefinition {
  id: number;
  type: CellType;
  name: string;
  displayName: string;
  colorGroup?: ColorGroup;
  basePrice?: number;
  baseAmount?: number;
}

export const colorGroupHex: Record<ColorGroup, string> = {
  brown: "#8B5A2B",
  lightBlue: "#38BDF8",
  pink: "#EC4899",
  orange: "#F97316",
  red: "#EF4444",
  yellow: "#FACC15",
  green: "#22C55E",
  darkBlue: "#2563EB"
};

export const boardPath: BoardCellDefinition[] = [
  { id: 0, type: "start", name: "START", displayName: "Старт" },
  { id: 1, type: "property", name: "Old Harbor", displayName: "Старый порт", colorGroup: "brown", basePrice: 60 },
  { id: 2, type: "chance", name: "Chance", displayName: "Шанс" },
  { id: 3, type: "property", name: "Stone Market", displayName: "Каменный рынок", colorGroup: "brown", basePrice: 80 },
  { id: 4, type: "tax", name: "City Tax", displayName: "Городской налог", baseAmount: 200 },
  { id: 5, type: "railroad", name: "Central Station", displayName: "Центральный вокзал", basePrice: 200 },
  { id: 6, type: "property", name: "Sky Lane", displayName: "Небесная улица", colorGroup: "lightBlue", basePrice: 100 },
  { id: 7, type: "chance", name: "Chance", displayName: "Шанс" },
  { id: 8, type: "property", name: "Cloud Avenue", displayName: "Облачный проспект", colorGroup: "lightBlue", basePrice: 120 },
  { id: 9, type: "property", name: "Crystal Street", displayName: "Хрустальная улица", colorGroup: "lightBlue", basePrice: 140 },
  { id: 10, type: "jail", name: "Jail", displayName: "Тюрьма" },
  { id: 11, type: "property", name: "Rose District", displayName: "Розовый район", colorGroup: "pink", basePrice: 140 },
  { id: 12, type: "utility", name: "Power Plant", displayName: "Электростанция", basePrice: 150 },
  { id: 13, type: "property", name: "Pearl Plaza", displayName: "Жемчужная площадь", colorGroup: "pink", basePrice: 160 },
  { id: 14, type: "property", name: "Violet Square", displayName: "Фиолетовый сквер", colorGroup: "pink", basePrice: 180 },
  { id: 15, type: "railroad", name: "West Station", displayName: "Западный вокзал", basePrice: 200 },
  { id: 16, type: "property", name: "Amber Street", displayName: "Янтарная улица", colorGroup: "orange", basePrice: 180 },
  { id: 17, type: "chance", name: "Chance", displayName: "Шанс" },
  { id: 18, type: "property", name: "Sunset Boulevard", displayName: "Закатный бульвар", colorGroup: "orange", basePrice: 200 },
  { id: 19, type: "property", name: "Orange Garden", displayName: "Апельсиновый сад", colorGroup: "orange", basePrice: 220 },
  { id: 20, type: "free_parking", name: "Free Parking", displayName: "Бесплатная парковка" },
  { id: 21, type: "property", name: "Crimson Mile", displayName: "Багровая миля", colorGroup: "red", basePrice: 220 },
  { id: 22, type: "chance", name: "Chance", displayName: "Шанс" },
  { id: 23, type: "property", name: "Ruby Avenue", displayName: "Рубиновый проспект", colorGroup: "red", basePrice: 240 },
  { id: 24, type: "property", name: "Scarlet Plaza", displayName: "Алая площадь", colorGroup: "red", basePrice: 260 },
  { id: 25, type: "railroad", name: "North Station", displayName: "Северный вокзал", basePrice: 200 },
  { id: 26, type: "property", name: "Golden Arcade", displayName: "Золотая аркада", colorGroup: "yellow", basePrice: 260 },
  { id: 27, type: "property", name: "Crown Street", displayName: "Коронная улица", colorGroup: "yellow", basePrice: 280 },
  { id: 28, type: "utility", name: "Water Works", displayName: "Водоканал", basePrice: 150 },
  { id: 29, type: "property", name: "Royal Promenade", displayName: "Королевская набережная", colorGroup: "yellow", basePrice: 300 },
  { id: 30, type: "go_to_jail", name: "Go To Jail", displayName: "В тюрьму" },
  { id: 31, type: "property", name: "Emerald Avenue", displayName: "Изумрудный проспект", colorGroup: "green", basePrice: 300 },
  { id: 32, type: "property", name: "Pine Heights", displayName: "Сосновые высоты", colorGroup: "green", basePrice: 320 },
  { id: 33, type: "chance", name: "Chance", displayName: "Шанс" },
  { id: 34, type: "property", name: "Forest Gate", displayName: "Лесные ворота", colorGroup: "green", basePrice: 350 },
  { id: 35, type: "railroad", name: "East Station", displayName: "Восточный вокзал", basePrice: 200 },
  { id: 36, type: "chance", name: "Chance", displayName: "Шанс" },
  { id: 37, type: "property", name: "Royal Bay", displayName: "Королевская бухта", colorGroup: "darkBlue", basePrice: 400 },
  { id: 38, type: "tax", name: "Luxury Tax", displayName: "Налог на роскошь", baseAmount: 300 },
  { id: 39, type: "property", name: "Diamond Coast", displayName: "Алмазный берег", colorGroup: "darkBlue", basePrice: 450 }
];

export const cornerCellIds = {
  start: 0,
  jail: 10,
  freeParking: 20,
  goToJail: 30
} as const;
