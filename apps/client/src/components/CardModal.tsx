import type { CardResult } from "@monopoly/shared";

interface CardModalProps {
  card?: CardResult;
  onClose: () => void;
}

export function CardModal({ card, onClose }: CardModalProps) {
  if (!card) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="glass-panel w-full max-w-md rounded-card border p-5 text-center">
        <div className="mb-2 text-4xl">{card.icon}</div>
        <div className="mb-1 text-sm uppercase tracking-wide text-emerald-300">{card.category}</div>
        <h3 className="text-xl font-semibold text-gold">{card.title}</h3>
        <p className="mt-2 text-sm text-emerald-100">{card.description}</p>
        <div className="mt-3 rounded-xl border border-gold/40 bg-gold/10 p-2 text-sm text-gold">{card.effectText}</div>
        <button
          className="mt-4 rounded-xl bg-gradient-to-r from-green to-gold px-5 py-2 text-sm font-semibold text-black"
          onClick={onClose}
        >
          Ок
        </button>
      </div>
    </div>
  );
}
