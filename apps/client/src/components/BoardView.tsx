import { motion } from "framer-motion";
import { boardPath, getBoardCoordinates, type GameState, type PropertyColorGroup } from "@monopoly/shared";

type Props = {
  game: GameState;
};

const colorGroupClass: Record<PropertyColorGroup, string> = {
  brown: "bg-amber-800",
  lightBlue: "bg-sky-400",
  pink: "bg-pink-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  darkBlue: "bg-blue-700",
};

const tileByCoordinate = new Map(
  boardPath.map((tile) => {
    const point = getBoardCoordinates(tile.index);
    return [`${point.row}:${point.col}`, tile] as const;
  }),
);

const tileTypeLabel: Record<string, string> = {
  start: "START",
  jail: "JAIL",
  free_parking: "FREE",
  go_to_jail: "GO JAIL",
  chance: "CARD",
  tax: "TAX",
  railroad: "RR",
  utility: "UTIL",
  property: "PROP",
};

export function BoardView({ game }: Props) {
  return (
    <div className="rounded-2xl border border-emerald-700/70 bg-emerald-950/60 p-2 shadow-[0_0_0_1px_rgba(250,204,21,0.08)]">
      <div className="grid grid-cols-[repeat(11,minmax(0,1fr))] gap-1">
        {Array.from({ length: 11 * 11 }).map((_, idx) => {
          const row = Math.floor(idx / 11);
          const col = idx % 11;
          const tile = tileByCoordinate.get(`${row}:${col}`);

          if (!tile) {
            return (
              <div
                key={`${row}-${col}`}
                className="aspect-square rounded-md bg-emerald-950/30"
              />
            );
          }

          const property = game.properties[String(tile.index)];
          const owner = property?.ownerId
            ? game.players.find((player) => player.id === property.ownerId)
            : undefined;
          const playersOnTile = game.players.filter(
            (player) => !player.isBankrupt && player.position === tile.index,
          );

          return (
            <div
              key={`${row}-${col}`}
              className="relative aspect-square overflow-hidden rounded-md border border-emerald-700/70 bg-emerald-900/70 p-1 text-[9px] leading-tight sm:text-[10px]"
            >
              {"colorGroup" in tile && tile.colorGroup in colorGroupClass ? (
                <div
                  className={`mb-0.5 h-1 w-full rounded-sm ${colorGroupClass[tile.colorGroup as PropertyColorGroup]}`}
                />
              ) : null}
              <div className="line-clamp-2 font-semibold text-amber-200">{tileTypeLabel[tile.type]}</div>
              <div className="line-clamp-2 text-emerald-100/90">{tile.name}</div>
              {"price" in tile ? (
                <div className="text-[9px] text-amber-100/80">${tile.price}</div>
              ) : null}
              {property && property.upgradeLevel > 0 ? (
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {Array.from({ length: property.upgradeLevel }).map((_, level) => (
                    <div
                      key={`${property.id}-${level}`}
                      className="h-1.5 w-1.5 rounded-[2px]"
                      style={{ backgroundColor: owner?.color ?? "#facc15" }}
                    />
                  ))}
                </div>
              ) : null}
              {property?.shield ? (
                <div className="absolute right-0.5 top-0.5 rounded bg-cyan-400/90 px-0.5 text-[8px] font-semibold text-black">
                  SH
                </div>
              ) : null}
              <div className="absolute bottom-0.5 left-0.5 flex flex-wrap gap-0.5">
                {playersOnTile.map((player) => (
                  <motion.div
                    key={player.id}
                    layout
                    transition={{ type: "spring", stiffness: 300, damping: 24 }}
                    className="h-2.5 w-2.5 rounded-full border border-white/80"
                    style={{ backgroundColor: player.color }}
                    title={player.name}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
