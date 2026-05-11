const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
async function jsonRequest(path, init) {
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
    return payload;
}
export async function createRoom(payload) {
    return jsonRequest("/rooms/create", {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export async function joinRoom(payload) {
    return jsonRequest("/rooms/join", {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export async function startRoom(payload) {
    return jsonRequest("/rooms/start", {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export async function fetchRooms() {
    return jsonRequest("/rooms");
}
export async function fetchRoom(code) {
    return jsonRequest(`/rooms/${code}`);
}
export async function fetchLeaderboard() {
    return jsonRequest("/leaderboard");
}
export async function fetchProfile(playerId) {
    return jsonRequest(`/profile/${playerId}`);
}
