import type {
  BoardTile,
  OwnableBoardTile,
  OwnableTileType,
  PropertyColorGroup,
  PropertyState,
} from "./types";

const ownable = (
  index: number,
  name: string,
  type: OwnableTileType,
  colorGroup: PropertyColorGroup | "railroad" | "utility",
  price: number,
  baseRent: number,
  rentByLevel: number[],
  upgradeCosts: number[],
): OwnableBoardTile => ({
  index,
  name,
  type,
  colorGroup,
  price,
  baseRent,
  rentByLevel,
  upgradeCosts,
});

export const BOARD_SIZE = 11;
export const BOARD_PATH_LENGTH = 40;

export const boardPath: BoardTile[] = [
  { index: 0, type: "start", name: "START" },
  ownable(1, "Mediterranean Avenue", "property", "brown", 60, 8, [8, 16, 32, 64, 96, 144], [50, 50, 100, 150, 200]),
  { index: 2, type: "chance", name: "Chance" },
  ownable(3, "Baltic Avenue", "property", "brown", 100, 12, [12, 24, 48, 96, 144, 220], [50, 50, 100, 150, 200]),
  { index: 4, type: "tax", name: "Income Tax", amount: 200 },
  ownable(5, "Reading Railroad", "railroad", "railroad", 200, 25, [25, 50, 100, 200, 300, 400], [100, 150, 200, 250, 300]),
  ownable(6, "Oriental Avenue", "property", "lightBlue", 100, 14, [14, 28, 56, 96, 150, 230], [50, 50, 100, 150, 200]),
  { index: 7, type: "chance", name: "Chance" },
  ownable(8, "Vermont Avenue", "property", "lightBlue", 120, 16, [16, 32, 64, 112, 168, 260], [50, 50, 100, 150, 200]),
  ownable(9, "Connecticut Avenue", "property", "lightBlue", 140, 18, [18, 36, 72, 126, 190, 290], [50, 50, 100, 150, 200]),
  { index: 10, type: "jail", name: "JAIL" },
  ownable(11, "St. Charles Place", "property", "pink", 140, 20, [20, 40, 80, 140, 210, 320], [100, 100, 150, 200, 250]),
  ownable(12, "Electric Company", "utility", "utility", 150, 20, [20, 40, 80, 120, 180, 260], [100, 100, 150, 200, 250]),
  ownable(13, "States Avenue", "property", "pink", 160, 22, [22, 44, 88, 154, 230, 350], [100, 100, 150, 200, 250]),
  ownable(14, "Virginia Avenue", "property", "pink", 180, 24, [24, 48, 96, 168, 250, 380], [100, 100, 150, 200, 250]),
  ownable(15, "Pennsylvania Railroad", "railroad", "railroad", 200, 25, [25, 50, 100, 200, 300, 400], [100, 150, 200, 250, 300]),
  ownable(16, "St. James Place", "property", "orange", 180, 26, [26, 52, 104, 182, 270, 410], [100, 100, 150, 200, 250]),
  { index: 17, type: "chance", name: "Chance" },
  ownable(18, "Tennessee Avenue", "property", "orange", 200, 28, [28, 56, 112, 196, 290, 440], [100, 100, 150, 200, 250]),
  ownable(19, "New York Avenue", "property", "orange", 220, 30, [30, 60, 120, 210, 310, 470], [100, 100, 150, 200, 250]),
  { index: 20, type: "free_parking", name: "FREE PARKING" },
  ownable(21, "Kentucky Avenue", "property", "red", 220, 32, [32, 64, 128, 224, 330, 500], [150, 150, 200, 250, 300]),
  { index: 22, type: "chance", name: "Chance" },
  ownable(23, "Indiana Avenue", "property", "red", 240, 34, [34, 68, 136, 238, 350, 530], [150, 150, 200, 250, 300]),
  ownable(24, "Illinois Avenue", "property", "red", 260, 36, [36, 72, 144, 252, 370, 560], [150, 150, 200, 250, 300]),
  ownable(25, "B&O Railroad", "railroad", "railroad", 200, 25, [25, 50, 100, 200, 300, 400], [100, 150, 200, 250, 300]),
  ownable(26, "Atlantic Avenue", "property", "yellow", 260, 38, [38, 76, 152, 266, 390, 590], [150, 150, 200, 250, 300]),
  ownable(27, "Ventnor Avenue", "property", "yellow", 280, 40, [40, 80, 160, 280, 410, 620], [150, 150, 200, 250, 300]),
  ownable(28, "Water Works", "utility", "utility", 150, 22, [22, 44, 88, 132, 198, 286], [100, 100, 150, 200, 250]),
  ownable(29, "Marvin Gardens", "property", "yellow", 300, 42, [42, 84, 168, 294, 430, 650], [150, 150, 200, 250, 300]),
  { index: 30, type: "go_to_jail", name: "GO TO JAIL" },
  ownable(31, "Pacific Avenue", "property", "green", 300, 44, [44, 88, 176, 308, 450, 680], [200, 200, 250, 300, 350]),
  ownable(32, "North Carolina Avenue", "property", "green", 320, 46, [46, 92, 184, 322, 470, 710], [200, 200, 250, 300, 350]),
  { index: 33, type: "chance", name: "Chance" },
  ownable(34, "Pennsylvania Avenue", "property", "green", 350, 50, [50, 100, 200, 350, 510, 760], [200, 200, 250, 300, 350]),
  ownable(35, "Short Line Railroad", "railroad", "railroad", 200, 25, [25, 50, 100, 200, 300, 400], [100, 150, 200, 250, 300]),
  { index: 36, type: "chance", name: "Chance" },
  ownable(37, "Park Place", "property", "darkBlue", 400, 55, [55, 110, 220, 385, 560, 840], [250, 250, 300, 350, 400]),
  { index: 38, type: "tax", name: "Luxury Tax", amount: 100 },
  ownable(39, "Boardwalk", "property", "darkBlue", 450, 65, [65, 130, 260, 455, 660, 1000], [250, 250, 300, 350, 400]),
];

export const isOwnableTile = (tile: BoardTile): tile is OwnableBoardTile =>
  tile.type === "property" || tile.type === "railroad" || tile.type === "utility";

export const createInitialProperties = (): Record<string, PropertyState> => {
  const entries = boardPath
    .filter(isOwnableTile)
    .map((tile) => [
      String(tile.index),
      {
        id: String(tile.index),
        boardIndex: tile.index,
        name: tile.name,
        type: tile.type,
        colorGroup: tile.colorGroup,
        price: tile.price,
        baseRent: tile.baseRent,
        rentByLevel: tile.rentByLevel,
        upgradeCosts: tile.upgradeCosts,
        ownerId: null,
        upgradeLevel: 0,
        shield: false,
      } satisfies PropertyState,
    ]);

  return Object.fromEntries(entries);
};

export const calculateRent = (property: PropertyState, entryFeeMultiplier = 1): number => {
  const levelRent = property.rentByLevel[property.upgradeLevel] ?? property.baseRent;
  return Math.round(levelRent * entryFeeMultiplier);
};

export const getBoardCoordinates = (index: number): { row: number; col: number } => {
  if (index < 0 || index > 39) {
    throw new Error(`Invalid board index ${index}`);
  }

  if (index <= 10) {
    return { row: 10, col: 10 - index };
  }

  if (index <= 20) {
    return { row: 20 - index, col: 0 };
  }

  if (index <= 30) {
    return { row: 0, col: index - 20 };
  }

  return { row: index - 30, col: 10 };
};
