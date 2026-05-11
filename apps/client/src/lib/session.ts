import type { SessionPlayer } from "@monopoly/shared";

const storageKey = "monopoly-player";

const colors: SessionPlayer["color"][] = ["yellow", "blue", "red", "green", "purple", "orange"];
const avatars = ["🦊", "🦁", "🐼", "🐸", "🦉", "🐯"];

const randomFrom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const buildTelegramPlayer = (): SessionPlayer | null => {
  const tg = (window as any).Telegram?.WebApp;
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) {
    return null;
  }

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || `User ${user.id}`;
  const id = `tg_${String(user.id)}`;
  const color = colors[user.id % colors.length];
  const avatar = user.username ? user.username[0].toUpperCase() : name[0]?.toUpperCase() || "U";

  return {
    id,
    name,
    color,
    avatar
  };
};

export const loadPlayerFromStorage = (): SessionPlayer | null => {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionPlayer;
  } catch (_error) {
    return null;
  }
};

export const savePlayerToStorage = (player: SessionPlayer) => {
  localStorage.setItem(storageKey, JSON.stringify(player));
};

export const bootstrapSession = async (apiBaseUrl: string): Promise<SessionPlayer> => {
  const tgPlayer = buildTelegramPlayer();
  if (tgPlayer) {
    savePlayerToStorage(tgPlayer);
    return tgPlayer;
  }

  const local = loadPlayerFromStorage();
  if (local) {
    return local;
  }

  const response = await fetch(`${apiBaseUrl}/api/auth/guest`, {
    method: "POST"
  });
  if (!response.ok) {
    const fallback: SessionPlayer = {
      id: `guest_${Math.random().toString(36).slice(2, 10)}`,
      name: `Guest #${Math.floor(Math.random() * 900 + 100)}`,
      avatar: randomFrom(avatars),
      color: randomFrom(colors)
    };
    savePlayerToStorage(fallback);
    return fallback;
  }
  const data = await response.json();
  const player = data.player as SessionPlayer;
  savePlayerToStorage(player);
  return player;
};
