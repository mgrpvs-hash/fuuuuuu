import {
  MAX_ROUNDS,
  alivePlayers,
  boardPath,
  buildInitialCells,
  chanceCards,
  getBuyoutPrice,
  getPropertyPrice,
  getRentAmount,
  getSellPrice,
  getUpgradeCost,
  hasFullColorGroup,
  isPurchasableCell,
  jailPenalty,
  scaledTax,
  type BoardCellState,
  type ChanceCard,
  type GameEndedPayload,
  type GameResultPlayer,
  type GameState,
  type LeaderboardEntry,
  type RoomDetails,
  type RoomSummary,
  type RuntimePlayer,
  type SessionPlayer,
  type TradeOffer
} from "@monopoly/shared";
import { prisma } from "./db";

interface RuntimeRoom {
  code: string;
  hostId: string;
  entryFee: number;
  maxPlayers: number;
  status: "lobby" | "playing" | "finished";
  players: SessionPlayer[];
  game: GameState | null;
}

type EmitFn = (roomCode: string, event: string, payload: unknown) => void;

class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const randomItem = <T>(list: T[]): T | null => {
  if (!list.length) {
    return null;
  }
  return list[Math.floor(Math.random() * list.length)];
};

const roomByCode = new Map<string, RuntimeRoom>();
const playerRoom = new Map<string, string>();

let emitFn: EmitFn = () => undefined;

const logEvent = (game: GameState, message: string) => {
  game.recentEvent = message;
  game.eventLog.unshift(message);
  if (game.eventLog.length > 120) {
    game.eventLog.length = 120;
  }
};

const genRoomCode = (): string => {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const size = 5;
  let code = "";
  for (let i = 0; i < size; i += 1) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
};

const ensureCurrentRoom = (roomCode: string): RuntimeRoom => {
  const room = roomByCode.get(roomCode);
  if (!room) {
    throw new AppError("Комната не найдена", 404);
  }
  return room;
};

const findPlayer = (game: GameState, playerId: string): RuntimePlayer => {
  const player = game.players.find((item) => item.id === playerId);
  if (!player) {
    throw new AppError("Игрок не найден в игре", 404);
  }
  return player;
};

const findCurrentPlayer = (game: GameState): RuntimePlayer => findPlayer(game, game.currentPlayerId);

const ensureTurnPlayer = (game: GameState, playerId: string): RuntimePlayer => {
  const player = findPlayer(game, playerId);
  if (game.currentPlayerId !== playerId) {
    throw new AppError("Сейчас не ваш ход", 400);
  }
  if (player.bankrupt) {
    throw new AppError("Банкрот не может делать ходы", 400);
  }
  return player;
};

const getCell = (game: GameState, cellId: number): BoardCellState => {
  const cell = game.cells.find((c) => c.id === cellId);
  if (!cell) {
    throw new AppError("Клетка не найдена", 404);
  }
  return cell;
};

const hasAnyProperty = (game: GameState, playerId: string): boolean =>
  game.cells.some((cell) => cell.ownerId === playerId);

const releasePlayerAssets = (game: GameState, playerId: string) => {
  game.cells.forEach((cell) => {
    if (cell.ownerId === playerId) {
      cell.ownerId = null;
      cell.upgradeLevel = 0;
      cell.shield = false;
      cell.frozenTurns = 0;
    }
  });
};

const markDebtState = (game: GameState, player: RuntimePlayer) => {
  if (player.balance < 0) {
    player.inDebt = true;
    if (!hasAnyProperty(game, player.id)) {
      player.bankrupt = true;
      player.inDebt = false;
      releasePlayerAssets(game, player.id);
      logEvent(game, `${player.name} обанкротился`);
    }
  } else {
    player.inDebt = false;
  }
};

const getPlayerCell = (game: GameState, player: RuntimePlayer): BoardCellState => getCell(game, player.position);

const ensurePlayerCanPay = (player: RuntimePlayer, amount: number, message = "Недостаточно средств") => {
  if (player.balance < amount) {
    throw new AppError(message);
  }
};

const moveToJail = (game: GameState, player: RuntimePlayer) => {
  player.position = 10;
  player.inJail = true;
  player.jailTurns = 0;
  player.canRollAgain = false;
  player.doublesCount = 0;
  logEvent(game, `${player.name} отправляется в тюрьму`);
};

const rollDice = () => {
  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  return {
    die1,
    die2,
    total: die1 + die2,
    isDouble: die1 === die2
  };
};

const reduceTurnBuffs = (player: RuntimePlayer) => {
  if (player.skipTurns > 0) {
    player.skipTurns -= 1;
  }
  if (player.cannotUpgradeTurns > 0) {
    player.cannotUpgradeTurns -= 1;
  }
  if (player.x2RentTurns > 0) {
    player.x2RentTurns -= 1;
  }
};

