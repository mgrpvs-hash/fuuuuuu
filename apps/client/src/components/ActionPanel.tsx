import { Home, Shield, Swords } from "lucide-react";
import type { GameState } from "@monopoly/shared";
import { UPGRADE_LEVEL_NAMES } from "@monopoly/shared";

interface ActionPanelProps {
  game: GameState;
  meId: string;
  onBuyProperty: () => void;
  onUpgradeProperty: () => void;
  onBuyoutProperty: () => void;
  onPlaceShield: () => void;
  onSellProperty: (cellIndex: number) => void;
  onSkip: () => void;
}

function ActionButton({
  label,
  onClick,
  variant = "secondary"
}: {
  label: string;
  onClick: () => void;
  variant?: "primary" | "danger" | "secondary";
}) {
  const style =
    variant === "primary"
      ? "bg-gradient-to-r from-green to-gold text-black"
      : variant === "danger"
        ? "bg-danger/80 text-white"
        : "bg-panel text-emerald-100 border border-borderSoft";
  return (
    <button
      className={`rounded-xl px-3 py-2 text-xs font-semibold shadow ${style}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function ActionPanel({
  game,
  meId,
  onBuyProperty,
  onUpgradeProperty,
  onBuyoutProperty,
  onPlaceShield,
  onSellProperty,
  onSkip
}: ActionPanelProps) {
  const current = game.players.find((player) => player.id === meId);
  if (!current || game.currentTurnPlayerId !== meId) {
    return null;
  }
  const pending = game.pendingAction;
  const propertyIndex = pending.cellIndex;
  const property = typeof propertyIndex === "number"
    ? game.properties.find((item) => item.cellIndex === propertyIndex)
    : undefined;
  const boardCell = typeof propertyIndex === "number" ? game.board[propertyIndex] : undefined;

  if (pending.type === "none" && !current.debtMode) {
    return null;
  }

  return (
    <div className="glass-panel rounded-card border border-borderSoft p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-emerald-300">Action Panel</div>
      <div className="text-sm text-emerald-100">
        {pending.type === "buy_property" && (
          <div className="space-y-3">
            <p>
              Купить <span className="text-gold">{boardCell?.name}</span> за 🪙 {property?.scaledPrice}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Купить улицу" onClick={onBuyProperty} variant="primary" />
              <ActionButton label="Пропустить" onClick={onSkip} />
            </div>
          </div>
        )}

        {pending.type === "upgrade_property" && property && (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2">
              <Home className="h-4 w-4 text-gold" />
              Ваша улица <span className="text-gold">{boardCell?.name}</span>
            </p>
            <p className="text-xs text-emerald-300">
              Следующий уровень: {UPGRADE_LEVEL_NAMES[Math.min(5, property.level + 1)]}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton label={`Улучшить до ${UPGRADE_LEVEL_NAMES[Math.min(5, property.level + 1)]}`} onClick={onUpgradeProperty} variant="primary" />
              <ActionButton label="Поставить щит" onClick={onPlaceShield} />
              <ActionButton label="Пропустить" onClick={onSkip} />
            </div>
          </div>
        )}

        {pending.type === "buyout_property" && property && (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2">
              <Swords className="h-4 w-4 text-gold" />
              После аренды можно выкупить <span className="text-gold">{boardCell?.name}</span>
            </p>
            <p className="text-xs text-emerald-300">Цена выкупа зависит от вложений и щита.</p>
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Выкупить улицу" onClick={onBuyoutProperty} variant="primary" />
              <ActionButton label="Пропустить" onClick={onSkip} />
            </div>
          </div>
        )}

        {pending.type === "debt_sell" && (
          <div className="space-y-3">
            <p className="text-danger">Debt mode: баланс ниже нуля. Продайте улицу, чтобы продолжить ход.</p>
            <div className="flex flex-wrap gap-2">
              {current.properties.map((id) => {
                const cell = game.board[id];
                const state = game.properties.find((item) => item.cellIndex === id);
                return (
                  <button
                    key={id}
                    className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2 text-xs"
                    onClick={() => onSellProperty(id)}
                  >
                    Продать {cell?.name} (🪙 {state ? Math.round(state.scaledPrice * 0.5 + state.totalUpgradeSpent * 0.5) : 0})
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {pending.type === "jail_choice" && (
          <div className="space-y-3">
            <p className="text-gold">Вы в тюрьме. Выберите действие в модалке тюрьмы.</p>
          </div>
        )}

        {pending.type === "draw_card" && (
          <div className="space-y-2 text-emerald-200">
            <p>Нажмите "Вытянуть карту" в центре доски.</p>
          </div>
        )}
      </div>
      {pending.type !== "none" && (
        <div className="mt-3 flex justify-end">
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-borderSoft bg-panel px-3 py-1.5 text-xs text-emerald-200"
            onClick={onPlaceShield}
          >
            <Shield className="h-3.5 w-3.5" />
            Щит на текущую улицу
          </button>
        </div>
      )}
    </div>
  );
}
