import type { ProfileResponse, RoomDetails, RoomSummary, SessionPlayer } from "@monopoly/shared";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const withPlayerHeaders = (player: SessionPlayer): HeadersInit => ({
  "Content-Type": "application/json",
  "x-player-id": player.id,
  "x-player-name": encodeURIComponent(player.name),
  "x-player-avatar": encodeURIComponent(player.avatar),
  "x-player-color": player.color
});

const readJson = async <T>(response: Response): Promise<T> => {
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || "Ошибка запроса");
  }
  return json as T;
};

export const api = {
  async fetchRooms() {
    const response = await fetch(`${API_URL}/api/rooms`);
    return readJson<{ rooms: RoomSummary[] }>(response);
  },
  async createRoom(player: SessionPlayer, payload: { entryFee: number; maxPlayers: number }) {
    const response = await fetch(`${API_URL}/api/rooms/create`, {
      method: "POST",
      headers: withPlayerHeaders(player),
      body: JSON.stringify(payload)
    });
    return readJson<{ roomCode: string; room: RoomDetails }>(response);
  },
  async joinRoom(player: SessionPlayer, roomCode: string) {
    const response = await fetch(`${API_URL}/api/rooms/join`, {
      method: "POST",
      headers: withPlayerHeaders(player),
      body: JSON.stringify({ roomCode })
    });
    return readJson<{ status: string; room: RoomDetails }>(response);
  },
  async leaveRoom(player: SessionPlayer, roomCode: string) {
    const response = await fetch(`${API_URL}/api/rooms/leave`, {
      method: "POST",
      headers: withPlayerHeaders(player),
      body: JSON.stringify({ roomCode })
    });
    return readJson<{ status: string }>(response);
  },
  async startRoom(player: SessionPlayer, roomCode: string) {
    const response = await fetch(`${API_URL}/api/rooms/start`, {
      method: "POST",
      headers: withPlayerHeaders(player),
      body: JSON.stringify({ roomCode })
    });
    return readJson<{ status: string }>(response);
  },
  async getRoom(roomCode: string) {
    const response = await fetch(`${API_URL}/api/rooms/${roomCode}`);
    return readJson<{ room: RoomDetails }>(response);
  },
  async leaderboard() {
    const response = await fetch(`${API_URL}/api/leaderboard`);
    return readJson<{ wins: any[]; totalProfit: any[] }>(response);
  },
  async profile(player: SessionPlayer) {
    const response = await fetch(`${API_URL}/api/profile/${player.id}`, {
      headers: withPlayerHeaders(player)
    });
    return readJson<ProfileResponse>(response);
  }
};
