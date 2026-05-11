import type { RoomState, RoomSummary } from "@monopoly/shared";

interface LobbyScreenProps {
  playerName: string;
  balance: number;
  rooms: RoomSummary[];
  activeRoom: RoomState | null;
  entryFee: number;
  maxPlayers: number;
  setEntryFee: (value: number) => void;
  setMaxPlayers: (value: number) => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onStartRoom: () => void;
}

export function LobbyScreen({
  playerName,
  balance,
  rooms,
  activeRoom,
  entryFee,
  maxPlayers,
  setEntryFee,
  setMaxPlayers,
  onCreateRoom,
  onJoinRoom,
  onStartRoom
}: LobbyScreenProps) {
  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-card border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-emerald-300">Игры</div>
            <h1 className="text-2xl font-bold text-gold">Monopoly Royale</h1>
            <p className="text-sm text-emerald-100">Игрок: {playerName}</p>
          </div>
          <div className="rounded-xl border border-borderSoft bg-panel px-3 py-2 text-sm">
            Баланс: <span className="font-semibold text-gold">🪙 {balance}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-panel rounded-card border p-4">
          <h2 className="mb-3 text-lg font-semibold text-emerald-100">Создать комнату</h2>
          <div className="grid gap-3">
            <label className="text-xs text-emerald-300">
              Entry Fee
              <input
                className="mt-1 w-full rounded-xl border border-borderSoft bg-panel px-3 py-2 text-sm"
                type="number"
                min={1000}
                step={100}
                value={entryFee}
                onChange={(event) => setEntryFee(Number(event.target.value))}
              />
            </label>
            <label className="text-xs text-emerald-300">
              Max players (2-6)
              <input
                className="mt-1 w-full rounded-xl border border-borderSoft bg-panel px-3 py-2 text-sm"
                type="number"
                min={2}
                max={6}
                value={maxPlayers}
                onChange={(event) => setMaxPlayers(Number(event.target.value))}
              />
            </label>
            <button
              className="rounded-xl bg-gradient-to-r from-green to-gold px-4 py-2 text-sm font-semibold text-black"
              onClick={onCreateRoom}
            >
              Создать комнату
            </button>
          </div>
          {activeRoom?.status === "lobby" && (
            <div className="mt-4 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">
              <div>Текущая комната: <span className="font-semibold text-gold">{activeRoom.code}</span></div>
              <div>Игроков: {activeRoom.playerIds.length} / {activeRoom.maxPlayers}</div>
              <button
                className="mt-2 rounded-lg border border-borderSoft bg-panel px-3 py-1 text-xs"
                onClick={onStartRoom}
              >
                Запустить игру
              </button>
            </div>
          )}
        </div>

        <div className="glass-panel rounded-card border p-4">
          <h2 className="mb-3 text-lg font-semibold text-emerald-100">Активные комнаты</h2>
          <div className="space-y-2">
            {rooms.length === 0 && <div className="text-sm text-emerald-300">Пока нет комнат в lobby.</div>}
            {rooms.map((room) => (
              <div key={room.code} className="rounded-xl border border-borderSoft bg-panel/70 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gold">{room.code}</div>
                    <div className="text-xs text-emerald-300">Создатель: {room.creatorName}</div>
                    <div className="text-xs text-emerald-300">
                      EntryFee 🪙 {room.entryFee} · {room.currentPlayers}/{room.maxPlayers}
                    </div>
                  </div>
                  <button
                    className="rounded-xl border border-borderSoft bg-panel px-3 py-1.5 text-xs"
                    onClick={() => onJoinRoom(room.code)}
                  >
                    Войти
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
