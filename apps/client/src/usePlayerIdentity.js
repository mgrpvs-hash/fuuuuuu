import { useMemo } from "react";
function randomLocalId() {
    const key = "monopoly_local_player_id";
    const existing = localStorage.getItem(key);
    if (existing) {
        return existing;
    }
    const value = `local_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem(key, value);
    return value;
}
export function usePlayerIdentity() {
    return useMemo(() => {
        const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
        if (tgUser) {
            return {
                playerId: `tg_${tgUser.id}`,
                playerName: tgUser.username ?? tgUser.first_name ?? `Player ${tgUser.id}`,
                avatarUrl: tgUser.photo_url
            };
        }
        const localId = randomLocalId();
        const nameKey = "monopoly_local_player_name";
        const existingName = localStorage.getItem(nameKey);
        const playerName = existingName ?? `Player-${localId.slice(-4)}`;
        if (!existingName) {
            localStorage.setItem(nameKey, playerName);
        }
        return {
            playerId: localId,
            playerName,
            avatarUrl: undefined
        };
    }, []);
}