const executeTransfer = (from: RuntimePlayer, to: RuntimePlayer, amount: number) => {
  if (amount <= 0) {
    return;
  }
  from.balance -= amount;
  to.balance += amount;
};

const pickRandomOwnedCell = (game: GameState, ownerId: string): BoardCellState | null => {
  const list = game.cells.filter((cell) => cell.ownerId === ownerId);
  return randomItem(list);
};

const pickRandomEnemyCell = (game: GameState, ownerId: string): BoardCellState | null => {
  const list = game.cells.filter((cell) => cell.ownerId && cell.ownerId !== ownerId);
  return randomItem(list);
};

const pickRichestEnemy = (game: GameState, playerId: string): RuntimePlayer | null => {
  const enemies = game.players.filter((p) => !p.bankrupt && p.id !== playerId);
  enemies.sort((a, b) => b.balance - a.balance);
  return enemies[0] || null;
};

const applyChanceCard = (game: GameState, player: RuntimePlayer, room: RuntimeRoom): string => {
  const card = randomItem(chanceCards) as ChanceCard;
  let message = `${player.name} вытянул карту "${card.label}"`;
  const enemies = game.players.filter((p) => p.id !== player.id && !p.bankrupt);

  switch (card.effect) {
    case "money_minus_100":
      player.balance -= 100;
      break;
    case "money_minus_150":
      player.balance -= 150;
      break;
    case "money_minus_200":
      player.balance -= 200;
      break;
    case "pay_each_50":
      enemies.forEach((enemy) => executeTransfer(player, enemy, 50));
      break;
    case "pay_richest_150": {
      const richest = pickRichestEnemy(game, player.id);
      if (richest) {
        executeTransfer(player, richest, 150);
      }
      break;
    }
    case "skip_turn":
      player.skipTurns += 1;
      break;
    case "downgrade_random_own": {
      const cell = pickRandomOwnedCell(game, player.id);
      if (cell && cell.upgradeLevel > 0) {
        cell.upgradeLevel -= 1;
      }
      break;
    }
    case "reset_random_own": {
      const cell = pickRandomOwnedCell(game, player.id);
      if (cell) {
        cell.upgradeLevel = 0;
      }
      break;
    }
    case "lose_random_shield": {
      const cells = game.cells.filter((c) => c.ownerId === player.id && c.shield);
      const target = randomItem(cells);
      if (target) {
        target.shield = false;
      }
      break;
    }
    case "go_to_jail":
      moveToJail(game, player);
      break;
    case "no_upgrade_2_turns":
      player.cannotUpgradeTurns = Math.max(player.cannotUpgradeTurns, 2);
      break;
    case "repair_tax": {
      const buildings = game.cells
        .filter((c) => c.ownerId === player.id)
        .reduce((acc, cell) => acc + cell.upgradeLevel, 0);
      const tax = Math.round(100 * buildings);
      player.balance -= tax;
      message += `, налог ${tax} 🪙`;
      break;
    }
    case "steal_100_from_richest": {
      const richest = pickRichestEnemy(game, player.id);
      if (richest) {
        executeTransfer(richest, player, 100);
      }
      break;
    }
    case "all_pay_you_50":
      enemies.forEach((enemy) => executeTransfer(enemy, player, 50));
      break;
    case "swap_random_property": {
      const mine = pickRandomOwnedCell(game, player.id);
      const enemy = pickRandomEnemyCell(game, player.id);
      if (mine && enemy && !mine.shield && !enemy.shield) {
        const owner = enemy.ownerId;
        enemy.ownerId = player.id;
        mine.ownerId = owner;
      }
      break;
    }
    case "steal_random_property": {
      const enemy = pickRandomEnemyCell(game, player.id);
      if (enemy) {
        if (enemy.shield) {
          enemy.shield = false;
          message += ", щит заблокировал кражу";
        } else {
          enemy.ownerId = player.id;
        }
      }
      break;
    }
    case "downgrade_random_enemy": {
      const enemy = pickRandomEnemyCell(game, player.id);
      if (enemy && enemy.upgradeLevel > 0) {
        enemy.upgradeLevel -= 1;
      }
      break;
    }
    case "delete_random_enemy_property": {
      const enemy = pickRandomEnemyCell(game, player.id);
      if (enemy) {
        enemy.ownerId = null;
        enemy.upgradeLevel = 0;
        enemy.shield = false;
      }
      break;
    }
    case "remove_enemy_shield": {
      const shielded = game.cells.filter((c) => c.ownerId !== player.id && c.ownerId && c.shield);
      const target = randomItem(shielded);
      if (target) {
        target.shield = false;
      }
      break;
    }
    case "freeze_enemy_property": {
      const enemy = pickRandomEnemyCell(game, player.id);
      if (enemy) {
        enemy.frozenTurns = 2;
      }
      break;
    }
    case "teleport_random":
      player.position = Math.floor(Math.random() * boardPath.length);
      break;
    case "teleport_to_own": {
      const mine = pickRandomOwnedCell(game, player.id);
      if (mine) {
        player.position = mine.id;
      }
      break;
    }
    case "x2_rent_3_turns":
      player.x2RentTurns = 3;
      break;
    case "money_plus_100":
      player.balance += 100;
      break;
    case "money_plus_150":
      player.balance += 150;
      break;
    case "money_plus_200":
      player.balance += 200;
      break;
    case "gain_shield":
      player.pendingShields += 1;
      break;
    case "free_upgrade": {
      const mine = pickRandomOwnedCell(game, player.id);
      if (mine && mine.upgradeLevel < 5) {
        mine.upgradeLevel += 1;
      }
      break;
    }
    case "jail_free_card":
      player.jailFreeCards += 1;
      break;
    case "buyout_discount":
      player.buyoutDiscount = true;
      break;
    default:
      break;
  }

  markDebtState(game, player);
  logEvent(game, message);
  // keep runtime room reference usage explicit for future extensions
  void room;
  return card.id;
};

