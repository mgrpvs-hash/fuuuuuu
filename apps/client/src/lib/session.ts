import type { SessionPlayer } from "@monopoly/shared";

const storageKey = "monopoly-player";

const colors: SessionPlayer["color"][] = ["yellow", "blue", "red", "green", "purple", "orange"];

interface GuestAuthResponse {
  id: string;
  name: string;
  balance: number;
  avatar: string;
  color: SessionPlayer["color"];
}

export interface BootstrapSessionResult {
  player: SessionPlayer;
  balance: number | null;
}

const isValidSessionPlayer = (value: unknown): value is SessionPlayer => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.avatar === "string" &&
    candidate.avatar.length > 0 &&
    typeof candidate.color === "string" &&
    candidate.color.length > 0
  );
};

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
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSessionPlayer(parsed)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch (_error) {
    localStorage.removeItem(storageKey);
    return null;
  }
};

export const savePlayerToStorage = (player: SessionPlayer) => {
  localStorage.setItem(storageKey, JSON.stringify(player));
};

const createGuestPlayer = async (apiBaseUrl: string): Promise<GuestAuthResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/auth/guest`, {
    method: "POST"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "неизвестная ошибка";
    throw new Error(`Не удалось создать гостя: ${message}`);
  }
  if (
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.balance !== "number" ||
    typeof payload.avatar !== "string" ||
    typeof payload.color !== "string"
  ) {
    throw new Error("Не удалось создать гостя: сервер вернул некорректные данные");
  }
  return payload as GuestAuthResponse;
};

export const bootstrapSession = async (apiBaseUrl: string): Promise<BootstrapSessionResult> => {
  const tgPlayer = buildTelegramPlayer();
  if (tgPlayer) {
    savePlayerToStorage(tgPlayer);
    return { player: tgPlayer, balance: null };
  }

  const local = loadPlayerFromStorage();
  if (local) {
    return { player: local, balance: null };
  }

  const guest = await createGuestPlayer(apiBaseUrl);
  const player: SessionPlayer = {
    id: guest.id,
    name: guest.name,
    avatar: guest.avatar,
    color: guest.color
  };
  savePlayerToStorage(player);
  return { player, balance: guest.balance };
};
