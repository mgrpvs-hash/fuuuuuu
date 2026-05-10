import { useEffect, useMemo, useState } from "react";
import { Socket, io } from "socket.io-client";
import { GameState, ProfileResponse, PropertyState, RoomListItem, RoomPayload } from "./types";

type TabId = "games" | "leaderboard" | "profile";

type ActionButton = {
  key:
    | "roll"
    | "buy_property"
    | "upgrade_property"
    | "buyout_property"
    | "apply_shield"
    | "pay_jail"
    | "use_jail_card"
    | "end_turn";
  label: string;
  intent: "primary" | "secondary" | "danger";
  payload?: Record<string, string | number | boolean>;
};

type LeaderWins = {
  id: string;
  name: string;
  avatarUrl?: string;
  wins: number;
  gamesPlayed: number;
  balance: number;
};

type LeaderProfit = {
  id: string;
  name: string;
  avatarUrl?: string;
  profit: number;
  totalPayout: number;
  totalEntryFees: number;
};

type TelegramUser = {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initDataUnsafe?: {
          user?: TelegramUser;
        };
      };
    };
  }
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? API_URL;
const LAST_TAB_KEY = "premium-monopoly:last-tab";
const STORED_USER_KEY = "premium-monopoly:user-id";

const coin = (value: number) => `🪙 ${Math.round(value).toLocaleString("ru-RU")}`;

const statusBadge: Record<string, string> = {
  active: "Активен",
  debt: "Debt",
  jailed: "Тюрьма",
  bankrupt: "Банкрот"
};

const colorClass: Record<PropertyState["color"], string> = {
  green: "bg-green",
  blue: "bg-sky-500",
  red: "bg-red-500",
  yellow: "bg-yellow-400"
};

const tabItems: Array<{ id: TabId; icon: string; label: string }> = [
  { id: "games", icon: "🎲", label: "Игры" },
  { id: "leaderboard", icon: "🏆", label: "Лидерборд" },
  { id: "profile", icon: "👤", label: "Профиль" }
];

const intentClass: Record<ActionButton["intent"], string> = {
  primary: "bg-green text-black",
  secondary: "bg-bgDark text-white border border-border",
  danger: "bg-danger text-white"
};

const matrixPosition = (index: number) => {
  if (index <= 6) {
    return { row: 1, col: index + 1 };
  }
  if (index <= 12) {
    return { row: index - 5, col: 7 };
  }
  if (index <= 18) {
    return { row: 7, col: 19 - index };
  }
  return { row: 25 - index, col: 1 };
};

const avatarFallback = (name: string) => name.slice(0, 1).toUpperCase();