const advanceTurn = (room: RuntimeRoom) => {
  const game = room.game;
  if (!game) {
    return;
  }

  const alive = alivePlayers(game.players);
  if (alive.length <= 1) {
    return;
  }

  let idx = game.players.findIndex((p) => p.id === game.currentPlayerId);
  const initial = idx;

  do {
    idx = (idx + 1) % game.players.length;
    const next = game.players[idx];
    if (!next.bankrupt) {
      game.currentPlayerId = next.id;
      if (idx <= initial) {
        game.round += 1;
        game.cells.forEach((cell) => {
          if (cell.frozenTurns > 0) {
            cell.frozenTurns -= 1;
          }
        });
      }
      if (next.skipTurns > 0) {
        next.skipTurns -= 1;
        logEvent(game, `${next.name} пропускает ход`);
        continue;
      }
      break;
    }
  } while (idx !== initial);
};

const finalizeGame = async (room: RuntimeRoom) => {
  const game = room.game;
  if (!game || game.status === "finished") {
    return;
  }
  game.status = "finished";
  room.status = "finished";

  const sorted = [...game.players].sort((a, b) => b.balance - a.balance);
  const winner = sorted[0];
  game.winnerId = winner.id;

  const results: GameResultPlayer[] = sorted.map((player, index) => ({
    playerId: player.id,
    playerName: player.name,
    place: index + 1,
    prizeWon: player.id === winner.id ? game.prizePool : 0,
    balance: player.balance
  }));

  await prisma.room.update({
    where: { code: room.code },
    data: {
      status: "finished",
      gameState: game as unknown as object
    }
  });

  await Promise.all(
    results.map(async (result) => {
      const profit = Math.max(0, result.prizeWon - room.entryFee);
      await prisma.player.update({
        where: { id: result.playerId },
        data: {
          gamesPlayed: { increment: 1 },
          wins: result.place === 1 ? { increment: 1 } : undefined,
          losses: result.place === 1 ? undefined : { increment: 1 },
          totalProfit: { increment: profit },
          bestWin: undefined
        }
      });

      const current = await prisma.player.findUnique({ where: { id: result.playerId } });
      if (current) {
        await prisma.player.update({
          where: { id: result.playerId },
          data: {
            bestWin: Math.max(current.bestWin, result.prizeWon - room.entryFee),
            balance: result.place === 1 ? { increment: result.prizeWon } : undefined
          }
        });
      }
    })
  );

  const payload: GameEndedPayload = {
    roomCode: room.code,
    winnerId: winner.id,
    prizePool: game.prizePool,
    results
  };

  emitFn(room.code, "game:ended", payload);
  emitFn(room.code, "game:update", game);
};

const checkAndFinalizeIfNeeded = async (room: RuntimeRoom) => {
  const game = room.game;
  if (!game || game.status === "finished") {
    return;
  }
  const alive = alivePlayers(game.players);
  if (alive.length <= 1 || game.round > game.maxRounds) {
    await finalizeGame(room);
  }
};

