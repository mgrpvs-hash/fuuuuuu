interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  items: string[];
}

export function HistoryModal({ open, onClose, items }: HistoryModalProps) {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="glass-panel w-full max-w-lg rounded-card border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gold">История событий</h3>
          <button className="rounded border border-borderSoft px-2 py-1 text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 text-sm text-emerald-100">
          {items.length === 0 ? (
            <p className="text-emerald-300">Пока событий нет.</p>
          ) : (
            items.map((row, index) => (
              <div key={`${row}-${index}`} className="rounded-xl border border-borderSoft bg-panel/80 px-3 py-2">
                {row}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
