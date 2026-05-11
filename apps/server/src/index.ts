import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { z } from "zod";
import type { SessionPlayer } from "@monopoly/shared";
import { config } from "./config";
import { prisma } from "./db";
import { buildGuestIdentity, ensurePlayer, getProfile } from "./player-service";
import {
  attachPlayerToSocketRoom,
  commandBuyProperty,
  commandBuyout,
  commandCardDraw,
  commandEndTurn,
  commandJailPay,
  commandJailRoll,
  commandJailUseCard,
  commandPlaceShield,
  commandRollDice,
  commandSell,
  commandTradeAccept,
  commandTradeCancel,
  commandTradeCounter,
  commandTradeCreate,
  commandTradeReject,
  commandUpgradeProperty,
  createRoom,
  ensureRoomMembership,
  getGameState,
  getLeaderboard,
  getPlayerRoom,
  getRoomInfo,
  joinRoom,
  leaveRoom,
  listLobbyRooms,
  serializeError,
  setRoomEmitter,
  startGame
} from "./room-service";

type AuthedRequest = Request & { player?: SessionPlayer };

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true
  })
);

const readIdentity = (req: Request): SessionPlayer | null => {
  const id = req.headers["x-player-id"];
  const name = req.headers["x-player-name"];
  const avatar = req.headers["x-player-avatar"];
  const color = req.headers["x-player-color"];

  if (!id || !name || !avatar || !color) {
    return null;
  }

  const safeDecode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  };

  return {
    id: String(id),
    name: safeDecode(String(name)),
    avatar: safeDecode(String(avatar)),
    color: String(color) as SessionPlayer["color"]
  };
};

