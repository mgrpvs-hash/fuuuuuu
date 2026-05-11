import {
  BASE_ENTRY_FEE,
  BOARD_CELLS,
  JAIL_FINE,
  PLAYER_COLORS,
  START_BONUS,
  UPGRADE_LEVEL_NAMES,
  getUpgradeCost,
  getBuyoutPrice,
  getSellPrice,
  scaleByEntry
} from "@monopoly/shared";
import type {
  CardResult,
  GameState,
  JoinRoomPayload,
  LeaderboardEntry,
  PendingAction,
  PlayerColor,
  PlayerState,
  PropertyState,
  RoomState,
  RoomSummary,
  TradeOffer
} from "@monopoly/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { drawAndApplyCard } from "./cards";
import {
  calculateRent,
  createHistoryEntry,
  createProperties,
  getNextActivePlayerIndex,
  getPlayer,
  getPropertyState,
  randomInt
} from "./helpers";

interface LobbyPlayer {
  id: string;
  name: string;
  avatarUrl?: string;
  color: PlayerColor;
  paidEntryFee: number;
  connected: boolean;
}

interface RoomRuntime {
  code: string;
  creatorId: string;
  creatorName: string;
  entryFee: number;
  maxPlayers: number;
  status: "lobby" | "in_game" | "finished";
  players: LobbyPlayer[];
  game: GameState | null;
}

const rooms = new Map<string, RoomRuntime>();

function createCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[randomInt(0, alphabet.length - 1)]).join("");
}

async function ensureProfile(playerId: string, playerName: string, avatarUrl?: string) {
  return prisma.profile.upsert({
    where: { id: playerId },
    update: {
      name: playerName,
      avatarUrl
    },
    create: {
      id: playerId,
      name: playerName,
      avatarUrl
    }
  });
}

function appendEvent(game: GameState, message: string) {
  const row = createHistoryEntry(message);
  game.lastEvent = row;
  game.history = [row, ...game.history].slice(0, 120);
}

function setPending(game: GameState, pending: PendingAction) {
  game.pendingAction = pending;
}

function activePlayers(game: GameState) {
  return game.players.filter((player) => !player.isBankrupt);
}

function checkDebtState(game: GameState, player: PlayerState) {
  if (player.balance < 0) {
    player.debtMode = true;
    setPending(game, { type: "debt_sell", playerId: player.id });
    appendEvent(game, `${player.name} в долгу и должен продать улицы.`);
  } else {
    player.debtMode = false;
  }
}

function maybeBankrupt(game: GameState, player: PlayerState) {
  if (!player.debtMode || player.balance >= 0) {
    return false;
  }
  if (player.properties.length > 0) {
    return false;
  }
  player.isBankrupt = true;
  player.debtMode = false;
  appendEvent(game, `${player.name} обанкротился и выбыл из игры.`);
  return true;
}

function maybeFinishGame(game: GameState) {
  const alive = activePlayers(game);
  if (alive.length <= 1) {
    game.status = "finished";
    game.winnerIds = alive.map((player) => player.id);
    appendEvent(game, alive.length ? `${alive[0]!.name} победил в игре!` : "Игра завершена.");
    return true;
  }
  if (game.round > game.maxRounds) {
    game.status = "finished";
    const ranked = [...alive].sort((a, b) => b.balance - a.balance);
    game.winnerIds = ranked.length ? [ranked[0]!.id] : [];
    appendEvent(game, `Достигнут лимит раундов (${game.maxRounds}). Игра завершена.`);
    return true;
  }
  return false;
}

function getCurrentPlayer(game: GameState): PlayerState {
  const player = game.players[game.turnIndex];
  if (!player) {
    throw new Error("Current player is missing.");
  }
  return player;
}

function advanceTurn(game: GameState, keepTurn = false) {
  if (keepTurn) {
    const current = getCurrentPlayer(game);
    game.currentTurnPlayerId = current.id;
    return;
  }
  const previousIndex = game.turnIndex;
  game.turnIndex = getNextActivePlayerIndex(game, game.turnIndex);
  if (game.turnIndex <= previousIndex) {
    game.round += 1;
    for (const property of game.properties) {
      if (property.frozenTurns > 0) {
        property.frozenTurns -= 1;
      }
    }
    for (const player of game.players) {
      if (player.cannotUpgradeTurns > 0) {
        player.cannotUpgradeTurns -= 1;
      }
      if (player.buyoutDiscountTurns > 0) {
        player.buyoutDiscountTurns -= 1;
      }
    }
  }
  const next = getCurrentPlayer(game);
  game.currentTurnPlayerId = next.id;
  if (next.skipTurns > 0) {
    next.skipTurns -= 1;
    appendEvent(game, `${next.name} пропускает ход.`);
    advanceTurn(game, false);
  }
}

