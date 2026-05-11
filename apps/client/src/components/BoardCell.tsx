import { Home, Hotel, Landmark, Shield } from "lucide-react";
import type { BoardCell as BoardCellType, PlayerState, PropertyState } from "@monopoly/shared";
import { groupColorHex, playerColorHex } from "@/theme";

interface BoardCellProps {
  cell: BoardCellType;
  property?: PropertyState;
  playersOnCell: PlayerState[];
  ownerColor?: string;
}

function upgradeVisual(level: number) {
  if (level <= 0) return null;
  if (level === 1) return <Home className="h-3.5 w-3.5" />;
  if (level === 2) return <Home className="h-4.5 w-4.5" />;
  if (level === 3) return <Hotel className="h-4.5 w-4.5" />;
  if (level === 4) return <Landmark className="h-4.5 w-4.5 text-gold" />;
  return (
    <span className="text-[11px] font-bold leading-none text-gold">
      👑
    </span>
  );
}

export function BoardCell({ cell, property, playersOnCell, ownerColor }: BoardCellProps) {
  const cellOwned = Boolean(property?.ownerId);
  const stripeColor = cell.group ? groupColorHex[cell.group] ?? "#64748B" : "#1F2937";
  const tokenPlayers = playersOnCell.slice(0, 6);

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border border-borderSoft bg-panel/85 p-1 shadow-lg"
      style={{
        boxShadow: cellOwned && ownerColor ? `0 0 0 2px ${ownerColor}66 inset` : undefined
      }}
    >
      {cell.type === "property" && (
        <div
          className="absolute left-0 right-0 top-0 h-1.5"
          style={{ background: stripeColor }}
        />
      )}

      <div className="flex h-full flex-col pt-1 text-[9px] leading-tight text-emerald-100">
        <span className="font-semibold uppercase tracking-wide">{cell.name}</span>
        <span className="text-[8px] text-emerald-300/80">{cell.type}</span>
        {cell.type === "property" && <span className="text-[8px]">🪙 {cell.price}</span>}
      </div>

      {property && property.ownerId && (
        <div
          className="absolute bottom-1 left-1 rounded-full px-1 text-[8px] font-semibold text-black"
          style={{ background: ownerColor ?? "#4ADE80" }}
        >
          OWNER
        </div>
      )}

      {property && property.level > 0 && (
        <div
          className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md border border-white/20 shadow-md"
          style={{
            background: property.ownerId && ownerColor ? `${ownerColor}CC` : "#1F2937"
          }}
        >
          {upgradeVisual(property.level)}
        </div>
      )}

      {property?.shielded && (
        <div className="absolute right-1 top-1 rounded-full bg-sky-500/20 p-0.5 text-sky-300">
          <Shield className="h-3 w-3" />
        </div>
      )}

      <div className="absolute bottom-0.5 left-0.5 right-0.5 flex flex-wrap gap-0.5">
        {tokenPlayers.map((player) => (
          <div
            key={player.id}
            className="flex h-4 w-4 items-center justify-center rounded-full border border-black/30 text-[8px] font-bold text-black shadow-token"
            style={{ backgroundColor: playerColorHex[player.color] }}
          >
            {player.name.slice(0, 1).toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
}
