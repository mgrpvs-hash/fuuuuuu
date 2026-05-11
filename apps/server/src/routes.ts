import { Router } from "express";
import { z } from "zod";
import { roomManager } from "./game/roomManager";

const createRoomSchema = z.object({
  entryFee: z.number().min(1000),
  maxPlayers: z.number().min(2).max(6),
  playerId: z.string().min(1),
  playerName: z.string().min(1),
  avatarUrl: z.string().optional()
});

const joinRoomSchema = z.object({
  code: z.string().min(4),
  playerId: z.string().min(1),
  playerName: z.string().min(1),
  avatarUrl: z.string().optional()
});

const startRoomSchema = z.object({
  code: z.string().min(4),
  playerId: z.string().min(1)
});

export function createRouter() {
  const router = Router();

  router.post("/rooms/create", async (req, res) => {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    try {
      const room = await roomManager.createRoom(parsed.data);
      return res.json(room);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/rooms/join", async (req, res) => {
    const parsed = joinRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    try {
      const room = await roomManager.joinRoom(parsed.data);
      return res.json(room);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/rooms/start", async (req, res) => {
    const parsed = startRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    try {
      const game = await roomManager.startRoom(parsed.data.code, parsed.data.playerId);
      return res.json(game);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  });

  router.get("/rooms", (_req, res) => {
    return res.json(roomManager.listRooms());
  });

  router.get("/rooms/:code", (req, res) => {
    const room = roomManager.getRoom(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "Комната не найдена" });
    }
    return res.json(room);
  });

  router.get("/leaderboard", async (_req, res) => {
    const leaderboard = await roomManager.getLeaderboard();
    return res.json(leaderboard);
  });

  router.get("/profile/:id", async (req, res) => {
    const profile = await roomManager.getProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Профиль не найден" });
    }
    return res.json(profile);
  });

  return router;
}