function landingCell(game: GameState, player: PlayerState) {
  return game.board[player.position]!;
}

function formatCoin(value: number) {
  return `🪙 ${value}`;
}

function transferProperty(game: GameState, property: PropertyState, fromId: string, toId: string) {
  const from = getPlayer(game, fromId);
  const to = getPlayer(game, toId);
  if (!from || !to) {
    return;
  }
  from.properties = from.properties.filter((index) => index !== property.cellIndex);
  to.properties = [...new Set([...to.properties, property.cellIndex])];
  property.ownerId = toId;
}

function canAct(game: GameState, playerId: string): { ok: true; player: PlayerState } | { ok: false; error: string } {
  const player = getPlayer(game, playerId);
  if (!player) {
    return { ok: false, error: "Игрок не найден." };
  }
  if (game.status !== "in_game") {
    return { ok: false, error: "Игра не запущена." };
  }
  if (game.currentTurnPlayerId !== playerId) {
    return { ok: false, error: "Сейчас не ваш ход." };
  }
  if (player.isBankrupt) {
    return { ok: false, error: "Банкрот не может делать ход." };
  }
  return { ok: true, player };
}

async function finalizeFinishedGame(room: RoomRuntime) {
  const game = room.game;
  if (!game || game.status !== "finished") {
    return;
  }
  room.status = "finished";
  const ranked = [...game.players].sort((a, b) => b.balance - a.balance);
  const payoutRate = [1, 0.98, 0.95];
  await prisma.$transaction(async (tx) => {
    for (const [index, player] of ranked.entries()) {
      const payoutMultiplier = player.isBankrupt ? 0 : payoutRate[index] ?? 0.9;
      const payout = Math.round(game.entryFee * payoutMultiplier);
      const profit = payout - game.entryFee;
      const won = index === 0 && !player.isBankrupt;
      const profile = await tx.profile.findUnique({ where: { id: player.id } });
      const previousBest = profile?.bestWin ?? 0;

      await tx.profile.update({
        where: { id: player.id },
        data: {
          balance: { increment: payout },
          gamesPlayed: { increment: 1 },
          wins: { increment: won ? 1 : 0 },
          losses: { increment: won ? 0 : 1 },
          totalProfit: { increment: profit },
          totalWonCoins: { increment: Math.max(0, profit) },
          bestWin: Math.max(previousBest, profit)
        }
      });

      await tx.matchResult.create({
        data: {
          roomCode: room.code,
          playerId: player.id,
          playerName: player.name,
          placement: index + 1,
          entryFee: game.entryFee,
          payout,
          profit,
          won
        }
      });
    }
  });
}

function applyLanding(game: GameState, player: PlayerState) {
  const cell = landingCell(game, player);
  if (cell.type === "start") {
    appendEvent(game, `${player.name} на старте.`);
    return;
  }

  if (cell.type === "tax") {
    const taxAmount = cell.tax ?? 0;
    player.balance -= taxAmount;
    appendEvent(game, `${player.name} оплатил налог ${formatCoin(taxAmount)}.`);
    checkDebtState(game, player);
    return;
  }

  if (cell.type === "chance") {
    setPending(game, { type: "draw_card", playerId: player.id, cellIndex: cell.index });
    appendEvent(game, `${player.name} попал на Chance.`);
    return;
  }

  if (cell.type === "go_to_jail") {
    player.position = 10;
    player.inJail = true;
    player.jailAttempts = 0;
    player.doubleStreak = 0;
    appendEvent(game, `${player.name} отправлен в тюрьму.`);
    return;
  }

  if (cell.type === "jail") {
    appendEvent(game, `${player.name} в зоне Jail.`);
    return;
  }

  if (cell.type === "free_parking") {
    appendEvent(game, `${player.name} отдыхает на Free Parking.`);
    return;
  }

  const property = getPropertyState(game, cell.index);
  if (!property) {
    return;
  }
  if (!property.ownerId) {
    setPending(game, {
      type: "buy_property",
      playerId: player.id,
      cellIndex: cell.index
    });
    appendEvent(game, `${player.name} может купить ${cell.name}.`);
    return;
  }
  if (property.ownerId === player.id) {
    setPending(game, {
      type: "upgrade_property",
      playerId: player.id,
      cellIndex: cell.index
    });
    appendEvent(game, `${player.name} на своей улице ${cell.name}.`);
    return;
  }
  const owner = getPlayer(game, property.ownerId);
  if (!owner || owner.isBankrupt) {
    property.ownerId = null;
    property.level = 0;
    property.totalUpgradeSpent = 0;
    property.shielded = false;
    setPending(game, {
      type: "buy_property",
      playerId: player.id,
      cellIndex: cell.index
    });
    return;
  }
  const rent = calculateRent(property);
  player.balance -= rent;
  owner.balance += rent;
  appendEvent(game, `${player.name} заплатил аренду ${formatCoin(rent)} игроку ${owner.name}.`);
  checkDebtState(game, player);
  if (!player.debtMode) {
    setPending(game, {
      type: "buyout_property",
      playerId: player.id,
      cellIndex: cell.index
    });
  }
}

