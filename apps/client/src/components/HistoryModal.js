import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function HistoryModal({ open, onClose, items }) {
    if (!open) {
        return null;
    }
    return (_jsx("div", { className: "fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4", children: _jsxs("div", { className: "glass-panel w-full max-w-lg rounded-card border p-4", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between", children: [_jsx("h3", { className: "text-lg font-semibold text-gold", children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0441\u043E\u0431\u044B\u0442\u0438\u0439" }), _jsx("button", { className: "rounded border border-borderSoft px-2 py-1 text-xs", onClick: onClose, children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" })] }), _jsx("div", { className: "max-h-[420px] space-y-2 overflow-y-auto pr-1 text-sm text-emerald-100", children: items.length === 0 ? (_jsx("p", { className: "text-emerald-300", children: "\u041F\u043E\u043A\u0430 \u0441\u043E\u0431\u044B\u0442\u0438\u0439 \u043D\u0435\u0442." })) : (items.map((row, index) => (_jsx("div", { className: "rounded-xl border border-borderSoft bg-panel/80 px-3 py-2", children: row }, `${row}-${index}`)))) })] }) }));
}
