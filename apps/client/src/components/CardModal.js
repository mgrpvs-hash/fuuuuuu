import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function CardModal({ card, onClose }) {
    if (!card) {
        return null;
    }
    return (_jsx("div", { className: "fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4", children: _jsxs("div", { className: "glass-panel w-full max-w-md rounded-card border p-5 text-center", children: [_jsx("div", { className: "mb-2 text-4xl", children: card.icon }), _jsx("div", { className: "mb-1 text-sm uppercase tracking-wide text-emerald-300", children: card.category }), _jsx("h3", { className: "text-xl font-semibold text-gold", children: card.title }), _jsx("p", { className: "mt-2 text-sm text-emerald-100", children: card.description }), _jsx("div", { className: "mt-3 rounded-xl border border-gold/40 bg-gold/10 p-2 text-sm text-gold", children: card.effectText }), _jsx("button", { className: "mt-4 rounded-xl bg-gradient-to-r from-green to-gold px-5 py-2 text-sm font-semibold text-black", onClick: onClose, children: "\u041E\u043A" })] }) }));
}
