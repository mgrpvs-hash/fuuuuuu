import "dotenv/config";
import http from "node:http";
import cors from "cors";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { Server } from "socket.io";
import { z } from "zod";
import { boardPath } from "@monopoly/shared";
import { GameEngine } from "./game/gameEngine";

const prisma = new PrismaClient();
const engine = new GameEngine(prisma);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "up" });
});

app.get("/board", (_req, res) => {
  res.json(boardPath);
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const playerBySocket = new Map<string, string>();

const joinSchema = z.object({
  name: z.string().min(1).max(24),
});

const playerActionSchema = z.object({
  playerId: z.string().uuid(),
});

const tradeRequestSchema = z.object({
  playerId: z.string().uuid(),
  targetPlayerId: z.string().uuid(),
  offeredPropertyIds: z.array(z.string()),
  requestedPropertyIds: z.array(z.string()),
  offeredMoney: z.number().int().nonnegative(),
  requestedMoney: z.number().int().nonnegative(),
});

const tradeResponseSchema = z.object({
  playerId: z.string().uuid(),
  accept: z.boolean(),
});

const wrap = (socketId: string, fn: () => Promise<void> | void) => {
  Promise.resolve(fn())
    .then(() => {
      io.emit("game:state", engine.getState());
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      io.to(socketId).emit("game:error", { message });
    });
};

io.on("connection", (socket) => {
  socket.emit("game:state", engine.getState());

  socket.on("player:join", (payload) => {
    wrap(socket.id, () => {
      const data = joinSchema.parse(payload);
      const player = engine.addPlayer(socket.id, data.name);
      playerBySocket.set(socket.id, player.id);
      io.to(socket.id).emit("player:joined", { playerId: player.id });
    });
  });

  socket.on("game:start", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.startGame(data.playerId);
    });
  });

  socket.on("game:reset", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.resetGame(data.playerId);
    });
  });

  socket.on("turn:roll", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.rollDice(data.playerId);
    });
  });

  socket.on("turn:end", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.endTurn(data.playerId);
    });
  });

  socket.on("property:buy", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.buyProperty(data.playerId);
    });
  });

  socket.on("property:upgrade", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.upgradeProperty(data.playerId);
    });
  });

  socket.on("property:buyout", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.buyoutProperty(data.playerId);
    });
  });

  socket.on("action:skip", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.skipAction(data.playerId);
    });
  });

  socket.on("jail:pay", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.payToLeaveJail(data.playerId);
    });
  });

  socket.on("jail:card", (payload) => {
    wrap(socket.id, () => {
      const data = playerActionSchema.parse(payload);
      engine.useJailCard(data.playerId);
    });
  });

  socket.on("trade:request", (payload) => {
    wrap(socket.id, () => {
      const data = tradeRequestSchema.parse(payload);
      engine.requestTrade(data.playerId, {
        toPlayerId: data.targetPlayerId,
        offeredPropertyIds: data.offeredPropertyIds,
        requestedPropertyIds: data.requestedPropertyIds,
        offeredMoney: data.offeredMoney,
        requestedMoney: data.requestedMoney,
      });
    });
  });

  socket.on("trade:respond", (payload) => {
    wrap(socket.id, () => {
      const data = tradeResponseSchema.parse(payload);
      engine.respondTrade(data.playerId, data.accept);
    });
  });

  socket.on("leaderboard:refresh", () => {
    wrap(socket.id, async () => {
      await engine.refreshLeaderboard();
    });
  });

  socket.on("disconnect", () => {
    wrap(socket.id, () => {
      playerBySocket.delete(socket.id);
      engine.removePlayerBySocket(socket.id);
    });
  });
});

const port = Number(process.env.PORT ?? 3001);

void engine
  .init()
  .then(() => {
    httpServer.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", error);
    process.exit(1);
  });
