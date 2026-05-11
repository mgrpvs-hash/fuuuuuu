import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { ActionPanel } from "./ActionPanel";
import { CardModal } from "./CardModal";
import { GameBoard } from "./GameBoard";
import { HistoryModal } from "./HistoryModal";
import { JailModal } from "./JailModal";
import { PlayersPanel } from "./PlayersPanel";
import { TradeModal } from "./TradeModal";
export function GameScreen({ game, meId, send }) {
    const [historyOpen, setHistoryOpen] = useState(false);
    const [tradeOpen, setTradeOpen] = useState(false);
    const [cardVisible, setCardVisible] = useState(true);
    const me = useMemo(() => game.players.find((player) => player.id === meId), [game.players, meId]);
    const jailOpen = Boolean(me?.inJail && game.currentTurnPlayerId === meId && game.pendingAction.type === "jail_choice");
    useEffect(() => {
        if (game.lastCard) {
            setCardVisible(true);
        }
    }, [game.lastCard?.cardId]);
    return (_jsxs("div", { className: "grid gap-3 lg:grid-cols-[1fr_320px]", children: [_jsxs("div", { className: "space-y-3", children: [_jsx(GameBoard, { game: game, meId: meId, onRollDice: () => send("dice:roll"), onDrawCard: () => send("card:draw"), onOpenHistory: () => setHistoryOpen(true), onEndTurn: () => send("turn:end") }), _jsx(ActionPanel, { game: game, meId: meId, onBuyProperty: () => send("property:buy"), onUpgradeProperty: () => send("property:upgrade"), onBuyoutProperty: () => send("property:buyout"), onPlaceShield: () => send("shield:place", { cellIndex: me?.position ?? 0 }), onSellProperty: (cellIndex) => send("property:sell", { cellIndex }), onSkip: () => send("turn:end") })] }), _jsx(PlayersPanel, { game: game, meId: meId, onOpenTrade: () => setTradeOpen(true) }), _jsx(HistoryModal, { open: historyOpen, onClose: () => setHistoryOpen(false), items: game.history }), _jsx(TradeModal, { open: tradeOpen, onClose: () => setTradeOpen(false), game: game, meId: meId, onCreate: (trade) => send("trade:create", { trade }), onAccept: (tradeId) => send("trade:accept", { tradeId }), onReject: (tradeId) => send("trade:reject", { tradeId }), onCounter: (tradeId, trade) => send("trade:counter", { tradeId, trade }), onCancel: (tradeId) => send("trade:cancel", { tradeId }) }), cardVisible && _jsx(CardModal, { card: game.lastCard, onClose: () => setCardVisible(false) }), _jsx(JailModal, { open: jailOpen, player: me, onPay: () => send("jail:pay"), onRoll: () => send("jail:roll"), onUseCard: () => send("jail:use_card") })] }));
}
