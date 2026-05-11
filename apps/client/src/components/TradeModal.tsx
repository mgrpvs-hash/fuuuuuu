import { useState } from "react";
import type { GameState } from "@monopoly/shared";

type TradePayload = {
  targetPlayerId: string;
  offeredPropertyIds: string[];
  requestedPropertyIds: string[];
  offeredMoney: number;
  requestedMoney: number;
};

type Props = {
  game: GameState;
  myPlayerId: string;
  onClose: () => void;
  onSubmit: (payload: TradePayload) => void;
};

const toggle = (current: string[], value: string): string[] =>
  current.includes(value) ? current.filter((item) => item !== value) : [...current, value];

export function TradeModal({ game, myPlayerId, onClose, onSubmit }: Props) {
  const [targetPlayerId, setTargetPlayerId] = useState<string>("");
  const [offeredPropertyIds, setOfferedPropertyIds] = useState<string[]>([]);
  const [requestedPropertyIds, setRequestedPropertyIds] = useState<string[]>([]);
  const [offeredMoney, setOfferedMoney] = useState<number>(0);
  const [requestedMoney, setRequestedMoney] = useState<number>(0);

  const myPlayer = game.players.find((player) => player.id === myPlayerId);
  const targets = game.players.filter((player) => player.id !== myPlayerId && !player.isBankrupt);
  const targetPlayer = targets.find((player) => player.id === targetPlayerId);

  const myProperties = myPlayer?.properties.map((id) => game.properties[id]).filter(Boolean) ?? [];
  const targetProperties = targetPlayer?.properties.map((id) => game.properties[id]).filter(Boolean) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-emerald-700 bg-emerald-950 p-4">
        <h3 className="mb-3 text-lg font-semibold text-amber-200">Обменяться</h3>
        <p className="mb-2 text-xs text-emerald-100/80">1) Выбери игрока 2) Кликни улицы 3) Укажи деньги</p>

        <div className="mb-3 flex flex-wrap gap-2">
          {targets.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => {
                setTargetPlayerId(player.id);
                setRequestedPropertyIds([]);
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                targetPlayerId === player.id
                  ? "border-amber-400 bg-amber-400/10 text-amber-100"
                  : "border-emerald-700 bg-emerald-900/40 text-emerald-100"
              }`}
            >
              {player.name}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 text-sm font-medium text-emerald-100">Твои улицы</h4>
            <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-emerald-800 p-2">
              {myProperties.length === 0 ? (
                <p className="text-xs text-emerald-300/70">Нет улиц</p>
              ) : (
                myProperties.map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left text-xs ${
                      offeredPropertyIds.includes(property.id)
                        ? "bg-amber-400/20 text-amber-100"
                        : "bg-emerald-900/40 text-emerald-100"
                    }`}
                    onClick={() => setOfferedPropertyIds((prev) => toggle(prev, property.id))}
                  >
                    {property.name}
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-1 text-sm font-medium text-emerald-100">Его улицы</h4>
            <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-emerald-800 p-2">
              {targetProperties.length === 0 ? (
                <p className="text-xs text-emerald-300/70">
                  {targetPlayer ? "Нет улиц" : "Сначала выбери игрока"}
                </p>
              ) : (
                targetProperties.map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    className={`w-full rounded px-2 py-1 text-left text-xs ${
                      requestedPropertyIds.includes(property.id)
                        ? "bg-amber-400/20 text-amber-100"
                        : "bg-emerald-900/40 text-emerald-100"
                    }`}
                    onClick={() => setRequestedPropertyIds((prev) => toggle(prev, property.id))}
                  >
                    {property.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-emerald-100">
            Ты доплачиваешь
            <input
              type="number"
              min={0}
              value={offeredMoney}
              onChange={(event) => setOfferedMoney(Number(event.target.value) || 0)}
              className="mt-1 w-full rounded border border-emerald-700 bg-emerald-900 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-emerald-100">
            Он доплачивает
            <input
              type="number"
              min={0}
              value={requestedMoney}
              onChange={(event) => setRequestedMoney(Number(event.target.value) || 0)}
              className="mt-1 w-full rounded border border-emerald-700 bg-emerald-900 px-2 py-1 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm text-emerald-100"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!targetPlayerId}
            onClick={() =>
              onSubmit({
                targetPlayerId,
                offeredPropertyIds,
                requestedPropertyIds,
                offeredMoney,
                requestedMoney,
              })
            }
            className="rounded-lg border border-amber-400 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Отправить обмен
          </button>
        </div>
      </div>
    </div>
  );
}
