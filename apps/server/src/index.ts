import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { GameEngine, ensurePlayer, toParticipant, toRoomPayload } from "./game/engine";

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const engine = new GameEngine(prisma);
const userToRoom = new Map<string, string>();

const profileSchema = z.object({
  userId: z.string().optional(),
  telegramId: z.string().optional(),
  name: z.string().min(1).max(64),
  avatarUrl: z.string().url().optional()
});

const roomCreateSchema = z.object({
  entryFee: z.number().min(100).max(100000),
  maxPlayers: z.number().min(2).max(6)
});

const tradeSchema = z.object({
  toPlayerId: z.string(),
  offerMoney: z.number().min(0),
  requestMoney: z.number().min(0),
  offerPropertyIds: z.array(z.string()).max(10),
  requestPropertyIds: z.array(z.string()).max(10)
});

const tradeRespondSchema = z.object({
  tradeId: z.string(),
  accept: z.boolean()
});

const serializeRoom = (code: string) => {
  const room = engine.getRoom(code);
  if (!room) return undefined;
  return toRoomPayload(room);
};

const broadcastRooms = () => {
  io.emit("rooms:update", engine.getRooms());
};

const emitRoomState = (code: string) => {
  const payload = serializeRoom(code);
  if (!payload) return;
  io.to(`room:${code}`).emit("room:update", payload);
};

const emitActionButtons = (socketId: string, code: string, userId: string) => {
  const room = engine.getRoom(code);
  if (!room || !room.gameState) return;
  io.to(socketId).emit("game:actions", engine.getActionButtons(code, userId));
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/profile", async (req, res) => {
  try {
    const parsed = profileSchema.parse(req.body);
    const user = await ensurePlayer(prisma, parsed);

    const [resultsCount, profile] = await Promise.all([
      prisma.matchResult.count({ where: { userId: user.id } }),
      prisma.user.findUnique({
        where: { id: user.id },
        include: {
          results: {
            orderBy: { createdAt: "desc" },
            take: 10
          }
        }
      })
    ]);

    if (!profile) {
      res.status(404).json({ message: "Пользователь не найден" });
      return;
    }

    res.json({
      id: profile.id,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      balance: profile.balance,
      wins: profile.wins,
      gamesPlayed: profile.gamesPlayed,
      totalPayout: profile.totalPayout,
      totalEntryFees: profile.totalEntryFees,
      profit: profile.totalPayout - profile.totalEntryFees,
      recentMatches: profile.results,
      totalMatches: resultsCount
    });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Ошибка профиля" });
  }
});

app.get("/api/profile/:userId", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user) {
    res.status(404).json({ message: "Пользователь не найден" });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    balance: user.balance,
    wins: user.wins,
    gamesPlayed: user.gamesPlayed,
    totalPayout: user.totalPayout,
    totalEntryFees: user.totalEntryFees,
    profit: user.totalPayout - user.totalEntryFees
  });
});

app.get("/api/leaderboard/wins", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: [{ wins: "desc" }, { gamesPlayed: "desc" }],
    take: 20
  });
  res.json(
    users.map((user) => ({
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      wins: user.wins,
      gamesPlayed: user.gamesPlayed,
      balance: user.balance
    }))
  );
});

