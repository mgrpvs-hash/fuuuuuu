import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Home, Hotel, Landmark, Shield } from "lucide-react";
import { groupColorHex, playerColorHex } from "@/theme";
function upgradeVisual(level) {
    if (level <= 0)
        return null;
    if (level === 1)
        return _jsx(Home, { className: "h-3.5 w-3.5" });
    if (level === 2)
        return _jsx(Home, { className: "h-4.5 w-4.5" });
    if (level === 3)
        return _jsx(Hotel, { className: "h-4.5 w-4.5" });
    if (level === 4)
        return _jsx(Landmark, { className: "h-4.5 w-4.5 text-gold" });
    return (_jsx("span", { className: "text-[11px] font-bold leading-none text-gold", children: "\uD83D\uDC51" }));
}
export function BoardCell({ cell, property, playersOnCell, ownerColor }) {
    const cellOwned = Boolean(property?.ownerId);
    const stripeColor = cell.group ? groupColorHex[cell.group] ?? "#64748B" : "#1F2937";
    const tokenPlayers = playersOnCell.slice(0, 6);
    return (_jsxs("div", { className: "relative h-full w-full overflow-hidden rounded-xl border border-borderSoft bg-panel/85 p-1 shadow-lg", style: {
            boxShadow: cellOwned && ownerColor ? `0 0 0 2px ${ownerColor}66 inset` : undefined
        }, children: [cell.type === "property" && (_jsx("div", { className: "absolute left-0 right-0 top-0 h-1.5", style: { background: stripeColor } })), _jsxs("div", { className: "flex h-full flex-col pt-1 text-[9px] leading-tight text-emerald-100", children: [_jsx("span", { className: "font-semibold uppercase tracking-wide", children: cell.name }), _jsx("span", { className: "text-[8px] text-emerald-300/80", children: cell.type }), cell.type === "property" && _jsxs("span", { className: "text-[8px]", children: ["\uD83E\uDE99 ", cell.price] })] }), property && property.ownerId && (_jsx("div", { className: "absolute bottom-1 left-1 rounded-full px-1 text-[8px] font-semibold text-black", style: { background: ownerColor ?? "#4ADE80" }, children: "OWNER" })), property && property.level > 0 && (_jsx("div", { className: "absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md border border-white/20 shadow-md", style: {
                    background: property.ownerId && ownerColor ? `${ownerColor}CC` : "#1F2937"
                }, children: upgradeVisual(property.level) })), property?.shielded && (_jsx("div", { className: "absolute right-1 top-1 rounded-full bg-sky-500/20 p-0.5 text-sky-300", children: _jsx(Shield, { className: "h-3 w-3" }) })), _jsx("div", { className: "absolute bottom-0.5 left-0.5 right-0.5 flex flex-wrap gap-0.5", children: tokenPlayers.map((player) => (_jsx("div", { className: "flex h-4 w-4 items-center justify-center rounded-full border border-black/30 text-[8px] font-bold text-black shadow-token", style: { backgroundColor: playerColorHex[player.color] }, children: player.name.slice(0, 1).toUpperCase() }, player.id))) })] }));
}
