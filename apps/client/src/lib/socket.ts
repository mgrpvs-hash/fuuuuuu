import { io, type Socket } from "socket.io-client";
import type { SessionPlayer } from "@monopoly/shared";
import { API_URL } from "./api";

export const createSocket = (player: SessionPlayer): Socket =>
  io(API_URL, {
    transports: ["websocket"],
    auth: {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      color: player.color
    }
  });