const applyLanding = (room: RuntimeRoom, player: RuntimePlayer) => {
  const game = room.game;
  if (!game) {
    return;
  }
  const cell = getPlayerCell(game, player);

  if (cell.type === "go_to_jail") {
    moveToJail(game, player);
    return;
  }

  if (cell.type === "tax") {
    const taxAmount = scaledTax(cell.baseAmount, game.entryFee);
    player.balance -= taxAmount;
    logEvent(game, `${player.name} заплатил налог ${taxAmount} 🪙`);
    markDebtState(game, player);
    return;
  }

  if (cell.type === "chance") {
    applyChanceCard(game, player, room);
    return;
  }

  if (isPurchasableCell(cell.type)) {
    if (!cell.ownerId) {
      logEvent(game, `${player.name} может купить ${cell.displayName}`);
      return;
    }

    if (cell.ownerId === player.id) {
      logEvent(game, `${player.name} стоит на своей клетке ${cell.displayName}`);
      return;
    }

    if (cell.frozenTurns > 0) {
      logEvent(game, `${cell.displayName} заморожена и не приносит аренду`);
      return;
    }

    const owner = findPlayer(game, cell.ownerId);
    if (owner.bankrupt) {
      return;
    }

    const baseRent = getRentAmount(cell, game.entryFee, hasFullColorGroup(owner.id, cell, game.cells));
    const rent = owner.x2RentTurns > 0 ? baseRent * 2 : baseRent;
    player.balance -= rent;
    owner.balance += rent;
    logEvent(game, `${player.name} заплатил аренду ${rent} 🪙 игроку ${owner.name}`);
    markDebtState(game, player);
  }
};

const buildRoomDetails = (room: RuntimeRoom): RoomDetails => ({
  code: room.code,
  hostId: room.hostId,
  hostName: room.players.find((p) => p.id === room.hostId)?.name || "—",
  entryFee: room.entryFee,
  maxPlayers: room.maxPlayers,
  playersCount: room.players.length,
  status: room.status,
  players: room.players.map((player) => ({ ...player, isHost: player.id === room.hostId }))
});

const emitGameUpdate = (room: RuntimeRoom) => {
  if (room.game) {
    emitFn(room.code, "game:update", room.game);
  }
};

export const setRoomEmitter = (fn: EmitFn) => {
  emitFn = fn;
};

export const attachPlayerToSocketRoom = (roomCode: string) => {
  const room = roomByCode.get(roomCode);
  if (!room) {
    throw new AppError("Комната не найдена", 404);
  }
  return room;
};

export const createRoom = async (player: SessionPlayer, entryFee: number, maxPlayers: number): Promise<RoomDetails> => {
  if (playerRoom.has(player.id)) {
    throw new AppError("Игрок уже находится в комнате");
  }
  if (entryFee < 100 || entryFee % 100 !== 0) {
    throw new AppError("Ставка должна быть >= 100 и кратной 100");
  }
  if (maxPlayers < 2 || maxPlayers > 6) {
    throw new AppError("Максимум игроков: 2-6");
  }

  const charged = await prisma.player.updateMany({
    where: { id: player.id, balance: { gte: entryFee } },
    data: { balance: { decrement: entryFee } }
  });
  if (charged.count === 0) {
    throw new AppError("Недостаточно баланса для создания комнаты");
  }

  let code = genRoomCode();
  while (roomByCode.has(code)) {
    code = genRoomCode();
  }

  await prisma.room.create({
    data: {
      code,
      hostId: player.id,
      entryFee,
      maxPlayers,
      status: "lobby"
    }
  });

  const room: RuntimeRoom = {
    code,
    hostId: player.id,
    entryFee,
    maxPlayers,
    status: "lobby",
    players: [player],
    game: null
  };

  roomByCode.set(code, room);
  playerRoom.set(player.id, code);
  return buildRoomDetails(room);
};

export const joinRoom = async (player: SessionPlayer, roomCode: string): Promise<RoomDetails> => {
  if (playerRoom.has(player.id)) {
    throw new AppError("Игрок уже находится в комнате");
  }
  const room = ensureCurrentRoom(roomCode);
  if (room.status !== "lobby") {
    throw new AppError("Комната уже в игре");
  }
  if (room.players.length >= room.maxPlayers) {
    throw new AppError("Комната заполнена");
  }

  const charged = await prisma.player.updateMany({
    where: { id: player.id, balance: { gte: room.entryFee } },
    data: { balance: { decrement: room.entryFee } }
  });
  if (charged.count === 0) {
    throw new AppError("Недостаточно баланса для входа в комнату");
  }

  room.players.push(player);
  playerRoom.set(player.id, roomCode);
  emitFn(roomCode, "room:update", buildRoomDetails(room));
  return buildRoomDetails(room);
};

