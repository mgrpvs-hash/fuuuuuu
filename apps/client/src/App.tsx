import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Dice5,
  History,
  Shield,
  Trophy,
  User,
  Wallet,
  LogOut,
  PlayCircle,
  Plus
} from "lucide-react";
import type {
  BoardCellState,
  GameEndedPayload,
  GameState,
  LeaderboardEntry,
  ProfileResponse,
  RoomDetails,
  RoomSummary,
  RuntimePlayer,
  SessionPlayer,
  TradeOffer
} from "@monopoly/shared";
import type { Socket } from "socket.io-client";
import { api, API_URL } from "./lib/api";
import { bootstrapSession } from "./lib/session";
import { createSocket } from "./lib/socket";

type MainTab = "games" | "leaderboard" | "profile";

const playerColorHex: Record<SessionPlayer["color"], string> = {
  yellow: "#FACC15",
  blue: "#2563EB",
  red: "#EF4444",
  green: "#22C55E",
  purple: "#A855F7",
  orange: "#F97316"
};

const colorGroupHex = {
  brown: "#8B5A2B",
  lightBlue: "#38BDF8",
  pink: "#EC4899",
  orange: "#F97316",
  red: "#EF4444",
  yellow: "#FACC15",
  green: "#22C55E",
  darkBlue: "#2563EB"
} as const;

const multiplier = (entryFee: number) => entryFee / 1000;
const propertyPrice = (cell: BoardCellState, entryFee: number) => Math.round((cell.basePrice || 0) * multiplier(entryFee));
const upgradeCost = (cell: BoardCellState, entryFee: number) => {
  const factors = [0.5, 0.8, 1.2, 1.8, 2.5];
  return Math.round(propertyPrice(cell, entryFee) * factors[cell.upgradeLevel]);
};
const totalUpgradeSpent = (cell: BoardCellState, entryFee: number) => {
  const factors = [0.5, 0.8, 1.2, 1.8, 2.5];
  let sum = 0;
  for (let level = 0; level < cell.upgradeLevel; level += 1) {
    sum += Math.round(propertyPrice(cell, entryFee) * factors[level]);
  }
  return sum;
};
const buyoutPrice = (cell: BoardCellState, entryFee: number) => {
  const price = propertyPrice(cell, entryFee);
  const upgrades = totalUpgradeSpent(cell, entryFee);
  return Math.round(price + upgrades * 1.7 + price * 0.5);
};

const boardCoords = (cellId: number) => {
  if (cellId <= 10) return { row: 10, col: 10 - cellId };
  if (cellId <= 20) return { row: 20 - cellId, col: 0 };
  if (cellId <= 30) return { row: 0, col: cellId - 20 };
  return { row: cellId - 30, col: 10 };
};

const BottomMenu = ({ tab, onChange }: { tab: MainTab; onChange: (tab: MainTab) => void }) => (
  <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-panel px-3 py-2">
    <div className="mx-auto flex max-w-lg items-center justify-around">
      <button onClick={() => onChange("games")} className={`flex flex-col items-center gap-1 text-xs ${tab === "games" ? "text-gold" : "text-slate-300"}`}>
        <Dice5 size={18} />
        Игры
      </button>
      <button onClick={() => onChange("leaderboard")} className={`flex flex-col items-center gap-1 text-xs ${tab === "leaderboard" ? "text-gold" : "text-slate-300"}`}>
        <Trophy size={18} />
        Лидерборд
      </button>
      <button onClick={() => onChange("profile")} className={`flex flex-col items-center gap-1 text-xs ${tab === "profile" ? "text-gold" : "text-slate-300"}`}>
        <User size={18} />
        Профиль
      </button>
    </div>
  </div>
);

