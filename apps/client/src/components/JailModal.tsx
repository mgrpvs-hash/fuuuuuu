import type { PlayerState } from "@monopoly/shared";

interface JailModalProps {
  open: boolean;
  player?: PlayerState;
  onPay: () => void;
  onRoll: () => void;
  onUseCard: () => void;
}

export function JailModal({ open, player, onPay, onRoll, onUseCard }: JailModalProps) {
  if (!open || !player) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="glass-panel w-full max-w-sm rounded-card border p-4">
        <h3 className="text-lg font-semibold text-gold">Тюрьма</h3>
        <p className="mt-2 text-sm text-emerald-100">Попытки выхода: {player.jailAttempts}/3</p>
        <div className="mt-4 space-y-2">
          <button
            className="w-full rounded-xl bg-gradient-to-r from-green to-gold px-4 py-2 text-sm font-semibold text-black"
            onClick={onPay}
          >
            Заплатить штраф
          </button>
          <button
            className="w-full rounded-xl border border-borderSoft bg-panel px-4 py-2 text-sm"
            onClick={onRoll}
          >
            Бросить кубики
          </button>
          <button
            className="w-full rounded-xl border border-borderSoft bg-panel px-4 py-2 text-sm disabled:opacity-40"
            disabled={!player.getOutOfJailCards}
            onClick={onUseCard}
          >
            Использовать карту ({player.getOutOfJailCards})
          </button>
        </div>
      </div>
    </div>
  );
}
