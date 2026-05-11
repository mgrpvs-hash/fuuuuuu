import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { History, Sparkles } from "lucide-react";
import { getCellPosition } from "@/boardLayout";
import { playerColorHex } from "@/theme";
import { BoardCell } from "./BoardCell";
function Dice({ value }) {
    return (_jsx(motion.div, { className: "flex h-12 w-12 items-center justify-center rounded-2xl border border-gold/40 bg-gradient-to-b from-emerald-50 to-emerald-200 text-2xl font-black text-slate-900 shadow-lg", initial: { rotate: 0, scale: 1 }, animate: { rotate: [0, -12, 12, 0], scale: [1, 1.05, 1] }, transition: { duration: 0.45 }, children: value }));
}
export function GameBoard({ game, meId, onRollDice, onDrawCard, onOpenHistory, onEndTurn }) {
    const [animatedPositions, setAnimatedPositions] = useState(() => Object.fromEntries(game.players.map((player) => [player.id, player.position])));
    const playersById = useMemo(() => {
        return Object.fromEntries(game.players.map((player) => [player.id, player]));
    }, [game.players]);
    useEffect(() => {
        let timeout;
        if (!game.lastMove) {
            setAnimatedPositions(Object.fromEntries(game.players.map((player) => [player.id, player.position])));
            return;
        }
        const move = game.lastMove;
        const path = [];
        for (let step = 1; step <= move.steps; step += 1) {
            path.push((move.from + step) % 40);
        }
        let idx = 0;
        const run = () => {
            const next = path[idx];
            if (typeof next !== "number") {
                setAnimatedPositions((prev) => ({
                    ...prev,
                    [move.playerId]: move.to
                }));
                return;
            }
            setAnimatedPositions((prev) => ({
                ...prev,
                [move.playerId]: next
            }));
            idx += 1;
            timeout = setTimeout(run, 150);
        };
        run();
        return () => {
            if (timeout)
                clearTimeout(timeout);
        };
    }, [game.lastMove?.playerId, game.lastMove?.from, game.lastMove?.to, game.lastMove?.steps]);
    useEffect(() => {
        setAnimatedPositions((prev) => {
            const next = { ...prev };
            for (const player of game.players) {
                if (next[player.id] === undefined) {
                    next[player.id] = player.position;
                }
            }
            return next;
        });
    }, [game.players]);
    const currentPlayer = game.players.find((player) => player.id === game.currentTurnPlayerId);
    const myTurn = currentPlayer?.id === meId;
    const pending = game.pendingAction.type;
    const dice = game.lastMove?.dice ?? [1, 1];
    const shouldRoll = myTurn && pending === "none";
    const shouldDraw = myTurn && pending === "draw_card";
    return (_jsx("div", { className: "glass-panel rounded-card border p-4 shadow-premium", children: _jsxs("div", { className: "relative mx-auto aspect-square w-full max-w-[820px]", children: [_jsx("div", { className: "absolute inset-0 rounded-[28px] border border-borderSoft bg-gradient-to-b from-[#1A4A34] to-[#102A1F] shadow-2xl", style: {
                        transform: "perspective(1000px) rotateX(14deg) rotateZ(-1.2deg)",
                        transformOrigin: "center center"
                    }, children: game.board.map((cell) => {
                        const pos = getCellPosition(cell.index);
                        const property = game.properties.find((item) => item.cellIndex === cell.index);
                        const owner = property?.ownerId ? playersById[property.ownerId] : undefined;
                        const playersOnCell = game.players.filter((player) => (animatedPositions[player.id] ?? player.position) === cell.index && !player.isBankrupt);
                        const isCorner = [0, 10, 20, 30].includes(cell.index);
                        return (_jsx(motion.div, { layout: true, className: "absolute", style: {
                                top: `${pos.top}%`,
                                left: `${pos.left}%`,
                                width: isCorner ? "10.5%" : "9.8%",
                                height: isCorner ? "10.5%" : "9.8%"
                            }, children: _jsx(BoardCell, { cell: cell, property: property, playersOnCell: playersOnCell, ownerColor: owner ? playerColorHex[owner.color] : undefined }) }, cell.index));
                    }) }), _jsx("div", { className: "pointer-events-none absolute inset-[15%] rounded-3xl border border-borderSoft/60 bg-boardBg/70 shadow-inner" }), _jsxs("div", { className: "absolute inset-[18%] flex flex-col items-center justify-center gap-3 rounded-3xl border border-gold/25 bg-panel/85 p-4 text-center", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gold", children: [_jsx(Sparkles, { className: "h-4 w-4" }), "Monopoly Royale"] }), _jsxs("div", { className: "text-xs text-emerald-200", children: ["\u0420\u0430\u0443\u043D\u0434 ", game.round, " / ", game.maxRounds] }), _jsxs("div", { className: "text-xs text-emerald-100", children: ["\u0425\u043E\u0434: ", _jsx("span", { className: "font-semibold text-gold", children: currentPlayer?.name ?? "—" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Dice, { value: dice[0] }), _jsx(Dice, { value: dice[1] })] }), _jsx("div", { className: "mt-1 w-full rounded-xl border border-borderSoft bg-black/25 px-3 py-2 text-xs text-emerald-100", children: game.lastEvent }), _jsxs("div", { className: "flex flex-wrap items-center justify-center gap-2", children: [_jsx("button", { className: "rounded-xl bg-gradient-to-r from-green to-gold px-4 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-45", onClick: onRollDice, disabled: !shouldRoll, children: "\u0411\u0440\u043E\u0441\u0438\u0442\u044C \u043A\u0443\u0431\u0438\u043A\u0438" }), _jsx("button", { className: "rounded-xl border border-gold/50 bg-gold/15 px-3 py-2 text-xs font-semibold text-gold disabled:cursor-not-allowed disabled:opacity-45", onClick: onDrawCard, disabled: !shouldDraw, children: "\u0412\u044B\u0442\u044F\u043D\u0443\u0442\u044C \u043A\u0430\u0440\u0442\u0443" }), _jsx("button", { className: "rounded-xl border border-borderSoft bg-panel px-3 py-2 text-xs", onClick: onEndTurn, disabled: !myTurn, children: "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u0445\u043E\u0434" }), _jsxs("button", { className: "inline-flex items-center gap-1 rounded-xl border border-borderSoft bg-panel px-3 py-2 text-xs", onClick: onOpenHistory, children: [_jsx(History, { className: "h-3.5 w-3.5" }), "\u0418\u0441\u0442\u043E\u0440\u0438\u044F"] })] })] })] }) }));
}
