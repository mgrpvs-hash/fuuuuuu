import { useMemo, useState } from "react";
import type { GameState } from "@monopoly/shared";
import { groupColorHex, playerColorHex } from "@/theme";

interface TradeModalProps {
  open: boolean;
  game: GameState;
  meId: string;
  onClose: () => void;
  onCreate: (payload: {
    toPlayerId: string;
    offeredPropertyIds: number[];
    requestedPropertyIds: number[];
    moneyFrom: number;
    moneyTo: number;
  }) => void;
  onAccept: (tradeId: string) => void;
  onReject: (tradeId: string) => void;
  onCounter: (
    tradeId: string,
    payload: {
      offeredPropertyIds: number[];
      requestedPropertyIds: number[];
      moneyFrom: number;
      moneyTo: number;
    }
  ) => void;
  onCancel: (tradeId: string) => void;
}

function PropertyCard({
  game,
  cellIndex,
  selected,
  onToggle
}: {
  game: GameState;
  cellIndex: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const cell = game.board[cellIndex];
  const property = game.properties.find((item) => item.cellIndex === cellIndex);
  const owner = property?.ownerId ? game.players.find((player) => player.id === property.ownerId) : undefined;
  return (
    <button
      className={`rounded-xl border p-2 text-left text-xs transition ${
        selected ? "border-gold bg-gold/10" : "border-borderSoft bg-panel/70"
      }`}
      onClick={onToggle}
      type="button"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold text-emerald-100">{cell?.name}</span>
        <span
          className="h-2.5 w-5 rounded"
          style={{ background: cell?.group ? groupColorHex[cell.group] ?? "#64748B" : "#64748B" }}
        />
      </div>
      <div className="space-y-0.5 text-[11px] text-emerald-300">
        <div>Цена: 🪙 {property?.scaledPrice}</div>
        <div>Уровень: {property?.level ?? 0}</div>
        <div>Аренда: 🪙 {property ? Math.round(property.scaledBaseRent * (1 + property.level * 0.4)) : 0}</div>
        <div className="flex items-center gap-1">
          Владелец:
          <span
            className="rounded px-1 text-black"
            style={{ background: owner ? playerColorHex[owner.color] : "#6B7280" }}
          >
            {owner?.name ?? "Bank"}
          </span>
        </div>
        {property?.shielded && <div>🛡️ Щит</div>}
      </div>
    </button>
  );
}

export function TradeModal({
  open,
  game,
  meId,
  onClose,
  onCreate,
  onAccept,
  onReject,
  onCounter,
  onCancel
}: TradeModalProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");
  const [offered, setOffered] = useState<number[]>([]);
  const [requested, setRequested] = useState<number[]>([]);
  const [moneyFrom, setMoneyFrom] = useState(0);
  const [moneyTo, setMoneyTo] = useState(0);

  const me = game.players.find((player) => player.id === meId);
  const target = game.players.find((player) => player.id === selectedPlayer);
  const myProperties = useMemo(
    () => game.properties.filter((property) => property.ownerId === meId).map((property) => property.cellIndex),
    [game.properties, meId]
  );
  const targetProperties = useMemo(
    () => game.properties.filter((property) => property.ownerId === selectedPlayer).map((property) => property.cellIndex),
    [game.properties, selectedPlayer]
  );

  const incoming = game.trades.filter((trade) => trade.toPlayerId === meId && trade.status === "pending");
  const outgoing = game.trades.filter((trade) => trade.fromPlayerId === meId && trade.status === "pending");

  if (!open || !me) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-3">
      <div className="glass-panel flex h-[90vh] w-full max-w-6xl flex-col rounded-card border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gold">Обмены</h3>
          <button className="rounded border border-borderSoft px-2 py-1 text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="grid flex-1 gap-3 overflow-hidden lg:grid-cols-[1.2fr_1fr]">
          <div className="overflow-hidden rounded-xl border border-borderSoft p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-emerald-300">Новое предложение</div>
            <select
              className="mb-3 w-full rounded-lg border border-borderSoft bg-panel px-2 py-2 text-sm"
              value={selectedPlayer}
              onChange={(event) => {
                setSelectedPlayer(event.target.value);
                setOffered([]);
                setRequested([]);
              }}
            >
              <option value="">Выбрать игрока</option>
              {game.players
                .filter((player) => player.id !== meId && !player.isBankrupt && !player.debtMode)
                .map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
            </select>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs text-emerald-300">Мои улицы</div>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {myProperties.map((cellIndex) => (
                    <PropertyCard
                      key={cellIndex}
                      game={game}
                      cellIndex={cellIndex}
                      selected={offered.includes(cellIndex)}
                      onToggle={() =>
                        setOffered((current) =>
                          current.includes(cellIndex)
                            ? current.filter((item) => item !== cellIndex)
                            : [...current, cellIndex]
                        )
                      }
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs text-emerald-300">Улицы {target?.name ?? "игрока"}</div>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {targetProperties.map((cellIndex) => (
                    <PropertyCard
                      key={cellIndex}
                      game={game}
                      cellIndex={cellIndex}
                      selected={requested.includes(cellIndex)}
                      onToggle={() =>
                        setRequested((current) =>
                          current.includes(cellIndex)
                            ? current.filter((item) => item !== cellIndex)
                            : [...current, cellIndex]
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="text-xs text-emerald-300">
                Я даю денег
                <input
                  className="mt-1 w-full rounded-lg border border-borderSoft bg-panel px-2 py-2 text-sm"
                  type="number"
                  min={0}
                  value={moneyFrom}
                  onChange={(event) => setMoneyFrom(Number(event.target.value))}
                />
              </label>
              <label className="text-xs text-emerald-300">
                Я прошу денег
                <input
                  className="mt-1 w-full rounded-lg border border-borderSoft bg-panel px-2 py-2 text-sm"
                  type="number"
                  min={0}
                  value={moneyTo}
                  onChange={(event) => setMoneyTo(Number(event.target.value))}
                />
              </label>
            </div>

            <button
              className="mt-3 rounded-xl bg-gradient-to-r from-green to-gold px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!selectedPlayer}
              onClick={() =>
                onCreate({
                  toPlayerId: selectedPlayer,
                  offeredPropertyIds: offered,
                  requestedPropertyIds: requested,
                  moneyFrom,
                  moneyTo
                })
              }
            >
              Отправить предложение
            </button>
          </div>

          <div className="grid gap-3 overflow-hidden">
            <div className="overflow-hidden rounded-xl border border-borderSoft p-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-emerald-300">Входящие</div>
              <div className="max-h-56 space-y-2 overflow-y-auto text-xs">
                {incoming.length === 0 && <div className="text-emerald-400">Нет входящих предложений</div>}
                {incoming.map((trade) => {
                  const sender = game.players.find((player) => player.id === trade.fromPlayerId);
                  return (
                    <div key={trade.id} className="rounded-xl border border-borderSoft bg-panel/70 p-2">
                      <div className="font-semibold text-gold">{sender?.name} предлагает обмен</div>
                      <div className="text-emerald-300">Деньги: 🪙 {trade.moneyFrom} / 🪙 {trade.moneyTo}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button className="rounded bg-green/70 px-2 py-1 text-black" onClick={() => onAccept(trade.id)}>
                          Принять
                        </button>
                        <button className="rounded bg-danger/80 px-2 py-1" onClick={() => onReject(trade.id)}>
                          Отклонить
                        </button>
                        <button
                          className="rounded border border-borderSoft px-2 py-1"
                          onClick={() =>
                            onCounter(trade.id, {
                              offeredPropertyIds: trade.requestedPropertyIds,
                              requestedPropertyIds: trade.offeredPropertyIds,
                              moneyFrom: trade.moneyTo,
                              moneyTo: trade.moneyFrom
                            })
                          }
                        >
                          Встречное
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-borderSoft p-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-emerald-300">Исходящие</div>
              <div className="max-h-56 space-y-2 overflow-y-auto text-xs">
                {outgoing.length === 0 && <div className="text-emerald-400">Нет исходящих предложений</div>}
                {outgoing.map((trade) => {
                  const receiver = game.players.find((player) => player.id === trade.toPlayerId);
                  return (
                    <div key={trade.id} className="rounded-xl border border-borderSoft bg-panel/70 p-2">
                      <div className="font-semibold text-gold">Для {receiver?.name}</div>
                      <div className="text-emerald-300">Деньги: 🪙 {trade.moneyFrom} / 🪙 {trade.moneyTo}</div>
                      <button className="mt-2 rounded border border-borderSoft px-2 py-1" onClick={() => onCancel(trade.id)}>
                        Отменить
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
