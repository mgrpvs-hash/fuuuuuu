import type { GameState } from "@monopoly/shared";
import { playerColorHex } from "@/theme";

interface PlayersPanelProps {
  game: GameState;
  meId: string;
  onOpenTrade: () => void;
}

export function PlayersPanel({ game, meId, onOpenTrade }: PlayersPanelProps) {
  return (
    <div className="glass-panel rounded-card border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-emerald-300">Игроки</div>
        <button
          className="rounded-lg border border-borderSoft bg-panel px-2 py-1 text-xs text-emerald-100"
          onClick={onOpenTrade}
        >
          Обмены
        </button>
      </div>
      <div className="space-y-2">
        {game.players.map((player) => {
          const isCurrent = player.id === game.currentTurnPlayerId;
          const isMe = player.id === meId;
          return (
            <div
              key={player.id}
              className={`rounded-xl border p-2 ${isCurrent ? "border-gold bg-gold/10" : "border-borderSoft bg-panel/75"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className="h-7 w-7 rounded-full border border-black/35"
                    style={{ backgroundColor: playerColorHex[player.color] }}
                  />
                  <div>
                    <div className="text-sm font-semibold text-emerald-100">
                      {player.name} {isMe && <span className="text-xs text-gold">(Вы)</span>}
                    </div>
                    <div className="text-[11px] text-emerald-300">🪙 {player.balance}</div>
                  </div>
                </div>
                <div className="text-right text-[11px] text-emerald-300">
                  <div>Улиц: {player.properties.length}</div>
                  <div>{player.isBankrupt ? "Банкрот" : player.debtMode ? "Debt mode" : "Активен"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
