import { useMemo, useState } from "react";
import type { LeaderboardEntry } from "@monopoly/shared";

interface LeaderboardScreenProps {
  entries: LeaderboardEntry[];
}

type Mode = "wins" | "profit";

export function LeaderboardScreen({ entries }: LeaderboardScreenProps) {
  const [mode, setMode] = useState<Mode>("wins");

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (mode === "wins") return b.wins - a.wins || b.totalProfit - a.totalProfit;
      return b.totalProfit - a.totalProfit || b.wins - a.wins;
    });
  }, [entries, mode]);

  const top3 = sorted.slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-card border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gold">Лидерборд</h2>
          <div className="flex rounded-xl border border-borderSoft bg-panel p-1 text-xs">
            <button
              className={`rounded-lg px-3 py-1 ${mode === "wins" ? "bg-gold text-black" : ""}`}
              onClick={() => setMode("wins")}
            >
              По победам
            </button>
            <button
              className={`rounded-lg px-3 py-1 ${mode === "profit" ? "bg-gold text-black" : ""}`}
              onClick={() => setMode("profit")}
            >
              По прибыли
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {top3.map((entry, index) => (
            <div key={entry.playerId} className="rounded-xl border border-gold/35 bg-gradient-to-b from-gold/20 to-panel p-3">
              <div className="text-xs text-gold">#{index + 1}</div>
              <div className="mt-1 text-lg font-semibold">{entry.name}</div>
              <div className="mt-2 text-xs text-emerald-100">Победы: {entry.wins}</div>
              <div className="text-xs text-emerald-100">Прибыль: 🪙 {entry.totalProfit}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel rounded-card border p-4">
        <div className="space-y-2">
          {sorted.map((entry, index) => (
            <div key={entry.playerId} className="rounded-xl border border-borderSoft bg-panel/75 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-gold/20 text-center text-sm leading-8 text-gold">#{index + 1}</div>
                  <div>
                    <div className="font-semibold">{entry.name}</div>
                    <div className="text-xs text-emerald-300">Победы: {entry.wins}</div>
                  </div>
                </div>
                <div className="text-right text-sm text-emerald-100">🪙 {entry.totalProfit}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