const authMiddleware = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const identity = readIdentity(req);
    if (!identity) {
      res.status(401).json({ message: "Отсутствует игрок в заголовках" });
      return;
    }
    await ensurePlayer(identity);
    req.player = identity;
    next();
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/guest", async (_req, res) => {
  try {
    const identity = buildGuestIdentity();
    const player = await ensurePlayer(identity);
    const playerWithInitialBalance =
      player.balance === 5000
        ? player
        : await prisma.player.update({
            where: { id: player.id },
            data: { balance: 5000 }
          });
    res.json({
      id: playerWithInitialBalance.id,
      name: playerWithInitialBalance.name,
      balance: playerWithInitialBalance.balance,
      avatar: playerWithInitialBalance.avatar,
      color: playerWithInitialBalance.color
    });
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

app.get("/api/rooms", (_req, res) => {
  res.json({ rooms: listLobbyRooms() });
});

app.get("/api/rooms/:code", (req, res) => {
  try {
    res.json({ room: getRoomInfo(req.params.code.toUpperCase()) });
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    const board = await getLeaderboard();
    res.json(board);
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

app.get("/api/profile/:id", async (req, res) => {
  try {
    const identity = readIdentity(req);
    if (identity && identity.id === req.params.id) {
      await ensurePlayer(identity);
    }
    const profile = await getProfile(req.params.id);
    if (!profile) {
      res.status(404).json({ message: "Профиль не найден" });
      return;
    }
    res.json(profile);
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

app.post("/api/rooms/create", authMiddleware, async (req: AuthedRequest, res) => {
  const schema = z.object({
    entryFee: z.number().min(100),
    maxPlayers: z.number().min(2).max(6)
  });
  try {
    const payload = schema.parse(req.body);
    const room = await createRoom(req.player!, payload.entryFee, payload.maxPlayers);
    res.json({ roomCode: room.code, room });
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

app.post("/api/rooms/join", authMiddleware, async (req: AuthedRequest, res) => {
  const schema = z.object({
    roomCode: z.string().min(4).max(6)
  });
  try {
    const payload = schema.parse(req.body);
    const room = await joinRoom(req.player!, payload.roomCode.toUpperCase());
    res.json({ status: "joined", room });
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

app.post("/api/rooms/leave", authMiddleware, async (req: AuthedRequest, res) => {
  const schema = z.object({
    roomCode: z.string().min(4).max(6)
  });
  try {
    const payload = schema.parse(req.body);
    const result = await leaveRoom(req.player!.id, payload.roomCode.toUpperCase());
    res.json(result);
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

app.post("/api/rooms/start", authMiddleware, async (req: AuthedRequest, res) => {
  const schema = z.object({
    roomCode: z.string().min(4).max(6)
  });
  try {
    const payload = schema.parse(req.body);
    const game = await startGame(req.player!.id, payload.roomCode.toUpperCase());
    res.json({ status: "started", game });
  } catch (error) {
    const parsed = serializeError(error);
    res.status(parsed.status).json({ message: parsed.message });
  }
});

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.clientUrl
  }
});

setRoomEmitter((roomCode, event, payload) => {
  io.to(roomCode).emit(event, payload);
});

io.on("connection", async (socket) => {
  const raw = socket.handshake.auth as Partial<SessionPlayer>;
  const player: SessionPlayer | null =
    raw?.id && raw?.name && raw?.avatar && raw?.color
      ? {
          id: String(raw.id),
          name: String(raw.name),
          avatar: String(raw.avatar),
          color: String(raw.color) as SessionPlayer["color"]
        }
      : null;

  if (!player) {
    socket.emit("game:error", "Отсутствуют данные игрока");
    socket.disconnect();
    return;
  }

  await ensurePlayer(player);

  const execute = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const parsed = serializeError(error);
      socket.emit("game:error", parsed.message);
    }
  };

  socket.on("room:join", async (roomCode: string, playerData?: SessionPlayer) => {
    await execute(async () => {
      const identity = playerData || player;
      await ensurePlayer(identity);
      const activeRoom = getPlayerRoom(identity.id);
      if (!activeRoom) {
        await joinRoom(identity, roomCode.toUpperCase());
      }
      ensureRoomMembership(identity.id, roomCode.toUpperCase());
      attachPlayerToSocketRoom(roomCode.toUpperCase());
      socket.join(roomCode.toUpperCase());
      const game = getGameState(roomCode.toUpperCase());
      if (game) {
        socket.emit("game:update", game);
      }
    });
  });

  socket.on("game:start", async (roomCode: string) => {
    await execute(async () => {
      await startGame(player.id, roomCode.toUpperCase());
    });
  });

  socket.on("dice:roll", async (roomCode: string) => {
    await execute(async () => {
      await commandRollDice(player.id, roomCode.toUpperCase());
    });
  });

  socket.on("turn:end", async (roomCode: string) => {
    await execute(async () => {
      await commandEndTurn(player.id, roomCode.toUpperCase());
    });
  });

  socket.on("property:buy", async ({ roomCode, cellId }: { roomCode: string; cellId: number }) => {
    await execute(async () => {
      await commandBuyProperty(player.id, roomCode.toUpperCase(), cellId);
    });
  });

  socket.on("property:upgrade", async ({ roomCode, cellId }: { roomCode: string; cellId: number }) => {
    await execute(async () => {
      await commandUpgradeProperty(player.id, roomCode.toUpperCase(), cellId);
    });
  });

  socket.on("property:buyout", async ({ roomCode, cellId }: { roomCode: string; cellId: number }) => {
    await execute(async () => {
      await commandBuyout(player.id, roomCode.toUpperCase(), cellId);
    });
  });

  socket.on("property:sell", async ({ roomCode, cellId }: { roomCode: string; cellId: number }) => {
    await execute(async () => {
      await commandSell(player.id, roomCode.toUpperCase(), cellId);
    });
  });

  socket.on("shield:place", async ({ roomCode, cellId }: { roomCode: string; cellId: number }) => {
    await execute(async () => {
      await commandPlaceShield(player.id, roomCode.toUpperCase(), cellId);
    });
  });

  socket.on("jail:pay", async (roomCode: string) => {
    await execute(async () => {
      await commandJailPay(player.id, roomCode.toUpperCase());
    });
  });

  socket.on("jail:roll", async (roomCode: string) => {
    await execute(async () => {
      await commandJailRoll(player.id, roomCode.toUpperCase());
    });
  });

  socket.on("jail:use_card", async (roomCode: string) => {
    await execute(async () => {
      await commandJailUseCard(player.id, roomCode.toUpperCase());
    });
  });

  socket.on("card:draw", async (roomCode: string) => {
    await execute(async () => {
      await commandCardDraw(player.id, roomCode.toUpperCase());
    });
  });

  socket.on("trade:create", async ({ roomCode, tradeData }: { roomCode: string; tradeData: any }) => {
    await execute(async () => {
      await commandTradeCreate(player.id, roomCode.toUpperCase(), tradeData);
    });
  });

  socket.on("trade:accept", async ({ roomCode, tradeId }: { roomCode: string; tradeId: string }) => {
    await execute(async () => {
      await commandTradeAccept(player.id, roomCode.toUpperCase(), tradeId);
    });
  });

  socket.on("trade:reject", async ({ roomCode, tradeId }: { roomCode: string; tradeId: string }) => {
    await execute(async () => {
      await commandTradeReject(player.id, roomCode.toUpperCase(), tradeId);
    });
  });

  socket.on("trade:counter", async ({ roomCode, tradeId, counterOffer }: { roomCode: string; tradeId: string; counterOffer: any }) => {
    await execute(async () => {
      await commandTradeCounter(player.id, roomCode.toUpperCase(), tradeId, counterOffer);
    });
  });

  socket.on("trade:cancel", async ({ roomCode, tradeId }: { roomCode: string; tradeId: string }) => {
    await execute(async () => {
      await commandTradeCancel(player.id, roomCode.toUpperCase(), tradeId);
    });
  });
});

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started on http://localhost:${config.port}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