export const leaveRoom = async (playerId: string, roomCode: string): Promise<{ status: string }> => {
  const room = ensureCurrentRoom(roomCode);
  const index = room.players.findIndex((item) => item.id === playerId);
  if (index === -1) {
    throw new AppError("Игрок не в комнате");
  }
  if (room.status !== "lobby") {
    throw new AppError("Нельзя покинуть комнату после старта игры");
  }

  room.players.splice(index, 1);
  playerRoom.delete(playerId);
  await prisma.player.update({
    where: { id: playerId },
    data: { balance: { increment: room.entryFee } }
  });

  if (!room.players.length) {
    roomByCode.delete(roomCode);
    await prisma.room.delete({ where: { code: roomCode } });
    return { status: "deleted" };
  }

  if (room.hostId === playerId) {
    room.hostId = room.players[0].id;
    await prisma.room.update({ where: { code: roomCode }, data: { hostId: room.hostId } });
  }

  emitFn(roomCode, "room:update", buildRoomDetails(room));
  return { status: "left" };
};

export const startGame = async (playerId: string, roomCode: string): Promise<GameState> => {
  const room = ensureCurrentRoom(roomCode);
  if (room.hostId !== playerId) {
    throw new AppError("Только хост может начать игру");
  }
  if (room.status !== "lobby") {
    throw new AppError("Игра уже началась");
  }
  if (room.players.length < 2) {
    throw new AppError("Для старта нужно минимум 2 игрока");
  }

  room.status = "playing";

  const game: GameState = {
    roomCode,
    entryFee: room.entryFee,
    prizePool: room.entryFee * room.players.length,
    status: "playing",
    players: room.players.map((player) => ({
      ...player,
      balance: room.entryFee,
      position: 0,
      inJail: false,
      jailTurns: 0,
      bankrupt: false,
      inDebt: false,
      hasRolledThisTurn: false,
      doublesCount: 0,
      canRollAgain: false,
      skipTurns: 0,
      jailFreeCards: 0,
      buyoutDiscount: false,
      pendingShields: 0,
      cannotUpgradeTurns: 0,
      x2RentTurns: 0
    })),
    cells: buildInitialCells(),
    currentPlayerId: room.players[0].id,
    round: 1,
    maxRounds: MAX_ROUNDS,
    recentEvent: "Игра началась",
    eventLog: ["Игра началась"],
    winnerId: null,
    pendingTradeOffers: []
  };

  room.game = game;

  await prisma.room.update({
    where: { code: roomCode },
    data: {
      status: "playing",
      gameState: game as unknown as object
    }
  });

  emitFn(roomCode, "game:start", { roomCode });
  emitFn(roomCode, "game:update", game);
  return game;
};

export const listLobbyRooms = (): RoomSummary[] => {
  return Array.from(roomByCode.values())
    .filter((room) => room.status === "lobby")
    .map((room) => ({
      code: room.code,
      hostId: room.hostId,
      hostName: room.players.find((p) => p.id === room.hostId)?.name || "—",
      entryFee: room.entryFee,
      maxPlayers: room.maxPlayers,
      playersCount: room.players.length,
      status: room.status
    }));
};

export const getRoomInfo = (roomCode: string): RoomDetails => {
  const room = ensureCurrentRoom(roomCode);
  return buildRoomDetails(room);
};

export const getPlayerRoom = (playerId: string): string | null => playerRoom.get(playerId) || null;

export const getLeaderboard = async (): Promise<{ wins: LeaderboardEntry[]; totalProfit: LeaderboardEntry[] }> => {
  const byWins = await prisma.player.findMany({
    orderBy: [{ wins: "desc" }, { totalProfit: "desc" }],
    take: 50
  });
  const byProfit = await prisma.player.findMany({
    orderBy: [{ totalProfit: "desc" }, { wins: "desc" }],
    take: 50
  });

  const mapEntry = (player: (typeof byWins)[number]): LeaderboardEntry => ({
    playerId: player.id,
    name: player.name,
    avatar: player.avatar,
    wins: player.wins,
    totalProfit: player.totalProfit
  });

  return {
    wins: byWins.map(mapEntry),
    totalProfit: byProfit.map(mapEntry)
  };
};

const updateAfterAction = async (room: RuntimeRoom) => {
  emitGameUpdate(room);
  await checkAndFinalizeIfNeeded(room);
};

