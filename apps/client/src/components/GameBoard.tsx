import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { History, Sparkles } from "lucide-react";
import type { GameState } from "@monopoly/shared";
import { getCellPosition } from "@/boardLayout";
import { playerColorHex } from "@/theme";
import { BoardCell } from "./BoardCell";

interface GameBoardProps {
  game: GameState;
  meId: string;
  onRollDice: () => void;
  onDrawCard: () => void;
  onOpenHistory: () => void;
  onEndTurn: () => void;
}

function Dice({ value }: { value: number }) {
  return (
    <motion.div
      className="flex h-12 w-12 items-center justify-center rounded-2xl border border-gold/40 bg-gradient-to-b from-emerald-50 to-emerald-200 text-2xl font-black text-slate-900 shadow-lg"
      initial={{ rotate: 0, scale: 1 }}
      animate={{ rotate: [0, -12, 12, 0], scale: [1, 1.05, 1] }}
      transition={{ duration: 0.45 }}
    >
      {value}
    </motion.div>
  );
}

export function GameBoard({
  game,
  meId,
  onRollDice,
  onDrawCard,
  onOpenHistory,
  onEndTurn
}: GameBoardProps) {
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, number>>(() =>
    Object.fromEntries(game.players.map((player) => [player.id, player.position]))
  );

  const playersById = useMemo(() => {
    return Object.fromEntries(game.players.map((player) => [player.id, player]));
  }, [game.players]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (!game.lastMove) {
      setAnimatedPositions(Object.fromEntries(game.players.map((player) => [player.id, player.position])));
      return;
    }
    const move = game.lastMove;
    const path: number[] = [];
    for (let step = 1; step <= move.steps; step += 1) {
      path.push((move.from + step) % 40);
    }
    let idx = 0;
    const run = () => {
      const next = path[idx];
      if (typeof next !== "number") {
        setAnimatedPositions((prev) => ({
          ...prev,
          [move.playerId]: move.to
        }));
        return;
      }
      setAnimatedPositions((prev) => ({
        ...prev,
        [move.playerId]: next
      }));
      idx += 1;
      timeout = setTimeout(run, 150);
    };
    run();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [game.lastMove?.playerId, game.lastMove?.from, game.lastMove?.to, game.lastMove?.steps]);

  useEffect(() => {
    setAnimatedPositions((prev) => {
      const next = { ...prev };
      for (const player of game.players) {
        if (next[player.id] === undefined) {
          next[player.id] = player.position;
        }
      }
      return next;
    });
  }, [game.players]);

  const currentPlayer = game.players.find((player) => player.id === game.currentTurnPlayerId);
  const myTurn = currentPlayer?.id === meId;
  const pending = game.pendingAction.type;
  const dice = game.lastMove?.dice ?? [1, 1];
  const shouldRoll = myTurn && pending === "none";
  const shouldDraw = myTurn && pending === "draw_card";

  return (
    <div className="glass-panel rounded-card border p-4 shadow-premium">
      <div className="relative mx-auto aspect-square w-full max-w-[820px]">
        <div
          className="absolute inset-0 rounded-[28px] border border-borderSoft bg-gradient-to-b from-[#1A4A34] to-[#102A1F] shadow-2xl"
          style={{
            transform: "perspective(1000px) rotateX(14deg) rotateZ(-1.2deg)",
            transformOrigin: "center center"
          }}
        >
          {game.board.map((cell) => {
            const pos = getCellPosition(cell.index);
            const property = game.properties.find((item) => item.cellIndex === cell.index);
            const owner = property?.ownerId ? playersById[property.ownerId] : undefined;
            const playersOnCell = game.players.filter(
              (player) => (animatedPositions[player.id] ?? player.position) === cell.index && !player.isBankrupt
            );
            const isCorner = [0, 10, 20, 30].includes(cell.index);
            return (
              <motion.div
                key={cell.index}
                layout
                className="absolute"
                style={{
                  top: `${pos.top}%`,
                  left: `${pos.left}%`,
                  width: isCorner ? "10.5%" : "9.8%",
                  height: isCorner ? "10.5%" : "9.8%"
                }}
              >
                <BoardCell
                  cell={cell}
                  property={property}
                  playersOnCell={playersOnCell}
                  ownerColor={owner ? playerColorHex[owner.color] : undefined}
                />
              </motion.div>
            );
          })}
        </div>

        <div className="pointer-events-none absolute inset-[15%] rounded-3xl border border-borderSoft/60 bg-boardBg/70 shadow-inner" />

        <div className="absolute inset-[18%] flex flex-col items-center justify-center gap-3 rounded-3xl border border-gold/25 bg-panel/85 p-4 text-center">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gold">
            <Sparkles className="h-4 w-4" />
            Monopoly Royale
          </div>
          <div className="text-xs text-emerald-200">
            Раунд {game.round} / {game.maxRounds}
          </div>
          <div className="text-xs text-emerald-100">
            Ход: <span className="font-semibold text-gold">{currentPlayer?.name ?? "—"}</span>
          </div>
          <div className="flex items-center gap-3">
            <Dice value={dice[0]} />
            <Dice value={dice[1]} />
          </div>
          <div className="mt-1 w-full rounded-xl border border-borderSoft bg-black/25 px-3 py-2 text-xs text-emerald-100">
            {game.lastEvent}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              className="rounded-xl bg-gradient-to-r from-green to-gold px-4 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45"
              onClick={onRollDice}
              disabled={!shouldRoll}
            >
              Бросить кубики
            </button>
            <button
              className="rounded-xl border border-gold/50 bg-gold/15 px-3 py-2 text-xs font-semibold text-gold disabled:cursor-not-allowed disabled:opacity-45"
              onClick={onDrawCard}
              disabled={!shouldDraw}
            >
              Вытянуть карту
            </button>
            <button
              className="rounded-xl border border-borderSoft bg-panel px-3 py-2 text-xs"
              onClick={onEndTurn}
              disabled={!myTurn}
            >
              Завершить ход
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-xl border border-borderSoft bg-panel px-3 py-2 text-xs"
              onClick={onOpenHistory}
            >
              <History className="h-3.5 w-3.5" />
              История
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