app.get("/api/leaderboard/profit", async (_req, res) => {
  const users = await prisma.user.findMany({ take: 100 });
  const ranked = users
    .map((user) => ({
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      profit: user.totalPayout - user.totalEntryFees,
      totalPayout: user.totalPayout,
      totalEntryFees: user.totalEntryFees
    }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 20);
  res.json(ranked);
});

app.get("/api/rooms", (_req, res) => {
  res.json(engine.getRooms());
});

io.on("connection", (socket) => {
  const userId = socket.handshake.auth?.userId as string | undefined;
  if (!userId) {
    socket.emit("app:error", "Нет идентификатора пользователя");
    socket.disconnect();
    return;
  }

  socket.data.userId = userId;
  socket.emit("rooms:update", engine.getRooms());

  socket.on("rooms:list", () => {
    socket.emit("rooms:update", engine.getRooms());
  });

  socket.on("room:create", async (payload) => {
    try {
      const parsed = roomCreateSchema.parse(payload);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("Пользователь не найден");

      const room = await engine.createRoom({
        host: toParticipant(user),
        entryFee: parsed.entryFee,
        maxPlayers: parsed.maxPlayers
      });

      const roomName = `room:${room.code}`;
      userToRoom.set(userId, room.code);
      await socket.join(roomName);
      emitRoomState(room.code);
      emitActionButtons(socket.id, room.code, userId);
      broadcastRooms();
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось создать комнату");
    }
  });

  socket.on("room:join", async (payload: { code: string }) => {
    try {
      const code = payload.code?.trim().toUpperCase();
      if (!code) throw new Error("Код комнаты не указан");
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("Пользователь не найден");

      const currentRoom = userToRoom.get(userId);
      if (currentRoom && currentRoom !== code) {
        await engine.leaveRoom(currentRoom, userId);
        await socket.leave(`room:${currentRoom}`);
        emitRoomState(currentRoom);
      }

      const room = await engine.joinRoom(code, toParticipant(user));
      userToRoom.set(userId, room.code);
      await socket.join(`room:${room.code}`);
      emitRoomState(room.code);
      emitActionButtons(socket.id, room.code, userId);
      broadcastRooms();
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось войти в комнату");
    }
  });

  socket.on("room:leave", async () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) return;
      await engine.leaveRoom(code, userId);
      userToRoom.delete(userId);
      await socket.leave(`room:${code}`);
      emitRoomState(code);
      broadcastRooms();
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось выйти из комнаты");
    }
  });

  socket.on("room:start", async () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.startGame(code, userId);
      emitRoomState(code);
      for (const [sid, client] of io.of("/").sockets) {
        if (client.rooms.has(`room:${code}`)) {
          emitActionButtons(sid, code, client.data.userId as string);
        }
      }
      broadcastRooms();
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось начать игру");
    }
  });

  socket.on("game:roll", async () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.rollDice(code, userId);
      emitRoomState(code);
      for (const [sid, client] of io.of("/").sockets) {
        if (client.rooms.has(`room:${code}`)) {
          emitActionButtons(sid, code, client.data.userId as string);
        }
      }
      broadcastRooms();
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Ошибка броска");
    }
  });

  socket.on("game:buyProperty", async () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.buyProperty(code, userId);
      emitRoomState(code);
      emitActionButtons(socket.id, code, userId);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось купить улицу");
    }
  });

  socket.on("game:upgradeProperty", async (payload?: { propertyId?: string }) => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.upgradeProperty(code, userId, payload?.propertyId);
      emitRoomState(code);
      emitActionButtons(socket.id, code, userId);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось улучшить улицу");
    }
  });

  socket.on("game:applyShield", async (payload?: { propertyId?: string }) => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.applyShield(code, userId, payload?.propertyId);
      emitRoomState(code);
      emitActionButtons(socket.id, code, userId);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось установить щит");
    }
  });

  socket.on("game:buyout", async () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.buyoutProperty(code, userId);
      emitRoomState(code);
      emitActionButtons(socket.id, code, userId);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось выполнить выкуп");
    }
  });

  socket.on("game:payJail", async () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.payJailFine(code, userId);
      emitRoomState(code);
      emitActionButtons(socket.id, code, userId);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось оплатить тюрьму");
    }
  });

  socket.on("game:useJailCard", () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      engine.useJailCard(code, userId);
      emitRoomState(code);
      emitActionButtons(socket.id, code, userId);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось применить карту");
    }
  });

  socket.on("game:endTurn", async () => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      await engine.endTurn(code, userId);
      emitRoomState(code);
      for (const [sid, client] of io.of("/").sockets) {
        if (client.rooms.has(`room:${code}`)) {
          emitActionButtons(sid, code, client.data.userId as string);
        }
      }
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Не удалось завершить ход");
    }
  });

  socket.on("game:tradePropose", (payload) => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      const parsed = tradeSchema.parse(payload);
      engine.proposeTrade(code, userId, parsed);
      emitRoomState(code);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Ошибка отправки трейда");
    }
  });

  socket.on("game:tradeRespond", async (payload) => {
    try {
      const code = userToRoom.get(userId);
      if (!code) throw new Error("Вы не в комнате");
      const parsed = tradeRespondSchema.parse(payload);
      await engine.respondTrade(code, userId, parsed.tradeId, parsed.accept);
      emitRoomState(code);
    } catch (error) {
      socket.emit("app:error", error instanceof Error ? error.message : "Ошибка ответа на трейд");
    }
  });

  socket.on("disconnect", () => {
    const code = userToRoom.get(userId);
    if (!code) return;
    emitRoomState(code);
    broadcastRooms();
  });
});

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend started on port ${port}`);
});