export const commandRollDice = async (playerId: string, roomCode: string) => {
  const room = ensureCurrentRoom(roomCode);
  if (!room.game) {
    throw new AppError("Игра не началась");
  }

  const game = room.game;
  const player = ensureTurnPlayer(game, playerId);

  if (player.inDebt) {
    throw new AppError("Погасите долг перед продолжением");
  }
  if (player.inJail) {
    throw new AppError("Сначала выберите действие для выхода из тюрьмы");
  }
  if (player.hasRolledThisTurn && !player.canRollAgain) {
    throw new AppError("Вы уже бросали кубики");
  }

  const dice = rollDice();
  player.hasRolledThisTurn = true;
  player.canRollAgain = false;

  if (dice.isDouble) {
    player.doublesCount += 1;
  } else {
    player.doublesCount = 0;
  }

  if (player.doublesCount >= 3) {
    moveToJail(game, player);
    player.hasRolledThisTurn = true;
    emitFn(roomCode, "dice:result", dice);
    await updateAfterAction(room);
    return;
  }

  const prevPosition = player.position;
  player.position = (player.position + dice.total) % boardPath.length;

  if (player.position < prevPosition) {
    const bonus = Math.round(room.entryFee * 0.1);
    player.balance += bonus;
    logEvent(game, `${player.name} прошел Старт и получил ${bonus} 🪙`);
  }

  if (dice.isDouble) {
    player.canRollAgain = true;
  }

  applyLanding(room, player);
  emitFn(roomCode, "dice:result", dice);
  await updateAfterAction(room);
};

export const commandEndTurn = async (playerId: string, roomCode: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);

  if (player.inDebt) {
    throw new AppError("Игрок в долгу и не может завершить ход");
  }
  if (!player.hasRolledThisTurn && !player.inJail) {
    throw new AppError("Сначала бросьте кубики");
  }

  player.hasRolledThisTurn = false;
  player.canRollAgain = false;
  player.doublesCount = 0;
  reduceTurnBuffs(player);

  advanceTurn(room);
  emitFn(roomCode, "turn:changed", { currentPlayerId: room.game?.currentPlayerId });
  await updateAfterAction(room);
};

export const commandBuyProperty = async (playerId: string, roomCode: string, cellId: number) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  if (player.inDebt) {
    throw new AppError("В долгу можно только продавать");
  }
  const cell = getCell(game, cellId);
  if (!isPurchasableCell(cell.type)) {
    throw new AppError("Эту клетку нельзя купить");
  }
  if (player.position !== cellId) {
    throw new AppError("Вы должны стоять на этой клетке");
  }
  if (cell.ownerId) {
    throw new AppError("Клетка уже имеет владельца");
  }

  const price = getPropertyPrice(cell.id, room.entryFee);
  ensurePlayerCanPay(player, price, "Недостаточно средств для покупки");
  player.balance -= price;
  cell.ownerId = player.id;
  logEvent(game, `${player.name} купил ${cell.displayName} за ${price} 🪙`);
  await updateAfterAction(room);
};

export const commandUpgradeProperty = async (playerId: string, roomCode: string, cellId: number) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  if (player.inDebt) {
    throw new AppError("В долгу запрещено улучшение");
  }
  if (player.cannotUpgradeTurns > 0) {
    throw new AppError("Улучшения временно заблокированы");
  }
  const cell = getCell(game, cellId);
  if (!isPurchasableCell(cell.type) || cell.type !== "property") {
    throw new AppError("Улучшать можно только улицы");
  }
  if (player.position !== cell.id) {
    throw new AppError("Нужно стоять на этой клетке");
  }
  if (cell.ownerId !== player.id) {
    throw new AppError("Это не ваша улица");
  }
  if (cell.upgradeLevel >= 5) {
    throw new AppError("Достигнут максимальный уровень");
  }

  const cost = getUpgradeCost(cell, room.entryFee);
  ensurePlayerCanPay(player, cost, "Недостаточно средств для улучшения");
  player.balance -= cost;
  cell.upgradeLevel += 1;
  logEvent(game, `${player.name} улучшил ${cell.displayName} до уровня ${cell.upgradeLevel}`);
  await updateAfterAction(room);
};

export const commandBuyout = async (playerId: string, roomCode: string, cellId: number) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  if (player.inDebt) {
    throw new AppError("В долгу выкуп запрещен");
  }
  const cell = getCell(game, cellId);
  if (!isPurchasableCell(cell.type) || !cell.ownerId || cell.ownerId === player.id) {
    throw new AppError("Невозможно выполнить выкуп");
  }
  if (player.position !== cell.id) {
    throw new AppError("Выкуп доступен только на текущей клетке");
  }

  if (cell.shield) {
    cell.shield = false;
    logEvent(game, "Щит защитил улицу от выкупа");
    await updateAfterAction(room);
    return;
  }

  const owner = findPlayer(game, cell.ownerId);
  let price = getBuyoutPrice(cell, room.entryFee);
  if (player.buyoutDiscount) {
    price = Math.round(price * 0.5);
    player.buyoutDiscount = false;
  }
  ensurePlayerCanPay(player, price, "Недостаточно средств для выкупа");

  player.balance -= price;
  owner.balance += price;
  cell.ownerId = player.id;
  logEvent(game, `${player.name} выкупил ${cell.displayName} за ${price} 🪙`);
  await updateAfterAction(room);
};

