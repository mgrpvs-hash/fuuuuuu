import type { LeaderboardEntry, ProfileState, RoomState, RoomSummary } from "@monopoly/shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }
  return payload as T;
}

export async function createRoom(payload: {
  entryFee: number;
  maxPlayers: number;
  playerId: string;
  playerName: string;
  avatarUrl?: string;
}): Promise<RoomState> {
  return jsonRequest("/rooms/create", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function joinRoom(payload: {
  code: string;
  playerId: string;
  playerName: string;
  avatarUrl?: string;
}): Promise<RoomState> {
  return jsonRequest("/rooms/join", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function startRoom(payload: { code: string; playerId: string }) {
  return jsonRequest("/rooms/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchRooms(): Promise<RoomSummary[]> {
  return jsonRequest("/rooms");
}

export async function fetchRoom(code: string): Promise<RoomState> {
  return jsonRequest(`/rooms/${code}`);
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  return jsonRequest("/leaderboard");
}

export async function fetchProfile(playerId: string): Promise<ProfileState> {
  return jsonRequest(`/profile/${playerId}`);
}