function App() {
  const [tab, setTab] = useState<TabId>(() => (localStorage.getItem(LAST_TAB_KEY) as TabId) || "games");
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [room, setRoom] = useState<RoomPayload | null>(null);
  const [actions, setActions] = useState<ActionButton[]>([]);
  const [error, setError] = useState<string>("");
  const [entryFee, setEntryFee] = useState(1000);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [winsLeaderboard, setWinsLeaderboard] = useState<LeaderWins[]>([]);
  const [profitLeaderboard, setProfitLeaderboard] = useState<LeaderProfit[]>([]);
  const [tradeTo, setTradeTo] = useState("");
  const [offerMoney, setOfferMoney] = useState(0);
  const [requestMoney, setRequestMoney] = useState(0);
  const [offerProperties, setOfferProperties] = useState("");
  const [requestProperties, setRequestProperties] = useState("");

  useEffect(() => {
    localStorage.setItem(LAST_TAB_KEY, tab);
  }, [tab]);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      const storedId = localStorage.getItem(STORED_USER_KEY) ?? undefined;
      const displayName = getDisplayName(tgUser);

      const response = await fetch(`${API_URL}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: storedId,
          telegramId: tgUser?.id ? String(tgUser.id) : undefined,
          name: displayName,
          avatarUrl: tgUser?.photo_url
        })
      });

      if (!response.ok) {
        throw new Error("Не удалось инициализировать профиль");
      }

      const payload = (await response.json()) as ProfileResponse;
      localStorage.setItem(STORED_USER_KEY, payload.id);
      setProfile(payload);

      const client = io(SOCKET_URL, {
        transports: ["websocket"],
        auth: {
          userId: payload.id
        }
      });

      client.on("rooms:update", (nextRooms: RoomListItem[]) => setRooms(nextRooms));
      client.on("room:update", (nextRoom: RoomPayload) => {
        setRoom(nextRoom);
      });
      client.on("game:actions", (nextActions: ActionButton[]) => {
        setActions(nextActions);
      });
      client.on("app:error", (message: string) => {
        setError(message);
      });
      client.on("disconnect", () => {
        setActions([]);
      });
      setSocket(client);
    };

    bootstrap().catch((err: Error) => {
      setError(err.message);
    });
  }, []);

  useEffect(() => {
    if (tab !== "leaderboard") return;
    const loadLeaderboard = async () => {
      const [winsRes, profitRes] = await Promise.all([
        fetch(`${API_URL}/api/leaderboard/wins`),
        fetch(`${API_URL}/api/leaderboard/profit`)
      ]);
      if (winsRes.ok) setWinsLeaderboard(await winsRes.json());
      if (profitRes.ok) setProfitLeaderboard(await profitRes.json());
    };
    loadLeaderboard().catch(() => setError("Не удалось загрузить лидерборд"));
  }, [tab]);

  const currentGame = room?.gameState;
  const currentPlayer = useMemo(
    () => currentGame?.players.find((player) => player.userId === profile?.id),
    [currentGame, profile?.id]
  );

  const ownProperties = useMemo(
    () => currentGame?.properties.filter((property) => property.ownerId === profile?.id) ?? [],
    [currentGame, profile?.id]
  );

  const canCreateRoom = Boolean(socket && profile);

  const refreshProfile = async () => {
    if (!profile) return;
    const response = await fetch(`${API_URL}/api/profile/${profile.id}`);
    if (response.ok) {
      setProfile(await response.json());
    }
  };

  const createRoom = () => {
    socket?.emit("room:create", {
      entryFee: Number(entryFee),
      maxPlayers: Number(maxPlayers)
    });
    refreshProfile().catch(() => {});
  };

  const joinRoom = (code: string) => {
    socket?.emit("room:join", { code });
    refreshProfile().catch(() => {});
  };

  const leaveRoom = () => {
    socket?.emit("room:leave");
    setRoom(null);
    setActions([]);
    refreshProfile().catch(() => {});
  };

  const startGame = () => {
    socket?.emit("room:start");
  };

  const triggerAction = (action: ActionButton) => {
    if (!socket) return;
    if (action.key === "roll") socket.emit("game:roll");
    if (action.key === "buy_property") socket.emit("game:buyProperty");
    if (action.key === "upgrade_property")
      socket.emit("game:upgradeProperty", { propertyId: String(action.payload?.propertyId ?? "") });
    if (action.key === "buyout_property") socket.emit("game:buyout");
    if (action.key === "apply_shield")
      socket.emit("game:applyShield", { propertyId: String(action.payload?.propertyId ?? "") });
    if (action.key === "pay_jail") socket.emit("game:payJail");
    if (action.key === "use_jail_card") socket.emit("game:useJailCard");
    if (action.key === "end_turn") socket.emit("game:endTurn");
  };

  const sendTrade = () => {
    if (!socket || !tradeTo) return;
    socket.emit("game:tradePropose", {
      toPlayerId: tradeTo,
      offerMoney: Number(offerMoney) || 0,
      requestMoney: Number(requestMoney) || 0,
      offerPropertyIds: parsePropertiesInput(offerProperties),
      requestPropertyIds: parsePropertiesInput(requestProperties)
    });
    setOfferMoney(0);
    setRequestMoney(0);
    setOfferProperties("");
    setRequestProperties("");
  };

  const respondTrade = (tradeId: string, accept: boolean) => {
    socket?.emit("game:tradeRespond", { tradeId, accept });
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-bg px-3 pb-24 pt-4 text-white">
      <header className="premium-card mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gold">Monopoly Premium</h1>
          <p className="text-sm text-white/70">Telegram Mini App</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-white/60">Баланс</div>
          <div className="text-lg font-semibold text-gold">{coin(profile?.balance ?? 0)}</div>
        </div>
      </header>

      {error && (
        <div className="mb-3 rounded-card border border-danger/60 bg-danger/20 p-3 text-sm text-red-100">
          {error}
          <button className="ml-2 text-gold underline" onClick={() => setError("")}>
            скрыть
          </button>
        </div>
      )}

      <main className="flex-1">
        {tab === "games" && (
          <section className="space-y-3">
            {!room && (
              <>
                <div className="premium-card space-y-3">
                  <h2 className="text-lg font-semibold text-gold">Создать комнату</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm">
                      Вход 🪙
                      <input
                        className="mt-1 w-full rounded-card border border-border bg-bgDark px-3 py-2"
                        type="number"
                        min={100}
                        step={100}
                        value={entryFee}
                        onChange={(event) => setEntryFee(Number(event.target.value))}
                      />
                    </label>
                    <label className="text-sm">
                      Игроков
                      <input
                        className="mt-1 w-full rounded-card border border-border bg-bgDark px-3 py-2"
                        type="number"
                        min={2}
                        max={6}
                        value={maxPlayers}
                        onChange={(event) => setMaxPlayers(Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <button
                    className="w-full rounded-card bg-green px-4 py-3 font-semibold text-black disabled:opacity-60"
                    onClick={createRoom}
                    disabled={!canCreateRoom}
                  >
                    Создать комнату
                  </button>
                </div>

                <div className="space-y-2">
                  {rooms.map((roomItem) => (
                    <div key={roomItem.code} className="premium-card flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm text-white/70">Код: {roomItem.code}</div>
                        <div className="font-semibold text-gold">{coin(roomItem.entryFee)}</div>
                        <div className="text-sm text-white/70">
                          Игроки: {roomItem.players} / {roomItem.maxPlayers}
                        </div>
                      </div>
                      <button
                        className="rounded-card bg-green px-4 py-2 font-semibold text-black disabled:opacity-50"
                        disabled={roomItem.status !== "waiting"}
                        onClick={() => joinRoom(roomItem.code)}
                      >
                        Войти
                      </button>
                    </div>
                  ))}
                  {!rooms.length && <div className="premium-card text-sm text-white/70">Комнат пока нет</div>}
                </div>
              </>
            )}

            {room && (
              <div className="space-y-3">
                <div className="premium-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-white/70">Комната {room.code}</div>
                      <div className="text-base font-semibold text-gold">
                        {room.players.length} / {room.maxPlayers} игроков
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-white/70">Ставка</div>
                      <div className="font-semibold text-gold">{coin(room.entryFee)}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {room.players.map((player) => (
                      <div key={player.userId} className="rounded-card border border-border bg-bgDark px-3 py-1 text-sm">
                        {player.name}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    {room.status === "waiting" && room.hostId === profile?.id && (
                      <button className="rounded-card bg-green px-4 py-2 font-semibold text-black" onClick={startGame}>
                        Начать игру
                      </button>
                    )}
                    <button className="rounded-card border border-border bg-bgDark px-4 py-2" onClick={leaveRoom}>
                      Выйти
                    </button>
                  </div>
                </div>

                {currentGame && (
                  <GameView
                    game={currentGame}
                    viewerId={profile?.id ?? ""}
                    actions={actions}
                    onAction={triggerAction}
                    onTradeSend={sendTrade}
                    onTradeRespond={respondTrade}
                    tradeTo={tradeTo}
                    setTradeTo={setTradeTo}
                    offerMoney={offerMoney}
                    setOfferMoney={setOfferMoney}
                    requestMoney={requestMoney}
                    setRequestMoney={setRequestMoney}
                    offerProperties={offerProperties}
                    setOfferProperties={setOfferProperties}
                    requestProperties={requestProperties}
                    setRequestProperties={setRequestProperties}
                    ownProperties={ownProperties}
                  />
                )}
              </div>
            )}
          </section>
        )}

        {tab === "leaderboard" && (
          <section className="space-y-3">
            <div className="premium-card">
              <h2 className="mb-2 text-lg font-semibold text-gold">🏆 По победам</h2>
              <div className="space-y-2">
                {winsLeaderboard.map((user, index) => (
                  <div key={user.id} className="flex items-center justify-between rounded-card bg-bgDark px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="text-gold">#{index + 1}</div>
                      <div>{user.name}</div>
                    </div>
                    <div className="text-sm text-white/80">
                      Побед: {user.wins} · {coin(user.balance)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="premium-card">
              <h2 className="mb-2 text-lg font-semibold text-gold">💹 По прибыли</h2>
              <div className="space-y-2">
                {profitLeaderboard.map((user, index) => (
                  <div key={user.id} className="flex items-center justify-between rounded-card bg-bgDark px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="text-gold">#{index + 1}</div>
                      <div>{user.name}</div>
                    </div>
                    <div className="text-sm text-white/80">profit: {coin(user.profit)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === "profile" && (
          <section className="space-y-3">
            <div className="premium-card">
              <div className="flex items-center gap-3">
                {profile?.avatarUrl ? (
                  <img src={profile.avatarUrl} alt={profile.name} className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bgDark text-2xl font-semibold text-gold">
                    {avatarFallback(profile?.name ?? "U")}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-gold">{profile?.name}</h2>
                  <p className="text-sm text-white/70">Баланс: {coin(profile?.balance ?? 0)}</p>
                </div>
              </div>
            </div>
            <div className="premium-card space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/70">Победы</span>
                <span>{profile?.wins ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Игры</span>
                <span>{profile?.gamesPlayed ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Total payout</span>
                <span>{coin(profile?.totalPayout ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Total entry fees</span>
                <span>{coin(profile?.totalEntryFees ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">profit</span>
                <span className="text-gold">{coin(profile?.profit ?? 0)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="rounded-card bg-green px-4 py-3 font-semibold text-black">Пополнить (soon)</button>
              <button className="rounded-card border border-border bg-bgDark px-4 py-3">Вывести (soon)</button>
            </div>
          </section>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-bgDark/95 px-3 py-2">
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-2">
          {tabItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-card px-3 py-2 text-sm ${
                tab === item.id ? "bg-panel text-gold" : "bg-transparent text-white/70"
              }`}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      </nav>
      {currentPlayer && (
        <div className="fixed bottom-[66px] left-0 right-0 border-t border-border bg-panel/95 px-3 py-2">
          <div className="mx-auto flex max-w-3xl items-center justify-between text-sm">
            <div>
              Ход: <span className="text-gold">{currentGame?.players.find((p) => p.userId === currentGame.currentTurnPlayerId)?.name}</span>
            </div>
            <div>
              Ваш статус: <span className="text-gold">{statusBadge[currentPlayer.status]}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GameView(props: {
  game: GameState;
  viewerId: string;
  actions: ActionButton[];
  onAction: (action: ActionButton) => void;
  onTradeSend: () => void;
  onTradeRespond: (tradeId: string, accept: boolean) => void;
  tradeTo: string;
  setTradeTo: (value: string) => void;
  offerMoney: number;
  setOfferMoney: (value: number) => void;
  requestMoney: number;
  setRequestMoney: (value: number) => void;
  offerProperties: string;
  setOfferProperties: (value: string) => void;
  requestProperties: string;
  setRequestProperties: (value: string) => void;
  ownProperties: PropertyState[];
}) {
  const {
    game,
    viewerId,
    actions,
    onAction,
    onTradeSend,
    onTradeRespond,
    tradeTo,
    setTradeTo,
    offerMoney,
    setOfferMoney,
    requestMoney,
    setRequestMoney,
    offerProperties,
    setOfferProperties,
    requestProperties,
    setRequestProperties,
    ownProperties
  } = props;

  const turnPlayer = game.players.find((player) => player.userId === game.currentTurnPlayerId);
  const incomingTrades = game.pendingTrades.filter((trade) => trade.toPlayerId === viewerId);
  const otherPlayers = game.players.filter((player) => player.userId !== viewerId && player.status !== "bankrupt");

  return (
    <div className="space-y-3">
      <div className="premium-card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold text-gold">
            Раунд {Math.min(game.round, game.maxRounds)} / {game.maxRounds}
          </h3>
          <div className="text-sm text-white/70">Ход: {turnPlayer?.name ?? "—"}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-card bg-bgDark px-3 py-2">Entry fee: {coin(game.entryFee)}</div>
          <div className="rounded-card bg-bgDark px-3 py-2">Multiplier: x{game.multiplier.toFixed(2)}</div>
        </div>
      </div>

      <div className="premium-card">
        <div className="grid grid-cols-7 grid-rows-7 gap-1 rounded-card bg-bgDark p-2">
          {Array.from({ length: 49 }).map((_, idx) => {
            const row = Math.floor(idx / 7) + 1;
            const col = (idx % 7) + 1;
            const boardIndex = findBoardIndex(row, col);
            const cell = boardIndex >= 0 ? game.board[boardIndex] : undefined;
            const playersOnCell = boardIndex >= 0 ? game.players.filter((player) => player.position === boardIndex) : [];
            const property = cell?.propertyId ? game.properties.find((item) => item.id === cell.propertyId) : undefined;
            const isCenter = boardIndex < 0;

            return (
              <div
                key={`${row}-${col}`}
                className={`relative min-h-12 rounded-md border border-border p-1 text-[10px] ${
                  isCenter ? "bg-bg/80" : "bg-panel"
                }`}
              >
                {cell && (
                  <>
                    {property && <div className={`mb-1 h-1 rounded-sm ${colorClass[property.color]}`} />}
                    <div className="line-clamp-2 text-white/80">{cell.label}</div>
                    {property && (
                      <div className="mt-1 text-[9px] text-gold">
                        {property.ownerId ? `lvl ${property.level}${property.shield ? " 🛡" : ""}` : coin(property.basePrice)}
                      </div>
                    )}
                    {!!playersOnCell.length && (
                      <div className="absolute bottom-1 right-1 rounded bg-green px-1 text-[9px] text-black">
                        {playersOnCell.length}
                      </div>
                    )}
                  </>
                )}
                {isCenter && row === 4 && col === 4 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center text-xs text-white/80">
                    <div className="font-semibold text-gold">LOG & DICE</div>
                    <div>
                      🎲 {game.lastDice ? `${game.lastDice.d1} + ${game.lastDice.d2}` : "—"}
                    </div>
                    <div>Раунд {Math.min(game.round, game.maxRounds)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="premium-card">
        <h3 className="mb-2 font-semibold text-gold">Игроки</h3>
        <div className="space-y-2">
          {game.players.map((player) => (
            <div key={player.userId} className="flex items-center justify-between rounded-card bg-bgDark px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                {player.avatarUrl ? (
                  <img src={player.avatarUrl} alt={player.name} className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-gold">
                    {avatarFallback(player.name)}
                  </div>
                )}
                <div>
                  <div>{player.name}</div>
                  <div className="text-xs text-white/60">{statusBadge[player.status]}</div>
                </div>
              </div>
              <div className="font-semibold text-gold">{coin(player.balance)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="premium-card">
        <h3 className="mb-2 font-semibold text-gold">Лог событий</h3>
        <div className="max-h-44 space-y-1 overflow-y-auto text-sm">
          {[...game.log].reverse().map((entry) => (
            <div
              key={entry.id}
              className={`rounded-card px-3 py-2 ${
                entry.level === "danger"
                  ? "bg-danger/20 text-red-100"
                  : entry.level === "success"
                  ? "bg-green/20 text-green-100"
                  : entry.level === "warning"
                  ? "bg-gold/20 text-amber-100"
                  : "bg-bgDark text-white/90"
              }`}
            >
              {entry.text}
            </div>
          ))}
        </div>
      </div>

      <div className="premium-card space-y-2">
        <h3 className="font-semibold text-gold">Трейд</h3>
        <select
          className="w-full rounded-card border border-border bg-bgDark px-3 py-2 text-sm"
          value={tradeTo}
          onChange={(event) => setTradeTo(event.target.value)}
        >
          <option value="">Выберите игрока</option>
          {otherPlayers.map((player) => (
            <option key={player.userId} value={player.userId}>
              {player.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="rounded-card border border-border bg-bgDark px-3 py-2 text-sm"
            type="number"
            value={offerMoney}
            onChange={(event) => setOfferMoney(Number(event.target.value))}
            placeholder="Offer money"
          />
          <input
            className="rounded-card border border-border bg-bgDark px-3 py-2 text-sm"
            type="number"
            value={requestMoney}
            onChange={(event) => setRequestMoney(Number(event.target.value))}
            placeholder="Request money"
          />
        </div>
        <input
          className="w-full rounded-card border border-border bg-bgDark px-3 py-2 text-sm"
          value={offerProperties}
          onChange={(event) => setOfferProperties(event.target.value)}
          placeholder="Offer property IDs (p1,p2)"
        />
        <input
          className="w-full rounded-card border border-border bg-bgDark px-3 py-2 text-sm"
          value={requestProperties}
          onChange={(event) => setRequestProperties(event.target.value)}
          placeholder="Request property IDs (p3,p4)"
        />
        <div className="text-xs text-white/60">Ваши улицы: {ownProperties.map((property) => property.id).join(", ") || "нет"}</div>
        <button className="w-full rounded-card bg-green px-4 py-2 font-semibold text-black" onClick={onTradeSend}>
          Отправить трейд
        </button>
      </div>

      {!!incomingTrades.length && (
        <div className="premium-card space-y-2">
          <h3 className="font-semibold text-gold">Входящие трейды</h3>
          {incomingTrades.map((trade) => (
            <div key={trade.id} className="rounded-card bg-bgDark p-3 text-sm">
              <div>
                Offer: {coin(trade.offerMoney)} + [{trade.offerPropertyIds.join(", ") || "—"}]
              </div>
              <div>
                Want: {coin(trade.requestMoney)} + [{trade.requestPropertyIds.join(", ") || "—"}]
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-card bg-green px-3 py-2 font-semibold text-black"
                  onClick={() => onTradeRespond(trade.id, true)}
                >
                  Принять
                </button>
                <button
                  className="rounded-card bg-danger px-3 py-2 font-semibold text-white"
                  onClick={() => onTradeRespond(trade.id, false)}
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="premium-card">
        <h3 className="mb-2 font-semibold text-gold">Действия</h3>
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <button
              key={action.key + JSON.stringify(action.payload)}
              className={`rounded-card px-3 py-3 text-sm font-semibold ${intentClass[action.intent]}`}
              onClick={() => onAction(action)}
            >
              {action.label}
            </button>
          ))}
          {!actions.length && <div className="col-span-2 rounded-card bg-bgDark px-3 py-2 text-sm text-white/60">Ожидание хода...</div>}
        </div>
      </div>
    </div>
  );
}

function getDisplayName(user?: TelegramUser) {
  if (!user) {
    return `Guest ${Math.floor(Math.random() * 1000)}`;
  }
  const first = user.first_name ?? "";
  const last = user.last_name ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (user.username) return user.username;
  return `Player ${user.id ?? Math.floor(Math.random() * 9999)}`;
}

function parsePropertiesInput(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function findBoardIndex(row: number, col: number): number {
  for (let index = 0; index < 24; index += 1) {
    const position = matrixPosition(index);
    if (position.row === row && position.col === col) {
      return index;
    }
  }
  return -1;
}

export default App;