export const commandSell = async (playerId: string, roomCode: string, cellId: number) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = findPlayer(game, playerId);
  if (player.bankrupt) {
    throw new AppError("Банкрот не может продавать");
  }
  const cell = getCell(game, cellId);
  if (cell.ownerId !== player.id) {
    throw new AppError("Это не ваша клетка");
  }

  const income = getSellPrice(cell, room.entryFee);
  player.balance += income;
  cell.ownerId = null;
  cell.upgradeLevel = 0;
  cell.shield = false;
  cell.frozenTurns = 0;
  logEvent(game, `${player.name} продал ${cell.displayName} за ${income} 🪙`);
  markDebtState(game, player);
  await updateAfterAction(room);
};

export const commandPlaceShield = async (playerId: string, roomCode: string, cellId: number) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  if (player.pendingShields <= 0) {
    throw new AppError("Нет доступных щитов");
  }
  const cell = getCell(game, cellId);
  if (cell.ownerId !== player.id) {
    throw new AppError("Можно защитить только свою клетку");
  }
  if (cell.shield) {
    throw new AppError("На клетке уже есть щит");
  }

  cell.shield = true;
  player.pendingShields -= 1;
  logEvent(game, `${player.name} поставил щит на ${cell.displayName}`);
  await updateAfterAction(room);
};

export const commandJailPay = async (playerId: string, roomCode: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  if (!player.inJail) {
    throw new AppError("Игрок не в тюрьме");
  }
  const fine = jailPenalty(room.entryFee);
  ensurePlayerCanPay(player, fine, "Недостаточно средств для оплаты штрафа");
  player.balance -= fine;
  player.inJail = false;
  player.jailTurns = 0;
  logEvent(game, `${player.name} заплатил штраф ${fine} и вышел из тюрьмы`);
  await updateAfterAction(room);
};

export const commandJailRoll = async (playerId: string, roomCode: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  if (!player.inJail) {
    throw new AppError("Игрок не в тюрьме");
  }
  if (player.hasRolledThisTurn) {
    throw new AppError("Попытка уже сделана");
  }
  const dice = rollDice();
  player.hasRolledThisTurn = true;
  emitFn(roomCode, "dice:result", dice);
  if (dice.isDouble) {
    player.inJail = false;
    player.jailTurns = 0;
    player.position = (player.position + dice.total) % boardPath.length;
    logEvent(game, `${player.name} выбросил дубль и вышел из тюрьмы`);
    applyLanding(room, player);
  } else {
    player.jailTurns += 1;
    logEvent(game, `${player.name} не выбросил дубль и остался в тюрьме`);
  }
  await updateAfterAction(room);
};

export const commandJailUseCard = async (playerId: string, roomCode: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  if (!player.inJail) {
    throw new AppError("Игрок не в тюрьме");
  }
  if (player.jailFreeCards <= 0) {
    throw new AppError("Нет карты выхода из тюрьмы");
  }
  player.jailFreeCards -= 1;
  player.inJail = false;
  player.jailTurns = 0;
  logEvent(game, `${player.name} использовал карту выхода из тюрьмы`);
  await updateAfterAction(room);
};

export const commandCardDraw = async (playerId: string, roomCode: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const player = ensureTurnPlayer(game, playerId);
  applyChanceCard(game, player, room);
  await updateAfterAction(room);
};

export const commandTradeCreate = async (
  playerId: string,
  roomCode: string,
  offer: Omit<TradeOffer, "id" | "status" | "createdAt" | "fromPlayerId">
) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const sender = findPlayer(game, playerId);
  const recipient = findPlayer(game, offer.toPlayerId);
  if (sender.bankrupt || sender.inDebt || recipient.bankrupt || recipient.inDebt) {
    throw new AppError("Обмен недоступен, пока у игрока долг/банкротство");
  }

  const trade: TradeOffer = {
    id: `trade_${Math.random().toString(36).slice(2, 10)}`,
    fromPlayerId: sender.id,
    toPlayerId: recipient.id,
    fromCellIds: offer.fromCellIds,
    toCellIds: offer.toCellIds,
    fromCoins: offer.fromCoins,
    toCoins: offer.toCoins,
    status: "pending",
    createdAt: Date.now()
  };
  game.pendingTradeOffers.push(trade);
  logEvent(game, `${sender.name} отправил предложение обмена игроку ${recipient.name}`);
  emitFn(roomCode, "trade:incoming", trade);
  await updateAfterAction(room);
};