export const roomManager = {
  async createRoom(payload: {
    entryFee: number;
    maxPlayers: number;
    playerId: string;
    playerName: string;
    avatarUrl?: string;
  }) {
    const entryFee = Math.max(1000, Math.floor(payload.entryFee));
    const maxPlayers = Math.max(2, Math.min(6, Math.floor(payload.maxPlayers)));
    await ensureProfile(payload.playerId, payload.playerName, payload.avatarUrl);
    const code = createCode();
    await prisma.$transaction(async (tx) => {
      const profile = await tx.profile.findUnique({ where: { id: payload.playerId } });
      if (!profile || profile.balance < entryFee) {
        throw new Error("Недостаточно баланса для входа в комнату.");
      }
      await tx.profile.update({
        where: { id: payload.playerId },
        data: { balance: { decrement: entryFee } }
      });
    });
    const room: RoomRuntime = {
      code,
      creatorId: payload.playerId,
      creatorName: payload.playerName,
      entryFee,
      maxPlayers,
      status: "lobby",
      players: [
        {
          id: payload.playerId,
          name: payload.playerName,
          avatarUrl: payload.avatarUrl,
          color: PLAYER_COLORS[0],
          paidEntryFee: entryFee,
          connected: true
        }
      ],
      game: null
    };
    rooms.set(code, room);
    return this.toRoomState(room);
  },

  async joinRoom(payload: JoinRoomPayload) {
    const room = rooms.get(payload.code.toUpperCase());
    if (!room) {
      throw new Error("Комната не найдена.");
    }
    await ensureProfile(payload.playerId, payload.playerName, payload.avatarUrl);
    const existing = room.players.find((player) => player.id === payload.playerId);
    if (existing) {
      existing.connected = true;
      existing.name = payload.playerName;
      existing.avatarUrl = payload.avatarUrl;
      return this.toRoomState(room);
    }
    if (room.status !== "lobby") {
      throw new Error("Игра уже началась.");
    }
    if (room.players.length >= room.maxPlayers) {
      throw new Error("Комната заполнена.");
    }
    await prisma.$transaction(async (tx) => {
      const profile = await tx.profile.findUnique({ where: { id: payload.playerId } });
      if (!profile || profile.balance < room.entryFee) {
        throw new Error("Недостаточно баланса для входа.");
      }
      await tx.profile.update({
        where: { id: payload.playerId },
        data: { balance: { decrement: room.entryFee } }
      });
    });
    room.players.push({
      id: payload.playerId,
      name: payload.playerName,
      avatarUrl: payload.avatarUrl,
      color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length]!,
      paidEntryFee: room.entryFee,
      connected: true
    });
    return this.toRoomState(room);
  },

  async leaveRoom(code: string, playerId: string) {
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      throw new Error("Комната не найдена.");
    }
    if (room.status !== "lobby") {
      throw new Error("Покинуть можно только lobby.");
    }
    const participant = room.players.find((player) => player.id === playerId);
    if (!participant) {
      return this.toRoomState(room);
    }
    await prisma.$transaction(async (tx) => {
      await tx.profile.update({
        where: { id: playerId },
        data: { balance: { increment: participant.paidEntryFee } }
      });
    });
    room.players = room.players.filter((player) => player.id !== playerId);
    if (!room.players.length) {
      rooms.delete(room.code);
      return null;
    }
    if (room.creatorId === playerId) {
      room.creatorId = room.players[0]!.id;
      room.creatorName = room.players[0]!.name;
    }
    return this.toRoomState(room);
  },

  async startRoom(code: string, actorId: string) {
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      throw new Error("Комната не найдена.");
    }
    if (room.creatorId !== actorId) {
      throw new Error("Старт доступен только создателю комнаты.");
    }
    if (room.players.length < 2) {
      throw new Error("Для старта нужно минимум 2 игрока.");
    }
    if (room.status !== "lobby") {
      throw new Error("Комната уже стартовала.");
    }
    const economyMultiplier = room.entryFee / BASE_ENTRY_FEE;
    const board = BOARD_CELLS.map((cell) => ({
      ...cell,
      price: cell.price ? scaleByEntry(cell.price, economyMultiplier) : undefined,
      baseRent: cell.baseRent ? scaleByEntry(cell.baseRent, economyMultiplier) : undefined,
      tax: cell.tax ? scaleByEntry(cell.tax, economyMultiplier) : undefined
    }));
    const game: GameState = {
      roomCode: room.code,
      status: "in_game",
      entryFee: room.entryFee,
      economyMultiplier,
      round: 1,
      maxRounds: 30,
      turnIndex: 0,
      currentTurnPlayerId: room.players[0]!.id,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        avatarUrl: player.avatarUrl,
        color: player.color,
        balance: room.entryFee,
        position: 0,
        isBankrupt: false,
        debtMode: false,
        properties: [],
        skipTurns: 0,
        cannotUpgradeTurns: 0,
        inJail: false,
        jailAttempts: 0,
        getOutOfJailCards: 0,
        doubleStreak: 0,
        buyoutDiscountTurns: 0,
        joinedAt: Date.now()
      })),
      board,
      properties: createProperties(economyMultiplier),
      pendingAction: { type: "none" },
      lastEvent: "Игра началась.",
      history: [createHistoryEntry("Игра началась.")],
      trades: [],
      winnerIds: []
    };
    room.status = "in_game";
    room.game = game;
    return game;
  },

  listRooms(): RoomSummary[] {
    return Array.from(rooms.values())
      .filter((room) => room.status === "lobby")
      .map((room) => ({
        code: room.code,
        creatorName: room.creatorName,
        entryFee: room.entryFee,
        maxPlayers: room.maxPlayers,
        currentPlayers: room.players.length,
        status: room.status
      }));
  },

  getRoom(code: string): RoomState | null {
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      return null;
    }
    return this.toRoomState(room);
  },

  getGame(code: string): GameState | null {
    return rooms.get(code.toUpperCase())?.game ?? null;
  },

  setConnected(code: string, playerId: string, connected: boolean) {
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      return;
    }
    const player = room.players.find((item) => item.id === playerId);
    if (player) {
      player.connected = connected;
    }
  },

  rollDice(code: string, playerId: string) {
    const room = rooms.get(code.toUpperCase());
    if (!room?.game) {
      throw new Error("Игра не найдена.");
    }
    const game = room.game;
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const player = result.player;
    if (game.pendingAction.type !== "none") {
      throw new Error("Сначала завершите обязательное действие.");
    }
    if (player.debtMode) {
      throw new Error("Вы в долгу. Продайте улицу.");
    }
    if (player.inJail) {
      setPending(game, { type: "jail_choice", playerId });
      throw new Error("Вы в тюрьме: выберите действие в модалке.");
    }

    const diceA = randomInt(1, 6);
    const diceB = randomInt(1, 6);
    const steps = diceA + diceB;
    const isDouble = diceA === diceB;
    player.doubleStreak = isDouble ? player.doubleStreak + 1 : 0;

    if (player.doubleStreak >= 3) {
      player.position = 10;
      player.inJail = true;
      player.jailAttempts = 0;
      player.doubleStreak = 0;
      appendEvent(game, `${player.name} выбросил 3 дубля подряд и отправлен в тюрьму.`);
      advanceTurn(game, false);
      setPending(game, { type: "none" });
      return game;
    }

    const from = player.position;
    let to = (player.position + steps) % game.board.length;
    if (from + steps >= game.board.length) {
      const startIncome = scaleByEntry(START_BONUS, game.economyMultiplier);
      player.balance += startIncome;
      appendEvent(game, `${player.name} пересек START и получил ${formatCoin(startIncome)}.`);
    }
    player.position = to;
    game.lastMove = { playerId, from, to, steps, dice: [diceA, diceB] };
    appendEvent(game, `${player.name} бросил ${diceA} + ${diceB}.`);
    applyLanding(game, player);
    maybeBankrupt(game, player);

    if (game.pendingAction.type === "none" && !player.debtMode) {
      if (isDouble && !player.inJail) {
        appendEvent(game, "Дубль! Ещё ход.");
        advanceTurn(game, true);
      } else {
        advanceTurn(game, false);
      }
    }
    if (maybeFinishGame(game)) {
      void finalizeFinishedGame(room);
    }
    return game;
  },

  endTurn(code: string, playerId: string) {
    const room = rooms.get(code.toUpperCase());
    if (!room?.game) {
      throw new Error("Игра не найдена.");
    }
    const game = room.game;
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const player = result.player;
    if (player.debtMode) {
      throw new Error("Нельзя закончить ход в debt mode.");
    }
    setPending(game, { type: "none" });
    advanceTurn(game, false);
    if (maybeFinishGame(game)) {
      void finalizeFinishedGame(room);
    }
    return game;
  },

  buyProperty(code: string, playerId: string) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    if (game.pendingAction.type !== "buy_property") {
      throw new Error("Сейчас нельзя купить улицу.");
    }
    const cellIndex = game.pendingAction.cellIndex;
    if (typeof cellIndex !== "number") {
      throw new Error("Нет цели покупки.");
    }
    const property = getPropertyState(game, cellIndex);
    const player = result.player;
    if (!property || property.ownerId) {
      throw new Error("Улица недоступна.");
    }
    if (player.balance < property.scaledPrice) {
      throw new Error("Недостаточно средств.");
    }
    player.balance -= property.scaledPrice;
    property.ownerId = player.id;
    player.properties.push(property.cellIndex);
    appendEvent(game, `${player.name} купил ${game.board[cellIndex]?.name} за ${formatCoin(property.scaledPrice)}.`);
    checkDebtState(game, player);
    setPending(game, { type: "none" });
    return game;
  },

  upgradeProperty(code: string, playerId: string, cellIndex?: number) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const player = result.player;
    if (player.cannotUpgradeTurns > 0) {
      throw new Error("Улучшения временно заблокированы.");
    }
    const targetIndex = cellIndex ?? game.pendingAction.cellIndex;
    if (typeof targetIndex !== "number") {
      throw new Error("Укажите улицу для улучшения.");
    }
    const property = getPropertyState(game, targetIndex);
    if (!property || property.ownerId !== player.id) {
      throw new Error("Это не ваша улица.");
    }
    if (property.frozenTurns > 0) {
      throw new Error("Улица заморожена и временно недоступна для улучшения.");
    }
    if (property.level >= 5) {
      throw new Error("Улица уже максимального уровня.");
    }
    const nextLevel = property.level + 1;
    const cost = getUpgradeCost(property.scaledPrice, nextLevel);
    if (player.balance < cost) {
      throw new Error("Недостаточно средств для улучшения.");
    }
    player.balance -= cost;
    property.level = nextLevel;
    property.totalUpgradeSpent += cost;
    appendEvent(
      game,
      `${player.name} улучшил ${game.board[targetIndex]?.name} до ${UPGRADE_LEVEL_NAMES[nextLevel]} (${formatCoin(cost)}).`
    );
    checkDebtState(game, player);
    setPending(game, { type: "none" });
    return game;
  },

  buyoutProperty(code: string, playerId: string) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    if (game.pendingAction.type !== "buyout_property") {
      throw new Error("Сейчас нельзя выкупать улицу.");
    }
    const targetIndex = game.pendingAction.cellIndex;
    if (typeof targetIndex !== "number") {
      throw new Error("Нет улицы для выкупа.");
    }
    const property = getPropertyState(game, targetIndex);
    const player = result.player;
    if (!property || !property.ownerId || property.ownerId === player.id) {
      throw new Error("Выкуп невозможен.");
    }
    if (property.shielded) {
      property.shielded = false;
      appendEvent(game, `Щит на ${game.board[targetIndex]?.name} разрушен, выкуп не прошел.`);
      setPending(game, { type: "none" });
      return game;
    }
    const owner = getPlayer(game, property.ownerId);
    if (!owner) {
      throw new Error("Владелец не найден.");
    }
    const basePrice = getBuyoutPrice(property.scaledPrice, property.totalUpgradeSpent);
    const discounted = player.buyoutDiscountTurns > 0 ? Math.round(basePrice * 0.85) : basePrice;
    if (player.balance < discounted) {
      throw new Error("Недостаточно средств для выкупа.");
    }
    player.balance -= discounted;
    owner.balance += discounted;
    transferProperty(game, property, owner.id, player.id);
    appendEvent(game, `${player.name} выкупил ${game.board[targetIndex]?.name} у ${owner.name} за ${formatCoin(discounted)}.`);
    checkDebtState(game, player);
    checkDebtState(game, owner);
    maybeBankrupt(game, owner);
    setPending(game, { type: "none" });
    return game;
  },

  sellProperty(code: string, playerId: string, cellIndex: number) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const player = result.player;
    const property = getPropertyState(game, cellIndex);
    if (!property || property.ownerId !== player.id) {
      throw new Error("Эта улица вам не принадлежит.");
    }
    const income = getSellPrice(property.scaledPrice, property.totalUpgradeSpent);
    player.balance += income;
    player.properties = player.properties.filter((item) => item !== property.cellIndex);
    property.ownerId = null;
    property.level = 0;
    property.shielded = false;
    property.totalUpgradeSpent = 0;
    property.frozenTurns = 0;
    appendEvent(game, `${player.name} продал ${game.board[cellIndex]?.name} за ${formatCoin(income)}.`);
    checkDebtState(game, player);
    if (!player.debtMode) {
      setPending(game, { type: "none" });
    } else {
      maybeBankrupt(game, player);
    }
    return game;
  },

  placeShield(code: string, playerId: string, cellIndex: number) {
    const game = this.requiredGame(code);
    const property = getPropertyState(game, cellIndex);
    const player = getPlayer(game, playerId);
    if (!property || !player) {
      throw new Error("Улица не найдена.");
    }
    if (property.ownerId !== player.id) {
      throw new Error("Можно ставить щит только на свою улицу.");
    }
    if (property.shielded) {
      throw new Error("Щит уже установлен.");
    }
    const cost = Math.round(property.scaledPrice * 0.25);
    if (player.balance < cost) {
      throw new Error("Недостаточно средств для щита.");
    }
    player.balance -= cost;
    property.shielded = true;
    appendEvent(game, `${player.name} установил щит на ${game.board[cellIndex]?.name}.`);
    checkDebtState(game, player);
    return game;
  },

  jailPay(code: string, playerId: string) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const player = result.player;
    if (!player.inJail) {
      throw new Error("Игрок не в тюрьме.");
    }
    const fee = scaleByEntry(JAIL_FINE, game.economyMultiplier);
    if (player.balance < fee) {
      throw new Error("Недостаточно денег для штрафа.");
    }
    player.balance -= fee;
    player.inJail = false;
    player.jailAttempts = 0;
    setPending(game, { type: "none" });
    appendEvent(game, `${player.name} заплатил штраф и вышел из тюрьмы.`);
    checkDebtState(game, player);
    return game;
  },

  jailRoll(code: string, playerId: string) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const player = result.player;
    if (!player.inJail) {
      throw new Error("Игрок не в тюрьме.");
    }
    const d1 = randomInt(1, 6);
    const d2 = randomInt(1, 6);
    const isDouble = d1 === d2;
    player.jailAttempts += 1;
    appendEvent(game, `${player.name} бросает в тюрьме: ${d1}+${d2}.`);
    if (isDouble) {
      player.inJail = false;
      player.jailAttempts = 0;
      appendEvent(game, `${player.name} выбросил дубль и вышел из тюрьмы.`);
      setPending(game, { type: "none" });
      return game;
    }
    if (player.jailAttempts >= 3) {
      const fee = scaleByEntry(JAIL_FINE, game.economyMultiplier);
      player.balance -= fee;
      player.inJail = false;
      player.jailAttempts = 0;
      appendEvent(game, `${player.name} не выбрался за 3 попытки и оплатил ${formatCoin(fee)}.`);
      checkDebtState(game, player);
      setPending(game, { type: "none" });
      return game;
    }
    setPending(game, { type: "jail_choice", playerId });
    return game;
  },

  jailUseCard(code: string, playerId: string) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const player = result.player;
    if (!player.inJail) {
      throw new Error("Игрок не в тюрьме.");
    }
    if (player.getOutOfJailCards <= 0) {
      throw new Error("Нет карты выхода.");
    }
    player.getOutOfJailCards -= 1;
    player.inJail = false;
    player.jailAttempts = 0;
    setPending(game, { type: "none" });
    appendEvent(game, `${player.name} использовал карту выхода из тюрьмы.`);
    return game;
  },

  drawCard(code: string, playerId: string) {
    const game = this.requiredGame(code);
    const result = canAct(game, playerId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    if (game.pendingAction.type !== "draw_card") {
      throw new Error("Карта сейчас не доступна.");
    }
    const player = result.player;
    const { card, effectText } = drawAndApplyCard(game, player);
    const cardResult: CardResult = {
      cardId: card.id,
      title: card.title,
      description: card.description,
      category: card.category,
      icon: card.icon,
      effectText
    };
    game.lastCard = cardResult;
    appendEvent(game, `Карта: ${card.title}. ${effectText}`);
    setPending(game, { type: "none" });
    checkDebtState(game, player);
    maybeBankrupt(game, player);
    return game;
  },

  createTrade(
    code: string,
    playerId: string,
    payload: {
      toPlayerId: string;
      offeredPropertyIds: number[];
      requestedPropertyIds: number[];
      moneyFrom: number;
      moneyTo: number;
    }
  ) {
    const game = this.requiredGame(code);
    const from = getPlayer(game, playerId);
    const to = getPlayer(game, payload.toPlayerId);
    if (!from || !to) {
      throw new Error("Игроки сделки не найдены.");
    }
    if (from.isBankrupt || to.isBankrupt) {
      throw new Error("Банкрот не может участвовать в трейде.");
    }
    if (from.debtMode || to.debtMode) {
      throw new Error("Игрок в долгу не может трейдиться.");
    }
    if (payload.moneyFrom > from.balance) {
      throw new Error("Недостаточно денег в предложении.");
    }
    if (payload.moneyTo > to.balance) {
      throw new Error("Второй игрок не имеет столько денег.");
    }
    for (const propertyId of payload.offeredPropertyIds) {
      const property = getPropertyState(game, propertyId);
      if (!property || property.ownerId !== from.id) {
        throw new Error("Вы предлагаете чужую улицу.");
      }
    }
    for (const propertyId of payload.requestedPropertyIds) {
      const property = getPropertyState(game, propertyId);
      if (!property || property.ownerId !== to.id) {
        throw new Error("Запрошена недоступная улица.");
      }
    }
    const trade: TradeOffer = {
      id: randomUUID(),
      roomCode: code.toUpperCase(),
      fromPlayerId: from.id,
      toPlayerId: to.id,
      offeredPropertyIds: [...new Set(payload.offeredPropertyIds)],
      requestedPropertyIds: [...new Set(payload.requestedPropertyIds)],
      moneyFrom: Math.max(0, Math.floor(payload.moneyFrom)),
      moneyTo: Math.max(0, Math.floor(payload.moneyTo)),
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    game.trades = [trade, ...game.trades].slice(0, 100);
    appendEvent(game, `${from.name} отправил trade-предложение игроку ${to.name}.`);
    return game;
  },

  acceptTrade(code: string, playerId: string, tradeId: string) {
    const game = this.requiredGame(code);
    const trade = game.trades.find((item) => item.id === tradeId && item.status === "pending");
    if (!trade) {
      throw new Error("Сделка не найдена.");
    }
    if (trade.toPlayerId !== playerId) {
      throw new Error("Только получатель может принять сделку.");
    }
    const from = getPlayer(game, trade.fromPlayerId);
    const to = getPlayer(game, trade.toPlayerId);
    if (!from || !to) {
      throw new Error("Участники сделки не найдены.");
    }
    if (from.isBankrupt || to.isBankrupt || from.debtMode || to.debtMode) {
      throw new Error("Сделка отменена: один из игроков не может трейдиться.");
    }
    if (from.balance < trade.moneyFrom || to.balance < trade.moneyTo) {
      throw new Error("Баланс изменился, сделка недействительна.");
    }
    for (const propertyId of trade.offeredPropertyIds) {
      const property = getPropertyState(game, propertyId);
      if (!property || property.ownerId !== from.id) {
        trade.status = "cancelled";
        throw new Error("Сделка отменена: предложенная улица больше не принадлежит отправителю.");
      }
    }
    for (const propertyId of trade.requestedPropertyIds) {
      const property = getPropertyState(game, propertyId);
      if (!property || property.ownerId !== to.id) {
        trade.status = "cancelled";
        throw new Error("Сделка отменена: запрошенная улица больше недоступна.");
      }
    }
    from.balance = from.balance - trade.moneyFrom + trade.moneyTo;
    to.balance = to.balance - trade.moneyTo + trade.moneyFrom;
    for (const propertyId of trade.offeredPropertyIds) {
      const property = getPropertyState(game, propertyId)!;
      transferProperty(game, property, from.id, to.id);
    }
    for (const propertyId of trade.requestedPropertyIds) {
      const property = getPropertyState(game, propertyId)!;
      transferProperty(game, property, to.id, from.id);
    }
    trade.status = "accepted";
    trade.updatedAt = Date.now();
    appendEvent(game, `${from.name} и ${to.name} успешно завершили trade.`);
    return game;
  },

  rejectTrade(code: string, playerId: string, tradeId: string) {
    const game = this.requiredGame(code);
    const trade = game.trades.find((item) => item.id === tradeId && item.status === "pending");
    if (!trade) {
      throw new Error("Сделка не найдена.");
    }
    if (trade.toPlayerId !== playerId) {
      throw new Error("Отклонить может только получатель.");
    }
    trade.status = "rejected";
    trade.updatedAt = Date.now();
    appendEvent(game, `Trade-предложение отклонено.`);
    return game;
  },

  cancelTrade(code: string, playerId: string, tradeId: string) {
    const game = this.requiredGame(code);
    const trade = game.trades.find((item) => item.id === tradeId && item.status === "pending");
    if (!trade) {
      throw new Error("Сделка не найдена.");
    }
    if (trade.fromPlayerId !== playerId) {
      throw new Error("Отменить может только отправитель.");
    }
    trade.status = "cancelled";
    trade.updatedAt = Date.now();
    appendEvent(game, "Trade-предложение отменено.");
    return game;
  },

  counterTrade(
    code: string,
    playerId: string,
    tradeId: string,
    payload: {
      offeredPropertyIds: number[];
      requestedPropertyIds: number[];
      moneyFrom: number;
      moneyTo: number;
    }
  ) {
    const game = this.requiredGame(code);
    const trade = game.trades.find((item) => item.id === tradeId && item.status === "pending");
    if (!trade) {
      throw new Error("Сделка не найдена.");
    }
    if (trade.toPlayerId !== playerId) {
      throw new Error("Контр-предложение доступно только получателю.");
    }
    trade.status = "countered";
    trade.updatedAt = Date.now();
    const counter = this.createTrade(code, playerId, {
      toPlayerId: trade.fromPlayerId,
      offeredPropertyIds: payload.offeredPropertyIds,
      requestedPropertyIds: payload.requestedPropertyIds,
      moneyFrom: payload.moneyFrom,
      moneyTo: payload.moneyTo
    });
    const created = counter.trades[0];
    if (created) {
      created.counterOfId = tradeId;
    }
    appendEvent(game, "Отправлено встречное trade-предложение.");
    return game;
  },

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const profiles = await prisma.profile.findMany({
      orderBy: [{ wins: "desc" }, { totalWonCoins: "desc" }],
      take: 50
    });
    return profiles.map((profile) => ({
      playerId: profile.id,
      name: profile.name,
      avatarUrl: profile.avatarUrl ?? undefined,
      wins: profile.wins,
      totalProfit: profile.totalProfit,
      bestWin: profile.bestWin
    }));
  },

  async getProfile(playerId: string) {
    const profile = await prisma.profile.findUnique({ where: { id: playerId } });
    if (!profile) {
      return null;
    }
    const winRate = profile.gamesPlayed ? Math.round((profile.wins / profile.gamesPlayed) * 100) : 0;
    return {
      id: profile.id,
      name: profile.name,
      avatarUrl: profile.avatarUrl ?? undefined,
      balance: profile.balance,
      gamesPlayed: profile.gamesPlayed,
      wins: profile.wins,
      losses: profile.losses,
      winRate,
      totalProfit: profile.totalProfit,
      bestWin: profile.bestWin
    };
  },

  requiredGame(code: string): GameState {
    const game = rooms.get(code.toUpperCase())?.game;
    if (!game) {
      throw new Error("Игра не найдена.");
    }
    return game;
  },

  toRoomState(room: RoomRuntime): RoomState {
    return {
      code: room.code,
      creatorId: room.creatorId,
      creatorName: room.creatorName,
      entryFee: room.entryFee,
      maxPlayers: room.maxPlayers,
      status: room.status,
      playerIds: room.players.map((player) => player.id),
      game: room.game
    };
  }
};
