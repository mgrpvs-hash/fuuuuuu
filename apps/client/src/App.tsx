import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { GameState, TradeOffer } from "@monopoly/shared";
import { AnimatePresence, motion } from "framer-motion";
import {
  Crown,
  Dice6,
  Flag,
  Handshake,
  History,
  HousePlus,
  Landmark,
  Lock,
  Play,
  RefreshCcw,
  Shield,
  ShoppingCart,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { BoardView } from "./components/BoardView";
import { TradeModal } from "./components/TradeModal";
import { socket } from "./lib/socket";

const PLAYER_ID_KEY = "monopoly_player_id";

type LeaderboardTab = "wins" | "profit";

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${btnBase} border-amber-500/70 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20`}
    >
      {icon}
      {label}
    </button>
  );
}

function formatTrade(trade: TradeOffer, game: GameState): string {
  const from = game.players.find((player) => player.id === trade.fromPlayerId)?.name ?? "Unknown";
  const to = game.players.find((player) => player.id === trade.toPlayerId)?.name ?? "Unknown";
  return `${from} → ${to}`;
}

function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string>(() => localStorage.getItem(PLAYER_ID_KEY) ?? "");
  const [playerName, setPlayerName] = useState("");
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<LeaderboardTab>("wins");

  useEffect(() => {
    const onState = (next: GameState) => {
      setGame(next);
    };
    const onJoined = (payload: { playerId: string }) => {
      setPlayerId(payload.playerId);
      localStorage.setItem(PLAYER_ID_KEY, payload.playerId);
      setError("");
    };
    const onError = (payload: { message: string }) => {
      setError(payload.message);
    };

    socket.on("game:state", onState);
    socket.on("player:joined", onJoined);
    socket.on("game:error", onError);
    socket.emit("leaderboard:refresh");

    return () => {
      socket.off("game:state", onState);
      socket.off("player:joined", onJoined);
      socket.off("game:error", onError);
    };
  }, []);

  const myPlayer = useMemo(
    () => game?.players.find((player) => player.id === playerId),
    [game?.players, playerId],
  );
  const isMyTurn = Boolean(game && myPlayer && game.currentTurnPlayerId === myPlayer.id);
  const myPrompt =
    game?.actionPrompt && game.actionPrompt.playerId === myPlayer?.id ? game.actionPrompt : null;
  const canRoll = Boolean(
    game &&
      myPlayer &&
      game.status === "active" &&
      isMyTurn &&
      !myPlayer.hasRolledThisTurn &&
      !myPrompt,
  );
  const canEndTurn = Boolean(game && myPlayer && isMyTurn && game.canEndTurn);
  const pendingTrade = game?.pendingTrade ?? null;

  const emitAction = (event: string) => {
    if (!myPlayer) return;
    socket.emit(event, { playerId: myPlayer.id });
  };

  const joinGame = () => {
    if (!playerName.trim()) return;
    socket.emit("player:join", { name: playerName.trim() });
  };

  const startGame = () => {
    if (!myPlayer) return;
    socket.emit("game:start", { playerId: myPlayer.id });
  };

  const resetGame = () => {
    if (!myPlayer) return;
    socket.emit("game:reset", { playerId: myPlayer.id });
  };

  if (!game) {
    return <div className="p-6 text-emerald-50">Connecting...</div>;
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#041c14] via-[#022818] to-[#03150f] px-3 py-4 text-emerald-50 sm:px-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-emerald-700/70 bg-emerald-950/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-amber-200">Monopoly Web App</h1>
              <p className="text-sm text-emerald-100/80">
                Multiplayer, серверная логика, классическая доска 11x11
              </p>
            </div>
            {myPlayer ? (
              <div className="rounded-lg border border-emerald-700 bg-emerald-900/50 px-3 py-2 text-sm">
                Игрок: <span style={{ color: myPlayer.color }}>{myPlayer.name}</span>
              </div>
            ) : null}
          </div>

          {!myPlayer ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Твоё имя"
                className="flex-1 rounded-lg border border-emerald-700 bg-emerald-900 px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={joinGame}
                className={`${btnBase} border-emerald-500 bg-emerald-500/20 text-emerald-100`}
              >
                <Play className="h-4 w-4" />
                Присоединиться
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-rose-400/60 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {game.latestEvent ? (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-700 bg-emerald-900/40 px-3 py-2 text-sm">
              <p className="line-clamp-2 text-emerald-100/90">{game.latestEvent.message}</p>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="ml-3 inline-flex items-center gap-1 rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-100"
              >
                <History className="h-3.5 w-3.5" />
                История
              </button>
            </div>
          ) : null}
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <BoardView game={game} />

          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-700/70 bg-emerald-950/70 p-3">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-200">Управление</h2>
              <div className="flex flex-wrap gap-2">
                {game.status === "waiting" ? (
                  <ActionButton
                    label="Старт"
                    icon={<Play className="h-4 w-4" />}
                    onClick={startGame}
                    disabled={!myPlayer || game.players.length < 2}
                  />
                ) : null}

                {game.status === "finished" ? (
                  <ActionButton
                    label="Новая партия"
                    icon={<RefreshCcw className="h-4 w-4" />}
                    onClick={resetGame}
                    disabled={!myPlayer}
                  />
                ) : null}

                <ActionButton
                  label="Бросить кубики"
                  icon={<Dice6 className="h-4 w-4" />}
                  onClick={() => emitAction("turn:roll")}
                  disabled={!canRoll}
                />

                <ActionButton
                  label="Завершить ход"
                  icon={<Flag className="h-4 w-4" />}
                  onClick={() => emitAction("turn:end")}
                  disabled={!canEndTurn}
                />
              </div>

              {isMyTurn && myPlayer?.inJail && !myPlayer.hasRolledThisTurn ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton
                    label="Заплатить за выход"
                    icon={<Landmark className="h-4 w-4" />}
                    onClick={() => emitAction("jail:pay")}
                  />
                  <ActionButton
                    label="Использовать карту"
                    icon={<Lock className="h-4 w-4" />}
                    onClick={() => emitAction("jail:card")}
                    disabled={!myPlayer.hasJailCard}
                  />
                </div>
              ) : null}

              <AnimatePresence>
                {myPrompt ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="mt-3 rounded-lg border border-amber-500/60 bg-amber-500/10 p-2"
                  >
                    <p className="mb-2 text-xs text-amber-100">
                      Действие: {game.properties[myPrompt.propertyId]?.name}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {myPrompt.type === "buy" ? (
                        <ActionButton
                          label="Купить"
                          icon={<ShoppingCart className="h-4 w-4" />}
                          onClick={() => emitAction("property:buy")}
                        />
                      ) : null}
                      {myPrompt.type === "upgrade" ? (
                        <ActionButton
                          label="Улучшить"
                          icon={<HousePlus className="h-4 w-4" />}
                          onClick={() => emitAction("property:upgrade")}
                        />
                      ) : null}
                      {myPrompt.type === "buyout" ? (
                        <ActionButton
                          label="Выкупить"
                          icon={<Crown className="h-4 w-4" />}
                          onClick={() => emitAction("property:buyout")}
                        />
                      ) : null}
                      <ActionButton
                        label="Пропустить"
                        icon={<XCircle className="h-4 w-4" />}
                        onClick={() => emitAction("action:skip")}
                      />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div className="mt-3 rounded-lg border border-emerald-700 bg-emerald-900/40 p-2 text-xs text-emerald-100/90">
                <p>Ход: {game.turn}</p>
                <p>
                  Текущий игрок:{" "}
                  {game.players.find((player) => player.id === game.currentTurnPlayerId)?.name ?? "-"}
                </p>
                <p>Кубики: {game.lastDiceRoll ? `${game.lastDiceRoll[0]} + ${game.lastDiceRoll[1]}` : "-"}</p>
                <p>Free Parking: ${game.freeParkingPot}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-700/70 bg-emerald-950/70 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-200">Трейд</h2>
                <button
                  type="button"
                  className={`${btnBase} border-emerald-500 bg-emerald-700/20 px-2 py-1 text-xs text-emerald-100`}
                  disabled={!myPlayer}
                  onClick={() => setTradeOpen(true)}
                >
                  <Handshake className="h-3.5 w-3.5" />
                  Обменяться
                </button>
              </div>

              {pendingTrade ? (
                <div className="rounded-lg border border-emerald-700 bg-emerald-900/40 p-2 text-xs">
                  <p className="mb-2 text-emerald-100">{formatTrade(pendingTrade, game)}</p>
                  {pendingTrade.toPlayerId === myPlayer?.id ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          socket.emit("trade:respond", { playerId: myPlayer.id, accept: true })
                        }
                        className="rounded border border-amber-400 px-2 py-1 text-amber-100"
                      >
                        Принять
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          socket.emit("trade:respond", { playerId: myPlayer.id, accept: false })
                        }
                        className="rounded border border-emerald-600 px-2 py-1 text-emerald-100"
                      >
                        Отклонить
                      </button>
                    </div>
                  ) : (
                    <p className="text-emerald-200/80">Ожидаем ответ другого игрока…</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-emerald-200/80">Активных предложений обмена нет.</p>
              )}
            </div>

            <div className="rounded-2xl border border-emerald-700/70 bg-emerald-950/70 p-3">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-200">Игроки</h2>
              <div className="space-y-2">
                {game.players.map((player) => (
                  <div key={player.id} className="rounded-lg border border-emerald-700 bg-emerald-900/40 p-2">
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: player.color }}>{player.name}</span>
                      {game.winnerId === player.id ? <Crown className="h-4 w-4 text-amber-300" /> : null}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-emerald-100/90">
                      <p>Баланс: ${player.balance}</p>
                      <p>Позиция: {player.position}</p>
                      <p>Улицы: {player.properties.length}</p>
                      <p>Статус: {player.inJail ? "Тюрьма" : player.isBankrupt ? "Банкрот" : "В игре"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-700/70 bg-emerald-950/70 p-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLeaderboardTab("wins")}
              className={`rounded border px-2 py-1 text-xs ${
                leaderboardTab === "wins"
                  ? "border-amber-400 bg-amber-400/10 text-amber-100"
                  : "border-emerald-700 text-emerald-100"
              }`}
            >
              <Crown className="mr-1 inline h-3.5 w-3.5" />
              Победы
            </button>
            <button
              type="button"
              onClick={() => setLeaderboardTab("profit")}
              className={`rounded border px-2 py-1 text-xs ${
                leaderboardTab === "profit"
                  ? "border-amber-400 bg-amber-400/10 text-amber-100"
                  : "border-emerald-700 text-emerald-100"
              }`}
            >
              <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
              Прибыль
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(leaderboardTab === "wins" ? game.leaderboard.byWins : game.leaderboard.byProfit).map(
              (entry, idx) => (
                <div key={`${entry.playerName}-${idx}`} className="rounded-lg border border-emerald-700 bg-emerald-900/40 p-2 text-sm">
                  <p className="text-amber-100">{idx + 1}. {entry.playerName}</p>
                  <p className="text-xs text-emerald-100/80">Победы: {entry.wins}</p>
                  <p className="text-xs text-emerald-100/80">Прибыль: ${entry.totalProfit}</p>
                </div>
              ),
            )}
          </div>
        </section>
      </div>

      {tradeOpen ? (
        <TradeModal
          game={game}
          myPlayerId={myPlayer?.id ?? ""}
          onClose={() => setTradeOpen(false)}
          onSubmit={(payload) => {
            if (!myPlayer) return;
            socket.emit("trade:request", {
              playerId: myPlayer.id,
              targetPlayerId: payload.targetPlayerId,
              offeredPropertyIds: payload.offeredPropertyIds,
              requestedPropertyIds: payload.requestedPropertyIds,
              offeredMoney: payload.offeredMoney,
              requestedMoney: payload.requestedMoney,
            });
            setTradeOpen(false);
          }}
        />
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-emerald-700 bg-emerald-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-amber-200">История</h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="rounded border border-emerald-700 px-2 py-1 text-xs"
              >
                Закрыть
              </button>
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-auto text-sm">
              {game.history.map((event) => (
                <p key={event.id} className="rounded bg-emerald-900/40 px-2 py-1">
                  {new Date(event.createdAt).toLocaleTimeString()} — {event.message}
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {game.status === "finished" ? (
        <div className="fixed bottom-4 left-1/2 z-30 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-xl border border-amber-400/60 bg-[#3c2d0e]/90 p-3 text-sm text-amber-100">
          <p className="font-semibold">Партия завершена</p>
          <p>
            Победитель: {game.players.find((player) => player.id === game.winnerId)?.name ?? "нет"}
          </p>
        </div>
      ) : null}

      <div className="fixed bottom-4 right-4 rounded-full border border-cyan-400/60 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
        <Shield className="mr-1 inline h-3.5 w-3.5" />
        Щит защищает от первого выкупа
      </div>
    </main>
  );
}

export default App;
