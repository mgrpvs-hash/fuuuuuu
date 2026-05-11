import { Server } from "socket.io";
import { roomManager } from "./game/roomManager";

function emitRoomUpdate(io: Server, code: string) {
  const room = roomManager.getRoom(code);
  const game = roomManager.getGame(code);
  io.to(code.toUpperCase()).emit("game:update", { room, game });
}

function emitError(io: Server, socketId: string, message: string) {
  io.to(socketId).emit("game:error", { message });
}

export function registerSocket(io: Server) {
  io.on("connection", (socket) => {
    socket.on("room:join", async (payload) => {
      try {
        const room = await roomManager.joinRoom({
          code: payload.roomCode,
          playerId: payload.playerId,
          playerName: payload.playerName,
          avatarUrl: payload.avatarUrl
        });
        socket.data.roomCode = room.code;
        socket.data.playerId = payload.playerId;
        socket.join(room.code);
        emitRoomUpdate(io, room.code);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("game:start", async ({ roomCode, playerId }) => {
      try {
        await roomManager.startRoom(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("dice:roll", ({ roomCode, playerId }) => {
      try {
        roomManager.rollDice(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("turn:end", ({ roomCode, playerId }) => {
      try {
        roomManager.endTurn(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("property:buy", ({ roomCode, playerId }) => {
      try {
        roomManager.buyProperty(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("property:upgrade", ({ roomCode, playerId, cellIndex }) => {
      try {
        roomManager.upgradeProperty(roomCode, playerId, cellIndex);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("property:buyout", ({ roomCode, playerId }) => {
      try {
        roomManager.buyoutProperty(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("property:sell", ({ roomCode, playerId, cellIndex }) => {
      try {
        roomManager.sellProperty(roomCode, playerId, cellIndex);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("shield:place", ({ roomCode, playerId, cellIndex }) => {
      try {
        roomManager.placeShield(roomCode, playerId, cellIndex);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("jail:pay", ({ roomCode, playerId }) => {
      try {
        roomManager.jailPay(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("jail:roll", ({ roomCode, playerId }) => {
      try {
        roomManager.jailRoll(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("jail:use_card", ({ roomCode, playerId }) => {
      try {
        roomManager.jailUseCard(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("card:draw", ({ roomCode, playerId }) => {
      try {
        roomManager.drawCard(roomCode, playerId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("trade:create", ({ roomCode, playerId, trade }) => {
      try {
        roomManager.createTrade(roomCode, playerId, trade);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("trade:accept", ({ roomCode, playerId, tradeId }) => {
      try {
        roomManager.acceptTrade(roomCode, playerId, tradeId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("trade:reject", ({ roomCode, playerId, tradeId }) => {
      try {
        roomManager.rejectTrade(roomCode, playerId, tradeId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("trade:counter", ({ roomCode, playerId, tradeId, trade }) => {
      try {
        roomManager.counterTrade(roomCode, playerId, tradeId, trade);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("trade:cancel", ({ roomCode, playerId, tradeId }) => {
      try {
        roomManager.cancelTrade(roomCode, playerId, tradeId);
        emitRoomUpdate(io, roomCode);
      } catch (error) {
        emitError(io, socket.id, (error as Error).message);
      }
    });

    socket.on("disconnect", () => {
      if (socket.data.roomCode && socket.data.playerId) {
        roomManager.setConnected(socket.data.roomCode, socket.data.playerId, false);
      }
    });
  });
}