const CreateRoomModal = ({
  isOpen,
  onClose,
  onCreate,
  balance
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (entryFee: number, maxPlayers: number) => void;
  balance: number;
}) => {
  const [entryFee, setEntryFee] = useState(1000);
  const [maxPlayers, setMaxPlayers] = useState(4);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-panel p-4">
        <h3 className="mb-3 text-lg font-semibold text-gold">Создать комнату</h3>
        <label className="mb-3 block text-sm text-slate-300">
          Ставка (entry fee)
          <input
            type="number"
            min={100}
            step={100}
            value={entryFee}
            onChange={(e) => setEntryFee(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-appBg px-3 py-2"
          />
        </label>
        <label className="mb-4 block text-sm text-slate-300">
          Максимум игроков
          <select
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-border bg-appBg px-3 py-2"
          >
            {[2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {balance < entryFee && <p className="mb-2 text-sm text-danger">Недостаточно баланса для создания комнаты</p>}
        <div className="flex gap-2">
          <button
            onClick={() => onCreate(entryFee, maxPlayers)}
            disabled={balance < entryFee}
            className="flex-1 rounded-lg bg-gold px-3 py-2 font-semibold text-black disabled:opacity-60"
          >
            Создать
          </button>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2">
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
};

const GamesPage = ({
  rooms,
  onJoin,
  onOpenCreate,
  balance
}: {
  rooms: RoomSummary[];
  onJoin: (roomCode: string) => void;
  onOpenCreate: () => void;
  balance: number;
}) => (
  <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-4">
    <div className="mb-4 rounded-2xl border border-border bg-panel p-4">
      <h1 className="text-xl font-bold text-gold">Monopoly TWA</h1>
      <p className="mt-2 flex items-center gap-2 text-sm text-slate-200">
        <Wallet size={16} />
        Баланс: 🪙 {balance}
      </p>
      <button onClick={onOpenCreate} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-3 py-2 font-semibold text-black">
        <Plus size={16} />
        Создать комнату
      </button>
    </div>

    <div className="space-y-3">
      {rooms.map((room) => (
        <div key={room.code} className="rounded-2xl border border-border bg-panel p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gold">Код: {room.code}</h3>
            <span className="text-xs text-slate-300">
              {room.playersCount}/{room.maxPlayers}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-300">Хост: {room.hostName}</p>
          <p className="text-sm text-slate-300">Ставка: 🪙 {room.entryFee}</p>
          <button
            onClick={() => onJoin(room.code)}
            disabled={room.playersCount >= room.maxPlayers || room.status !== "lobby"}
            className="mt-3 w-full rounded-lg border border-gold px-3 py-2 text-sm font-semibold text-gold disabled:opacity-40"
          >
            Войти
          </button>
        </div>
      ))}
      {!rooms.length && <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-slate-400">Нет активных lobby комнат</p>}
    </div>
  </div>
);

const LobbyPage = ({
  room,
  me,
  onLeave,
  onStart
}: {
  room: RoomDetails;
  me: SessionPlayer;
  onLeave: () => void;
  onStart: () => void;
}) => {
  const isHost = room.hostId === me.id;

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-4">
      <div className="rounded-2xl border border-border bg-panel p-4">
        <h2 className="text-center text-2xl font-bold text-gold">{room.code}</h2>
        <p className="mt-1 text-center text-sm text-slate-300">Ставка: 🪙 {room.entryFee}</p>
        <p className="text-center text-sm text-slate-300">
          Игроки: {room.players.length}/{room.maxPlayers}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {room.players.map((player) => (
          <div key={player.id} className="flex items-center justify-between rounded-xl border border-border bg-panel px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">{player.avatar}</span>
              <div>
                <p className="text-sm font-semibold">{player.name}</p>
                {player.id === room.hostId && <p className="text-xs text-gold">Хост</p>}
              </div>
            </div>
            <div className="h-3 w-3 rounded-full" style={{ background: playerColorHex[player.color] }} />
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {isHost && (
          <button
            onClick={onStart}
            disabled={room.players.length < 2}
            className="flex items-center justify-center gap-2 rounded-lg bg-gold px-3 py-2 font-semibold text-black disabled:opacity-50"
          >
            <PlayCircle size={16} />
            Начать игру
          </button>
        )}
        <button onClick={onLeave} className="flex items-center justify-center gap-2 rounded-lg border border-danger px-3 py-2 font-semibold text-danger">
          <LogOut size={16} />
          Выйти
        </button>
      </div>
    </div>
  );
};

const PlayerToken = ({ player }: { player: RuntimePlayer }) => (
  <div
    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-black"
    style={{ background: playerColorHex[player.color] }}
    title={player.name}
  >
    {player.name[0]?.toUpperCase() || "P"}
  </div>
);

const BoardCell = ({
  cell,
  players,
  ownerColor
}: {
  cell: BoardCellState;
  players: RuntimePlayer[];
  ownerColor: string | null;
}) => (
  <div
    className="relative flex h-full w-full flex-col justify-between overflow-hidden border border-border bg-panel p-[2px]"
    style={{ borderColor: ownerColor || "#2A4A3D" }}
  >
    <div className="flex items-center justify-between text-[8px]">
      <span className="font-bold">{cell.id}</span>
      {cell.shield && <Shield size={10} className="text-gold" />}
    </div>
    <div className="truncate text-[8px] leading-none">{cell.displayName}</div>
    {(cell.type === "property" || cell.type === "railroad" || cell.type === "utility") && (
      <div className="text-[8px] text-slate-300">🪙 {cell.basePrice}</div>
    )}
    {cell.type === "tax" && <div className="text-[8px] text-danger">🪙 {cell.baseAmount}</div>}
    {cell.colorGroup && <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background: colorGroupHex[cell.colorGroup] }} />}
    {!!players.length && (
      <div className="absolute right-0 top-3 flex max-w-full flex-wrap gap-[2px] rounded bg-black/40 p-[2px]">
        {players.map((p) => (
          <PlayerToken key={p.id} player={p} />
        ))}
      </div>
    )}
    {cell.ownerId && <div className="absolute left-0 top-3 h-2 w-2 rounded-full" style={{ background: ownerColor || "#fff" }} />}
    {cell.upgradeLevel > 0 && <div className="absolute bottom-1 right-1 text-[8px] text-gold">{["", "🏠", "🏘️", "🏨", "🏩", "👑"][cell.upgradeLevel]}</div>}
  </div>
);

const TradeModal = ({
  open,
  onClose,
  game,
  me,
  onSubmit
}: {
  open: boolean;
  onClose: () => void;
  game: GameState;
  me: RuntimePlayer;
  onSubmit: (payload: Omit<TradeOffer, "id" | "status" | "createdAt" | "fromPlayerId">) => void;
}) => {
  const [toPlayerId, setToPlayerId] = useState<string>("");
  const [myCoin, setMyCoin] = useState(0);
  const [theirCoin, setTheirCoin] = useState(0);
  const [myCellIds, setMyCellIds] = useState<number[]>([]);
  const [theirCellIds, setTheirCellIds] = useState<number[]>([]);

  if (!open) return null;

  const others = game.players.filter((p) => p.id !== me.id && !p.bankrupt);
  const selectedOther = others.find((o) => o.id === toPlayerId);

  const myCells = game.cells.filter((cell) => cell.ownerId === me.id);
  const otherCells = game.cells.filter((cell) => cell.ownerId === selectedOther?.id);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-panel p-4">
        <h3 className="mb-2 text-lg font-semibold text-gold">Обмен</h3>
        <select value={toPlayerId} onChange={(e) => setToPlayerId(e.target.value)} className="mb-2 w-full rounded border border-border bg-appBg px-3 py-2">
          <option value="">Выбери игрока</option>
          {others.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>

        <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="mb-1 text-slate-300">Мои улицы</p>
            <div className="max-h-24 space-y-1 overflow-y-auto rounded border border-border p-1">
              {myCells.map((cell) => (
                <label key={cell.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={myCellIds.includes(cell.id)}
                    onChange={(e) => setMyCellIds((prev) => (e.target.checked ? [...prev, cell.id] : prev.filter((id) => id !== cell.id)))}
                  />
                  <span>{cell.displayName}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-slate-300">Его улицы</p>
            <div className="max-h-24 space-y-1 overflow-y-auto rounded border border-border p-1">
              {otherCells.map((cell) => (
                <label key={cell.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={theirCellIds.includes(cell.id)}
                    onChange={(e) => setTheirCellIds((prev) => (e.target.checked ? [...prev, cell.id] : prev.filter((id) => id !== cell.id)))}
                  />
                  <span>{cell.displayName}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <input type="number" value={myCoin} min={0} onChange={(e) => setMyCoin(Number(e.target.value))} className="rounded border border-border bg-appBg px-2 py-1 text-sm" placeholder="Я даю 🪙" />
          <input type="number" value={theirCoin} min={0} onChange={(e) => setTheirCoin(Number(e.target.value))} className="rounded border border-border bg-appBg px-2 py-1 text-sm" placeholder="Я прошу 🪙" />
        </div>

        <div className="flex gap-2">
          <button
            disabled={!toPlayerId}
            onClick={() =>
              onSubmit({
                toPlayerId,
                fromCellIds: myCellIds,
                toCellIds: theirCellIds,
                fromCoins: myCoin,
                toCoins: theirCoin
              })
            }
            className="flex-1 rounded-lg bg-gold px-3 py-2 font-semibold text-black disabled:opacity-50"
          >
            Отправить предложение
          </button>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

const BoardPage = ({
  game,
  me,
  roomCode,
  onRoll,
  onEndTurn,
  onBuy,
  onUpgrade,
  onBuyout,
  onSell,
  onShield,
  onJailPay,
  onJailRoll,
  onJailUseCard,
  onCardDraw,
  onTradeCreate
}: {
  game: GameState;
  me: RuntimePlayer;
  roomCode: string;
  onRoll: () => void;
  onEndTurn: () => void;
  onBuy: (cellId: number) => void;
  onUpgrade: (cellId: number) => void;
  onBuyout: (cellId: number) => void;
  onSell: (cellId: number) => void;
  onShield: (cellId: number) => void;
  onJailPay: () => void;
  onJailRoll: () => void;
  onJailUseCard: () => void;
  onCardDraw: () => void;
  onTradeCreate: (payload: Omit<TradeOffer, "id" | "status" | "createdAt" | "fromPlayerId">) => void;
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [showTrade, setShowTrade] = useState(false);
  const currentPlayer = game.players.find((p) => p.id === game.currentPlayerId);
  const myTurn = game.currentPlayerId === me.id;
  const currentCell = game.cells.find((cell) => cell.id === me.position)!;
  const owner = currentCell.ownerId ? game.players.find((p) => p.id === currentCell.ownerId) : null;

  const canBuy = myTurn && !me.inDebt && !currentCell.ownerId && (currentCell.type === "property" || currentCell.type === "railroad" || currentCell.type === "utility");
  const canUpgrade = myTurn && !me.inDebt && currentCell.ownerId === me.id && currentCell.type === "property" && currentCell.upgradeLevel < 5;
  const canBuyout = myTurn && !me.inDebt && currentCell.ownerId && currentCell.ownerId !== me.id && (currentCell.type === "property" || currentCell.type === "railroad" || currentCell.type === "utility");
  const canShield = myTurn && me.pendingShields > 0 && currentCell.ownerId === me.id && !currentCell.shield;

  const ownCells = game.cells.filter((cell) => cell.ownerId === me.id);

  return (
    <div className="min-h-screen bg-appBg px-3 pb-4 pt-2">
      <div className="mx-auto mb-2 max-w-lg rounded-xl border border-border bg-panel px-3 py-2 text-sm">
        <div className="flex items-center justify-between">
          <span>Комната: {roomCode}</span>
          <span>
            Раунд {game.round}/{game.maxRounds}
          </span>
        </div>
        <div className="mt-1 text-gold">Ход: {currentPlayer?.name}</div>
      </div>

      <div className="mx-auto w-[95vw] max-w-lg">
        <div className="grid aspect-square w-full grid-cols-11 grid-rows-11 gap-[1px] rounded-xl border border-border bg-board p-[2px]">
          {Array.from({ length: 121 }, (_, index) => {
            const row = Math.floor(index / 11);
            const col = index % 11;
            const cell = game.cells.find((value) => {
              const pos = boardCoords(value.id);
              return pos.row === row && pos.col === col;
            });
            if (!cell) {
              if (row > 0 && row < 10 && col > 0 && col < 10) {
                return (
                  <div key={index} className="relative rounded-md border border-dashed border-border bg-panel/40 p-2">
                    {row === 5 && col === 5 && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <p className="text-sm font-bold text-gold">Monopoly</p>
                        <p className="px-1 text-[10px] text-slate-300">{game.recentEvent}</p>
                      </div>
                    )}
                  </div>
                );
              }
              return <div key={index} className="rounded border border-transparent bg-transparent" />;
            }
            const cellPlayers = game.players.filter((p) => p.position === cell.id && !p.bankrupt);
            const ownerPlayer = cell.ownerId ? game.players.find((p) => p.id === cell.ownerId) : null;
            const ownerColor = ownerPlayer ? playerColorHex[ownerPlayer.color] : null;

            return <BoardCell key={index} cell={cell} players={cellPlayers} ownerColor={ownerColor} />;
          })}
        </div>
      </div>

      <div className="mx-auto mt-2 max-w-lg rounded-xl border border-border bg-panel p-2">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm">Игроки</p>
          <button onClick={() => setShowHistory(true)} className="flex items-center gap-1 text-xs text-gold">
            <History size={14} />
            История
          </button>
        </div>
        <div className="space-y-1">
          {game.players.map((player) => (
            <div key={player.id} className={`flex items-center justify-between rounded px-2 py-1 text-xs ${player.id === game.currentPlayerId ? "bg-gold/10" : "bg-appBg/50"}`}>
              <div className="flex items-center gap-2">
                <span>{player.avatar}</span>
                <span>{player.name}</span>
                {player.id === game.currentPlayerId && <span className="text-gold">●</span>}
              </div>
              <div className="flex items-center gap-2">
                <span>🪙 {player.balance}</span>
                {player.inDebt && <span className="text-danger">Долг</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-2 max-w-lg rounded-xl border border-border bg-panel p-2">
        <div className="mb-2 text-xs text-slate-300">Последнее событие: {game.recentEvent}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button disabled={!myTurn || (me.hasRolledThisTurn && !me.canRollAgain) || me.inJail || me.inDebt} onClick={onRoll} className="rounded bg-gold px-2 py-2 font-semibold text-black disabled:opacity-50">
            Бросить кубики
          </button>
          <button disabled={!myTurn || (!me.hasRolledThisTurn && !me.inJail) || me.inDebt} onClick={onEndTurn} className="rounded border border-gold px-2 py-2 text-gold disabled:opacity-50">
            Завершить ход
          </button>
          {canBuy && (
            <button onClick={() => onBuy(currentCell.id)} className="rounded border border-success px-2 py-2 text-success">
              Купить за {propertyPrice(currentCell, game.entryFee)} 🪙
            </button>
          )}
          {canUpgrade && (
            <button onClick={() => onUpgrade(currentCell.id)} className="rounded border border-success px-2 py-2 text-success">
              Улучшить ({upgradeCost(currentCell, game.entryFee)} 🪙)
            </button>
          )}
          {canBuyout && (
            <button onClick={() => onBuyout(currentCell.id)} className="rounded border border-danger px-2 py-2 text-danger">
              Выкупить ({buyoutPrice(currentCell, game.entryFee)} 🪙)
            </button>
          )}
          {canShield && (
            <button onClick={() => onShield(currentCell.id)} className="rounded border border-gold px-2 py-2 text-gold">
              Поставить щит
            </button>
          )}
          {myTurn && me.inJail && (
            <>
              <button onClick={onJailPay} className="rounded border border-gold px-2 py-2 text-gold">
                Заплатить штраф
              </button>
              <button onClick={onJailRoll} className="rounded border border-gold px-2 py-2 text-gold">
                Бросок на дубль
              </button>
              <button onClick={onJailUseCard} className="rounded border border-gold px-2 py-2 text-gold">
                Использовать карту
              </button>
            </>
          )}
          {myTurn && (
            <button onClick={onCardDraw} className="rounded border border-border px-2 py-2 text-slate-300">
              Тест: карта шанса
            </button>
          )}
          <button onClick={() => setShowTrade(true)} className="rounded border border-border px-2 py-2 text-slate-300">
            Обмен
          </button>
        </div>
        {me.inDebt && (
          <div className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger">
            Вы в долгу. Можно только продавать активы:
            <div className="mt-1 flex flex-wrap gap-1">
              {ownCells.map((cell) => (
                <button key={cell.id} onClick={() => onSell(cell.id)} className="rounded border border-danger px-2 py-1">
                  Продать {cell.displayName}
                </button>
              ))}
              {!ownCells.length && <span>Активов нет.</span>}
            </div>
          </div>
        )}
      </div>

      {showHistory && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-panel p-4">
            <h3 className="mb-2 text-lg font-semibold text-gold">История</h3>
            <div className="max-h-72 space-y-1 overflow-y-auto text-xs">
              {game.eventLog.map((entry, idx) => (
                <p key={`${entry}_${idx}`} className="rounded bg-appBg px-2 py-1">
                  {entry}
                </p>
              ))}
            </div>
            <button onClick={() => setShowHistory(false)} className="mt-3 w-full rounded border border-border px-2 py-2">
              Закрыть
            </button>
          </div>
        </div>
      )}

      <TradeModal
        open={showTrade}
        onClose={() => setShowTrade(false)}
        game={game}
        me={me}
        onSubmit={(payload) => {
          onTradeCreate(payload);
          setShowTrade(false);
        }}
      />
    </div>
  );
};

const LeaderboardPage = ({ data }: { data: { wins: LeaderboardEntry[]; totalProfit: LeaderboardEntry[] } }) => {
  const [tab, setTab] = useState<"wins" | "profit">("wins");
  const list = tab === "wins" ? data.wins : data.totalProfit;
  const top = list.slice(0, 3);
  const rest = list.slice(3);

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-4">
      <div className="mb-3 flex gap-2">
        <button onClick={() => setTab("wins")} className={`flex-1 rounded-lg px-3 py-2 ${tab === "wins" ? "bg-gold text-black" : "border border-border"}`}>
          По победам
        </button>
        <button onClick={() => setTab("profit")} className={`flex-1 rounded-lg px-3 py-2 ${tab === "profit" ? "bg-gold text-black" : "border border-border"}`}>
          По прибыли
        </button>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        {top.map((entry, idx) => (
          <div key={entry.playerId} className="rounded-xl border border-border bg-panel p-3 text-center">
            <p className="text-xl">{["🥇", "🥈", "🥉"][idx]}</p>
            <p className="text-sm">{entry.avatar}</p>
            <p className="truncate text-xs">{entry.name}</p>
            <p className="text-xs text-gold">{tab === "wins" ? `${entry.wins} wins` : `🪙 ${entry.totalProfit}`}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {rest.map((entry, idx) => (
          <div key={entry.playerId} className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span>{idx + 4}</span>
              <span>{entry.avatar}</span>
              <span>{entry.name}</span>
            </div>
            <span className="text-gold">{tab === "wins" ? entry.wins : `🪙 ${entry.totalProfit}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ProfilePage = ({ profile, onReload }: { profile: ProfileResponse | null; onReload: () => void }) => {
  if (!profile) {
    return (
      <div className="p-4 text-center text-slate-400">
        <button onClick={onReload} className="rounded border border-border px-3 py-2">
          Загрузить профиль
        </button>
      </div>
    );
  }

  const winRate = profile.gamesPlayed ? Math.round((profile.wins / profile.gamesPlayed) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-24 pt-4">
      <div className="rounded-2xl border border-border bg-panel p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-appBg text-2xl">{profile.avatar}</div>
          <div>
            <h2 className="text-lg font-semibold">{profile.name}</h2>
            <p className="text-sm text-gold">🪙 {profile.balance}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-appBg p-2">Сыграно: {profile.gamesPlayed}</div>
          <div className="rounded-lg bg-appBg p-2">Побед: {profile.wins}</div>
          <div className="rounded-lg bg-appBg p-2">Поражений: {profile.losses}</div>
          <div className="rounded-lg bg-appBg p-2">Win rate: {winRate}%</div>
          <div className="rounded-lg bg-appBg p-2">Общая прибыль: {profile.totalProfit}</div>
          <div className="rounded-lg bg-appBg p-2">Лучший выигрыш: {profile.bestWin}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => alert("В разработке")} className="rounded-lg border border-border px-3 py-2 text-sm">
            Пополнить
          </button>
          <button onClick={() => alert("В разработке")} className="rounded-lg border border-border px-3 py-2 text-sm">
            Вывести
          </button>
        </div>
      </div>
    </div>
  );
};

const ResultsPage = ({ results, onBack }: { results: GameEndedPayload; onBack: () => void }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-lg rounded-2xl border border-border bg-panel p-4">
      <h2 className="text-center text-xl font-bold text-gold">Игра завершена</h2>
      <p className="mt-1 text-center text-sm text-slate-300">Победитель получает весь призовой фонд: 🪙 {results.prizePool}</p>
      <div className="mt-3 space-y-2">
        {results.results.map((row) => (
          <div key={row.playerId} className="flex items-center justify-between rounded-lg border border-border bg-appBg px-3 py-2 text-sm">
            <span>
              #{row.place} {row.playerName}
            </span>
            <span className="text-gold">+{row.prizeWon}</span>
          </div>
        ))}
      </div>
      <button onClick={onBack} className="mt-4 w-full rounded-lg bg-gold px-3 py-2 font-semibold text-black">
        К играм
      </button>
    </motion.div>
  </div>
);

function App() {
  const [player, setPlayer] = useState<SessionPlayer | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [sessionBalance, setSessionBalance] = useState<number | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomDetails | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [results, setResults] = useState<GameEndedPayload | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ wins: LeaderboardEntry[]; totalProfit: LeaderboardEntry[] }>({ wins: [], totalProfit: [] });
  const [mainTab, setMainTab] = useState<MainTab>("games");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [createModal, setCreateModal] = useState(false);

  const roomCode = room?.code || game?.roomCode || "";
  const me = useMemo(() => game?.players.find((value) => value.id === player?.id) || null, [game, player?.id]);

  const refreshRooms = async () => {
    const data = await api.fetchRooms();
    setRooms(data.rooms);
  };

  const refreshProfile = async (identity: SessionPlayer) => {
    const data = await api.profile(identity);
    setProfile(data);
    setSessionBalance(data.balance);
  };

  const refreshLeaderboard = async () => {
    const data = await api.leaderboard();
    setLeaderboard(data);
  };

  const withError = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Ошибка");
    }
  };

  const setupSocketListeners = (socketClient: Socket) => {
    socketClient.on("room:update", (nextRoom: RoomDetails) => {
      setRoom(nextRoom);
      setMainTab("games");
    });
    socketClient.on("game:start", () => {
      setMainTab("games");
    });
    socketClient.on("game:update", (nextGame: GameState) => {
      setGame(nextGame);
      if (nextGame.status === "finished") {
        setRoom(null);
      }
    });
    socketClient.on("game:ended", (payload: GameEndedPayload) => {
      setResults(payload);
    });
    socketClient.on("game:error", (message: string) => {
      alert(message);
    });
  };

  const ensureActivePlayer = async (): Promise<SessionPlayer> => {
    if (player?.id) {
      return player;
    }

    const initialized = await bootstrapSession(API_URL);
    setPlayer(initialized.player);
    if (typeof initialized.balance === "number") {
      setSessionBalance(initialized.balance);
    }
    if (!socket) {
      const socketClient = createSocket(initialized.player);
      setupSocketListeners(socketClient);
      setSocket(socketClient);
    }
    await refreshProfile(initialized.player);
    return initialized.player;
  };

  useEffect(() => {
    let socketClient: Socket | null = null;

    const initialize = async () => {
      try {
        setInitError(null);
        const initialized = await bootstrapSession(API_URL);
        setPlayer(initialized.player);
        if (typeof initialized.balance === "number") {
          setSessionBalance(initialized.balance);
        }
        await Promise.all([refreshRooms(), refreshLeaderboard(), refreshProfile(initialized.player)]);
        socketClient = createSocket(initialized.player);
        setupSocketListeners(socketClient);
        setSocket(socketClient);
      } catch (error) {
        setInitError(error instanceof Error ? error.message : "Не удалось инициализировать игрока");
      }
    };

    initialize().catch(() => undefined);

    return () => {
      socketClient?.disconnect();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshRooms().catch(() => undefined);
      refreshLeaderboard().catch(() => undefined);
      if (player) {
        refreshProfile(player).catch(() => undefined);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [player?.id]);

  const connectToRoomSocket = (code: string, identity: SessionPlayer) => {
    socket?.emit("room:join", code, identity);
  };

  const handleCreateRoom = (entryFee: number, maxPlayers: number) => {
    withError(async () => {
      const activePlayer = await ensureActivePlayer();
      const data = await api.createRoom(activePlayer, { entryFee, maxPlayers });
      setRoom(data.room);
      setCreateModal(false);
      connectToRoomSocket(data.room.code, activePlayer);
      await refreshProfile(activePlayer);
      await refreshRooms();
    });
  };

  const handleJoinRoom = (code: string) => {
    withError(async () => {
      const activePlayer = await ensureActivePlayer();
      const data = await api.joinRoom(activePlayer, code);
      setRoom(data.room);
      connectToRoomSocket(code, activePlayer);
      await refreshProfile(activePlayer);
      await refreshRooms();
    });
  };

  const handleLeave = () => {
    if (!player || !room) return;
    withError(async () => {
      await api.leaveRoom(player, room.code);
      setRoom(null);
      setGame(null);
      await refreshProfile(player);
      await refreshRooms();
    });
  };

  const handleStart = () => {
    if (!player || !room) return;
    withError(async () => {
      await api.startRoom(player, room.code);
    });
  };

  const emitAction = (event: string, payload?: unknown) => {
    if (!socket || !roomCode) return;
    socket.emit(event, payload ?? roomCode);
  };

  const onBackToGames = () => {
    setResults(null);
    setGame(null);
    setRoom(null);
    setMainTab("games");
    if (player) {
      refreshProfile(player).catch(() => undefined);
    }
  };

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-appBg p-4 text-slate-200">
        <div className="w-full max-w-md rounded-2xl border border-danger bg-panel p-4 text-center">
          <p className="text-lg font-semibold text-danger">Ошибка guest режима</p>
          <p className="mt-2 text-sm">{initError}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-lg border border-border px-3 py-2">
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (!player) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-300">Загрузка сессии...</div>;
  }

  return (
    <div className="min-h-screen bg-appBg text-slate-100">
      {game && me ? (
        <BoardPage
          game={game}
          me={me}
          roomCode={game.roomCode}
          onRoll={() => emitAction("dice:roll")}
          onEndTurn={() => emitAction("turn:end")}
          onBuy={(cellId) => emitAction("property:buy", { roomCode: game.roomCode, cellId })}
          onUpgrade={(cellId) => emitAction("property:upgrade", { roomCode: game.roomCode, cellId })}
          onBuyout={(cellId) => emitAction("property:buyout", { roomCode: game.roomCode, cellId })}
          onSell={(cellId) => emitAction("property:sell", { roomCode: game.roomCode, cellId })}
          onShield={(cellId) => emitAction("shield:place", { roomCode: game.roomCode, cellId })}
          onJailPay={() => emitAction("jail:pay")}
          onJailRoll={() => emitAction("jail:roll")}
          onJailUseCard={() => emitAction("jail:use_card")}
          onCardDraw={() => emitAction("card:draw")}
          onTradeCreate={(tradeData) => emitAction("trade:create", { roomCode: game.roomCode, tradeData })}
        />
      ) : room ? (
        <LobbyPage room={room} me={player} onLeave={handleLeave} onStart={handleStart} />
      ) : (
        <>
          {mainTab === "games" && <GamesPage rooms={rooms} onJoin={handleJoinRoom} onOpenCreate={() => setCreateModal(true)} balance={profile?.balance ?? sessionBalance ?? 0} />}
          {mainTab === "leaderboard" && <LeaderboardPage data={leaderboard} />}
          {mainTab === "profile" && <ProfilePage profile={profile} onReload={() => refreshProfile(player)} />}
          <BottomMenu tab={mainTab} onChange={setMainTab} />
        </>
      )}

      <CreateRoomModal isOpen={createModal} onClose={() => setCreateModal(false)} onCreate={handleCreateRoom} balance={profile?.balance ?? sessionBalance ?? 0} />
      {results && <ResultsPage results={results} onBack={onBackToGames} />}
    </div>
  );
}

export default App;