const validateTradeOwnershipAndBalance = (game: GameState, offer: TradeOffer) => {
  const sender = findPlayer(game, offer.fromPlayerId);
  const recipient = findPlayer(game, offer.toPlayerId);

  if (sender.balance < offer.fromCoins) {
    throw new AppError("У отправителя недостаточно монет");
  }
  if (recipient.balance < offer.toCoins) {
    throw new AppError("У получателя недостаточно монет");
  }

  offer.fromCellIds.forEach((cellId) => {
    const cell = getCell(game, cellId);
    if (cell.ownerId !== sender.id) {
      throw new AppError("Часть активов отправителя уже недоступна");
    }
  });
  offer.toCellIds.forEach((cellId) => {
    const cell = getCell(game, cellId);
    if (cell.ownerId !== recipient.id) {
      throw new AppError("Часть активов получателя уже недоступна");
    }
  });
};

export const commandTradeAccept = async (playerId: string, roomCode: string, tradeId: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const offer = game.pendingTradeOffers.find((item) => item.id === tradeId);
  if (!offer || offer.status !== "pending") {
    throw new AppError("Предложение обмена не найдено");
  }
  if (offer.toPlayerId !== playerId) {
    throw new AppError("Только получатель может принять предложение");
  }

  validateTradeOwnershipAndBalance(game, offer);

  const sender = findPlayer(game, offer.fromPlayerId);
  const recipient = findPlayer(game, offer.toPlayerId);

  offer.fromCellIds.forEach((cellId) => {
    const cell = getCell(game, cellId);
    cell.ownerId = recipient.id;
  });
  offer.toCellIds.forEach((cellId) => {
    const cell = getCell(game, cellId);
    cell.ownerId = sender.id;
  });

  sender.balance -= offer.fromCoins;
  recipient.balance += offer.fromCoins;
  recipient.balance -= offer.toCoins;
  sender.balance += offer.toCoins;

  offer.status = "accepted";
  logEvent(game, `Обмен между ${sender.name} и ${recipient.name} выполнен`);
  await updateAfterAction(room);
};

export const commandTradeReject = async (playerId: string, roomCode: string, tradeId: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const offer = game.pendingTradeOffers.find((item) => item.id === tradeId);
  if (!offer || offer.status !== "pending") {
    throw new AppError("Предложение не найдено");
  }
  if (offer.toPlayerId !== playerId) {
    throw new AppError("Только получатель может отклонить предложение");
  }
  offer.status = "rejected";
  logEvent(game, "Предложение обмена отклонено");
  await updateAfterAction(room);
};

export const commandTradeCancel = async (playerId: string, roomCode: string, tradeId: string) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const offer = game.pendingTradeOffers.find((item) => item.id === tradeId);
  if (!offer || offer.status !== "pending") {
    throw new AppError("Предложение не найдено");
  }
  if (offer.fromPlayerId !== playerId) {
    throw new AppError("Только отправитель может отменить предложение");
  }
  offer.status = "cancelled";
  logEvent(game, "Предложение обмена отменено");
  await updateAfterAction(room);
};

export const commandTradeCounter = async (
  playerId: string,
  roomCode: string,
  tradeId: string,
  counter: Omit<TradeOffer, "id" | "status" | "createdAt" | "fromPlayerId" | "toPlayerId">
) => {
  const room = ensureCurrentRoom(roomCode);
  const game = room.game;
  if (!game) {
    throw new AppError("Игра не началась");
  }
  const offer = game.pendingTradeOffers.find((item) => item.id === tradeId);
  if (!offer || offer.status !== "pending") {
    throw new AppError("Предложение не найдено");
  }
  if (offer.toPlayerId !== playerId) {
    throw new AppError("Только получатель может сделать встречное предложение");
  }
  offer.status = "cancelled";
  await commandTradeCreate(playerId, roomCode, {
    toPlayerId: offer.fromPlayerId,
    fromCellIds: counter.fromCellIds,
    toCellIds: counter.toCellIds,
    fromCoins: counter.fromCoins,
    toCoins: counter.toCoins
  });
};

export const getGameState = (roomCode: string): GameState | null => {
  const room = roomByCode.get(roomCode);
  return room?.game || null;
};

export const ensureRoomMembership = (playerId: string, roomCode: string) => {
  const active = playerRoom.get(playerId);
  if (active !== roomCode) {
    throw new AppError("Игрок не состоит в этой комнате");
  }
};

export const serializeError = (error: unknown): { status: number; message: string } => {
  if (error instanceof AppError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof Error) {
    return { status: 500, message: error.message };
  }
  return { status: 500, message: "Неизвестная ошибка" };
};
