import { PrismaClient } from "@prisma/client";
import { createBoard, calculateRent, getUpgradeTitle, upgradeCost } from "./board";
import {
  ActionButton,
  GameLogEntry,
  GamePlayer,
  GameState,
  PropertyState,
  RoomParticipant,
  RoomState,
  TradeProposal
} from "./types";

const BOARD_SIZE = 24;
const MAX_ROUNDS = 30;
const START_BONUS_MULTIPLIER = 0.22;

const roomCode = () =>
  Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/g, "")
    .slice(2, 8)
    .toUpperCase();

const entryId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const payoutPercent = (placement: number): number => {
  if (placement === 1) return 100;
  if (placement === 2) return 98;
  if (placement === 3) return 95;
  return 90;
};

const isActive = (player: GamePlayer) => player.status !== "bankrupt";

type PlayerIdentity = {
  userId: string;
  name: string;
  avatarUrl?: string;
};

export class GameEngine {
  private rooms = new Map<string, RoomState>();

  constructor(private prisma: PrismaClient) {}

  public getRooms() {
    return Array.from(this.rooms.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => ({
        code: room.code,
        entryFee: room.entryFee,
        maxPlayers: room.maxPlayers,
        players: room.players.length,
        status: room.status
      }));
  }

  public getRoom(code: string) {
    return this.rooms.get(code);
  }

  public async createRoom(input: {
    host: PlayerIdentity;
    entryFee: number;
    maxPlayers: number;
  }): Promise<RoomState> {
    const entryFee = Math.max(100, Math.round(input.entryFee));
    const maxPlayers = Math.min(6, Math.max(2, Math.round(input.maxPlayers)));

    const debited = await this.debitUserBalance(input.host.userId, entryFee);
    if (!debited) {
      throw new Error("Недостаточно средств для создания комнаты");
    }

    let code = roomCode();
    while (this.rooms.has(code)) {
      code = roomCode();
    }

    const room: RoomState = {
      code,
      hostId: input.host.userId,
      entryFee,
      maxPlayers,
      status: "waiting",
      players: [{ userId: input.host.userId, name: input.host.name, avatarUrl: input.host.avatarUrl }],
      createdAt: Date.now()
    };

    this.rooms.set(code, room);
    return room;
  }

  public async joinRoom(code: string, user: PlayerIdentity): Promise<RoomState> {
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error("Комната не найдена");
    }
    if (room.status !== "waiting") {
      throw new Error("Игра уже началась");
    }
    if (room.players.some((player) => player.userId === user.userId)) {
      return room;
    }
    if (room.players.length >= room.maxPlayers) {
      throw new Error("Комната заполнена");
    }

    const debited = await this.debitUserBalance(user.userId, room.entryFee);
    if (!debited) {
      throw new Error("Недостаточно средств для входа");
    }

    room.players.push({ userId: user.userId, name: user.name, avatarUrl: user.avatarUrl });
    return room;
  }

  public async leaveRoom(code: string, userId: string): Promise<RoomState | undefined> {
    const room = this.rooms.get(code);
    if (!room) return undefined;

    if (room.status === "waiting") {
      const index = room.players.findIndex((player) => player.userId === userId);
      if (index >= 0) {
        room.players.splice(index, 1);
        await this.creditUserBalance(userId, room.entryFee);
      }
      if (!room.players.length) {
        this.rooms.delete(code);
        return undefined;
      }
      if (room.hostId === userId) {
        room.hostId = room.players[0].userId;
      }
      return room;
    }

    if (room.status === "playing" && room.gameState) {
      this.markPlayerBankrupt(room.gameState, userId, "Покинул игру");
      await this.evaluateGameEnd(room);
      return room;
    }

    return room;
  }

  public async startGame(code: string, hostId: string): Promise<GameState> {
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error("Комната не найдена");
    }
    if (room.hostId !== hostId) {
      throw new Error("Только создатель может начать игру");
    }
    if (room.status !== "waiting") {
      throw new Error("Игра уже запущена");
    }
    if (room.players.length < 2) {
      throw new Error("Нужно минимум 2 игрока");
    }

    const multiplier = room.entryFee / 1000;
    const board = createBoard(multiplier);

    const players: GamePlayer[] = room.players.map((player) => ({
      userId: player.userId,
      name: player.name,
      avatarUrl: player.avatarUrl,
      balance: room.entryFee,
      position: 0,
      status: "active",
      inJailTurns: 0,
      jailFreeCards: 0,
      doublesInRow: 0
    }));

    const state: GameState = {
      roomCode: room.code,
      entryFee: room.entryFee,
      multiplier,
      maxPlayers: room.maxPlayers,
      status: "playing",
      players,
      board: board.cells,
      properties: board.properties,
      hostId: room.hostId,
      currentTurnPlayerId: players[0].userId,
      phase: "await_roll",
      round: 1,
      maxRounds: MAX_ROUNDS,
      log: [
        {
          id: entryId(),
          text: `Игра началась. Раунд 1 / ${MAX_ROUNDS}`,
          level: "success",
          createdAt: Date.now()
        }
      ],
      eliminatedOrder: [],
      pendingTrades: []
    };

    room.status = "playing";
    room.gameState = state;

    return state;
  }

  public async rollDice(code: string, userId: string): Promise<GameState> {
    const game = this.getGameByCode(code);
    const player = this.getCurrentPlayer(game, userId);

    if (game.phase !== "await_roll" && game.phase !== "await_jail_choice") {
      throw new Error("Сейчас нельзя бросать кости");
    }

    if (game.phase === "await_jail_choice" && player.status !== "jailed") {
      game.phase = "await_roll";
    }

    const d1 = this.randomDice();
    const d2 = this.randomDice();
    const total = d1 + d2;
    const isDouble = d1 === d2;

    game.lastDice = { d1, d2, total, isDouble };

    if (player.status === "jailed") {
      if (isDouble) {
        player.status = "active";
        player.inJailTurns = 0;
        this.log(game, `${player.name} выбрасывает дубль и выходит из тюрьмы`, "success");
      } else {
        player.inJailTurns -= 1;
        this.log(game, `${player.name} не выбрасывает дубль и остаётся в тюрьме`, "warning");
        if (player.inJailTurns <= 0) {
          player.status = "active";
          this.log(game, `${player.name} отсидел срок и выходит из тюрьмы`, "info");
        }
        game.phase = "await_end_turn";
        return game;
      }
    }

    if (isDouble) {
      player.doublesInRow += 1;
    } else {
      player.doublesInRow = 0;
    }

    if (player.doublesInRow >= 3) {
      this.sendToJail(game, player, "Три дубля подряд");
      game.phase = "await_end_turn";
      return game;
    }

    this.movePlayer(game, player, total);
    await this.resolveLanding(game, player);
    await this.evaluateGameEnd(this.mustGetRoom(code));
    return game;
  }

  public async buyProperty(code: string, userId: string): Promise<GameState> {
    const game = this.getGameByCode(code);
    const player = this.getCurrentPlayer(game, userId);

    if (game.phase !== "await_tile_action" || !game.pendingPropertyId) {
      throw new Error("Сейчас нечего покупать");
    }

    const property = this.mustGetProperty(game, game.pendingPropertyId);
    if (property.ownerId) {
      throw new Error("Улица уже занята");
    }

    player.balance -= property.basePrice;
    property.ownerId = userId;
    this.log(game, `${player.name} покупает ${property.name} за 🪙 ${property.basePrice}`, "success");

    game.pendingPropertyId = undefined;
    game.phase = "await_end_turn";

    this.processDebt(game, player, "После покупки");
    await this.evaluateGameEnd(this.mustGetRoom(code));
    return game;
  }

  public async upgradeProperty(code: string, userId: string, propertyId?: string): Promise<GameState> {
    const game = this.getGameByCode(code);
    const player = this.getCurrentPlayer(game, userId);
    if (game.phase !== "await_tile_action") {
      throw new Error("Сейчас нельзя улучшать");
    }

    const targetId = propertyId ?? game.pendingPropertyId;
    if (!targetId) {
      throw new Error("Не выбрана улица");
    }

    const property = this.mustGetProperty(game, targetId);
    if (property.ownerId !== userId) {
      throw new Error("Улица не принадлежит игроку");
    }
    if (property.level >= 5) {
      throw new Error("Максимальный уровень уже достигнут");
    }

    const nextLevel = property.level + 1;
    const cost = upgradeCost(property.basePrice, nextLevel);
    player.balance -= cost;
    property.level = nextLevel;
    this.log(
      game,
      `${player.name} улучшает ${property.name} до "${getUpgradeTitle(nextLevel)}" за 🪙 ${cost}`,
      "success"
    );

    game.phase = "await_end_turn";
    this.processDebt(game, player, "После улучшения");
    await this.evaluateGameEnd(this.mustGetRoom(code));
    return game;
  }

  public async applyShield(code: string, userId: string, propertyId?: string): Promise<GameState> {
    const game = this.getGameByCode(code);
    const player = this.getCurrentPlayer(game, userId);
    if (game.phase !== "await_tile_action") {
      throw new Error("Сейчас нельзя применять щит");
    }
    const targetId = propertyId ?? game.pendingPropertyId;
    if (!targetId) {
      throw new Error("Не выбрана улица");
    }

    const property = this.mustGetProperty(game, targetId);
    if (property.ownerId !== userId) {
      throw new Error("Улица не принадлежит игроку");
    }
    if (property.shield) {
      throw new Error("На улице уже есть щит");
    }

    const shieldCost = Math.round(property.basePrice * 0.35);
    player.balance -= shieldCost;
    property.shield = true;
    this.log(game, `${player.name} ставит щит на ${property.name} за 🪙 ${shieldCost}`, "success");

    game.phase = "await_end_turn";
    this.processDebt(game, player, "После установки щита");
    await this.evaluateGameEnd(this.mustGetRoom(code));
    return game;
  }

  public async buyoutProperty(code: string, userId: string): Promise<GameState> {
    const game = this.getGameByCode(code);
    const buyer = this.getCurrentPlayer(game, userId);

    if (game.phase !== "await_tile_action" || !game.pendingBuyoutPropertyId) {
      throw new Error("Сейчас нет доступного выкупа");
    }

    const property = this.mustGetProperty(game, game.pendingBuyoutPropertyId);
    if (!property.ownerId || property.ownerId === userId) {
      throw new Error("Нельзя выкупить эту улицу");
    }

    const owner = this.mustGetPlayer(game, property.ownerId);
    if (property.shield) {
      property.shield = false;
      this.log(
        game,
        `${owner.name} теряет щит на ${property.name}. Выкуп заблокирован этим ударом`,
        "warning"
      );
      game.pendingBuyoutPropertyId = undefined;
      game.phase = "await_end_turn";
      return game;
    }

    const upgradesValue = Math.round(property.level * property.basePrice * 0.3);
    const price = Math.round(property.basePrice + upgradesValue * 1.7 + property.basePrice * 0.5);

    buyer.balance -= price;
    owner.balance += price;
    property.ownerId = buyer.userId;
    property.shield = false;

    this.log(game, `${buyer.name} выкупает ${property.name} у ${owner.name} за 🪙 ${price}`, "success");

    game.pendingBuyoutPropertyId = undefined;
    game.phase = "await_end_turn";

    this.processDebt(game, buyer, "После выкупа");
    this.processDebt(game, owner, "После получения выплаты");
    await this.evaluateGameEnd(this.mustGetRoom(code));
    return game;
  }

  public async payJailFine(code: string, userId: string): Promise<GameState> {
    const game = this.getGameByCode(code);
    const player = this.getCurrentPlayer(game, userId);
    if (game.phase !== "await_jail_choice") {
      throw new Error("Сейчас нет действий для тюрьмы");
    }
    if (player.status !== "jailed") {
      throw new Error("Игрок не в тюрьме");
    }

    const fine = Math.round(game.entryFee * 0.2);
    player.balance -= fine;
    player.status = "active";
    player.inJailTurns = 0;

    this.log(game, `${player.name} платит за выход из тюрьмы: 🪙 ${fine}`, "warning");
    this.processDebt(game, player, "После оплаты выхода из тюрьмы");
    game.phase = "await_roll";
    return game;
  }

  public useJailCard(code: string, userId: string): GameState {
    const game = this.getGameByCode(code);
    const player = this.getCurrentPlayer(game, userId);
    if (game.phase !== "await_jail_choice") {
      throw new Error("Сейчас нет действий для тюрьмы");
    }
    if (!player.jailFreeCards) {
      throw new Error("Нет карты освобождения");
    }

    player.jailFreeCards -= 1;
    player.status = "active";
    player.inJailTurns = 0;
    game.phase = "await_roll";
    this.log(game, `${player.name} использует карту выхода из тюрьмы`, "success");
    return game;
  }

  public async endTurn(code: string, userId: string): Promise<GameState> {
    const room = this.mustGetRoom(code);
    const game = this.getGameByCode(code);
    const current = this.getCurrentPlayer(game, userId);

    if (game.phase !== "await_end_turn" && game.phase !== "await_tile_action") {
      throw new Error("Сейчас нельзя завершать ход");
    }

    game.pendingPropertyId = undefined;
    game.pendingBuyoutPropertyId = undefined;

    const activePlayers = game.players.filter(isActive);
    if (activePlayers.length <= 1) {
      await this.finishGame(room);
      return game;
    }

    const extraTurn =
      game.lastDice?.isDouble === true &&
      current.status !== "bankrupt" &&
      current.status !== "jailed" &&
      current.doublesInRow > 0;

    if (extraTurn) {
      game.phase = current.status === "jailed" ? "await_jail_choice" : "await_roll";
      this.log(game, `${current.name} получает дополнительный ход за дубль`, "info");
      return game;
    }

    current.doublesInRow = 0;
    const nextPlayer = this.findNextActivePlayer(game, current.userId);
    if (!nextPlayer) {
      await this.finishGame(room);
      return game;
    }

    if (nextPlayer.userId === game.players.filter(isActive)[0].userId) {
      game.round += 1;
      this.log(game, `Раунд ${Math.min(game.round, game.maxRounds)} / ${game.maxRounds}`, "info");
    }

    if (game.round > game.maxRounds) {
      await this.finishGame(room);
      return game;
    }

    game.currentTurnPlayerId = nextPlayer.userId;
    game.phase = nextPlayer.status === "jailed" ? "await_jail_choice" : "await_roll";
    return game;
  }

  public proposeTrade(
    code: string,
    userId: string,
    tradeInput: Omit<TradeProposal, "id" | "fromPlayerId">
  ): GameState {
    const game = this.getGameByCode(code);
    const from = this.mustGetPlayer(game, userId);
    const to = this.mustGetPlayer(game, tradeInput.toPlayerId);

    if (from.status === "bankrupt" || to.status === "bankrupt") {
      throw new Error("Нельзя торговаться с банкротом");
    }
    if (tradeInput.offerMoney < 0 || tradeInput.requestMoney < 0) {
      throw new Error("Суммы в трейде должны быть неотрицательными");
    }

    this.validateTradeProperties(game, userId, tradeInput.offerPropertyIds);
    this.validateTradeProperties(game, tradeInput.toPlayerId, tradeInput.requestPropertyIds);

    const trade: TradeProposal = {
      id: entryId(),
      fromPlayerId: userId,
      toPlayerId: tradeInput.toPlayerId,
      offerMoney: Math.round(tradeInput.offerMoney),
      requestMoney: Math.round(tradeInput.requestMoney),
      offerPropertyIds: tradeInput.offerPropertyIds,
      requestPropertyIds: tradeInput.requestPropertyIds
    };

    game.pendingTrades.push(trade);
    this.log(game, `${from.name} предлагает сделку игроку ${to.name}`, "info");
    return game;
  }

  public async respondTrade(
    code: string,
    userId: string,
    tradeId: string,
    accept: boolean
  ): Promise<GameState> {
    const game = this.getGameByCode(code);
    const tradeIndex = game.pendingTrades.findIndex((trade) => trade.id === tradeId);
    if (tradeIndex < 0) {
      throw new Error("Сделка не найдена");
    }
    const trade = game.pendingTrades[tradeIndex];
    if (trade.toPlayerId !== userId) {
      throw new Error("Только получатель может ответить");
    }

    const from = this.mustGetPlayer(game, trade.fromPlayerId);
    const to = this.mustGetPlayer(game, trade.toPlayerId);

    if (!accept) {
      game.pendingTrades.splice(tradeIndex, 1);
      this.log(game, `${to.name} отклоняет сделку от ${from.name}`, "warning");
      return game;
    }

    this.validateTradeProperties(game, from.userId, trade.offerPropertyIds);
    this.validateTradeProperties(game, to.userId, trade.requestPropertyIds);

    if (from.balance < trade.offerMoney) {
      throw new Error("У инициатора не хватает денег для сделки");
    }
    if (to.balance < trade.requestMoney) {
      throw new Error("У получателя не хватает денег для сделки");
    }

    from.balance -= trade.offerMoney;
    to.balance += trade.offerMoney;
    to.balance -= trade.requestMoney;
    from.balance += trade.requestMoney;

    for (const id of trade.offerPropertyIds) {
      const property = this.mustGetProperty(game, id);
      property.ownerId = to.userId;
      property.shield = false;
    }
    for (const id of trade.requestPropertyIds) {
      const property = this.mustGetProperty(game, id);
      property.ownerId = from.userId;
      property.shield = false;
    }

    game.pendingTrades.splice(tradeIndex, 1);
    this.log(game, `${from.name} и ${to.name} успешно завершили сделку`, "success");

    this.processDebt(game, from, "После трейда");
    this.processDebt(game, to, "После трейда");
    await this.evaluateGameEnd(this.mustGetRoom(code));
    return game;
  }

  public getActionButtons(code: string, viewerId: string): ActionButton[] {
    const game = this.getGameByCode(code);
    if (game.status !== "playing") return [];
    if (game.currentTurnPlayerId !== viewerId) return [];

    const current = this.mustGetPlayer(game, viewerId);
    const buttons: ActionButton[] = [];

    if (game.phase === "await_roll") {
      buttons.push({ key: "roll", label: "Бросить кости", intent: "primary" });
    }

    if (game.phase === "await_jail_choice" && current.status === "jailed") {
      buttons.push({ key: "pay_jail", label: "Заплатить и выйти", intent: "danger" });
      if (current.jailFreeCards > 0) {
        buttons.push({ key: "use_jail_card", label: "Использовать карту", intent: "secondary" });
      }
      buttons.push({ key: "roll", label: "Бросить на дубль", intent: "primary" });
    }

    if (game.phase === "await_tile_action") {
      if (game.pendingPropertyId) {
        const property = this.mustGetProperty(game, game.pendingPropertyId);
        if (!property.ownerId) {
          buttons.push({
            key: "buy_property",
            label: `Купить ${property.name}`,
            intent: "primary",
            payload: { propertyId: property.id }
          });
        } else if (property.ownerId === viewerId) {
          buttons.push({
            key: "upgrade_property",
            label: `Улучшить ${property.name}`,
            intent: "primary",
            payload: { propertyId: property.id }
          });
          if (!property.shield) {
            buttons.push({
              key: "apply_shield",
              label: "Поставить щит",
              intent: "secondary",
              payload: { propertyId: property.id }
            });
          }
        }
      }

      if (game.pendingBuyoutPropertyId) {
        buttons.push({ key: "buyout_property", label: "Выкупить улицу", intent: "danger" });
      }

      buttons.push({ key: "end_turn", label: "Пропустить действие", intent: "secondary" });
    }

    if (game.phase === "await_end_turn") {
      buttons.push({ key: "end_turn", label: "Завершить ход", intent: "secondary" });
    }

    return buttons;
  }

  private async resolveLanding(game: GameState, player: GamePlayer) {
    const cell = game.board[player.position];
    if (!cell) return;

    if (cell.type === "property" && cell.propertyId) {
      const property = this.mustGetProperty(game, cell.propertyId);
      if (!property.ownerId) {
        game.pendingPropertyId = property.id;
        game.phase = "await_tile_action";
        this.log(game, `${player.name} попадает на свободную улицу ${property.name}`, "info");
        return;
      }

      if (property.ownerId === player.userId) {
        game.pendingPropertyId = property.id;
        game.phase = "await_tile_action";
        this.log(game, `${player.name} попадает на свою улицу ${property.name}`, "info");
        return;
      }

      const owner = this.mustGetPlayer(game, property.ownerId);
      const ownerHasSet = this.ownerHasColorSet(game, owner.userId, property.color);
      const rent = calculateRent(property, ownerHasSet);
      player.balance -= rent;
      owner.balance += rent;
      this.log(game, `${player.name} платит аренду ${owner.name}: 🪙 ${rent}`, "warning");
      this.processDebt(game, player, "После аренды");

      if (player.status !== "bankrupt") {
        game.pendingBuyoutPropertyId = property.id;
        game.phase = "await_tile_action";
      } else {
        game.phase = "await_end_turn";
      }
      return;
    }

    if (cell.type === "tax") {
      const amount = cell.amount ?? Math.round(game.entryFee * 0.1);
      player.balance -= amount;
      this.log(game, `${player.name} платит налог: 🪙 ${amount}`, "danger");
      this.processDebt(game, player, "После налога");
      game.phase = "await_end_turn";
      return;
    }

    if (cell.type === "chance") {
      await this.applyChanceCard(game, player);
      if (game.phase === "await_roll") {
        game.phase = "await_end_turn";
      }
      return;
    }

    if (cell.type === "go_to_jail") {
      this.sendToJail(game, player, "Клетка 'В тюрьму'");
      game.phase = "await_end_turn";
      return;
    }

    if (cell.type === "start") {
      this.log(game, `${player.name} останавливается на START`, "info");
    } else if (cell.type === "jail") {
      this.log(game, `${player.name} посещает тюрьму`, "info");
    } else {
      this.log(game, `${player.name} на клетке "${cell.label}"`, "info");
    }

    game.phase = "await_end_turn";
  }

  private async applyChanceCard(game: GameState, player: GamePlayer) {
    const roll = Math.random() * 100;
    if (roll < 40) {
      await this.applyNegativeCard(game, player);
      return;
    }
    if (roll < 75) {
      await this.applyChaosCard(game, player);
      return;
    }
    await this.applyPositiveCard(game, player);
  }

  private async applyNegativeCard(game: GameState, player: GamePlayer) {
    const variant = Math.floor(Math.random() * 3);
    if (variant === 0) {
      const amount = Math.round(game.entryFee * 0.18);
      player.balance -= amount;
      this.log(game, `Карта: ${player.name} платит штраф 🪙 ${amount}`, "danger");
      this.processDebt(game, player, "После негативной карты");
      game.phase = "await_end_turn";
      return;
    }

    if (variant === 1) {
      const owned = this.getOwnedProperties(game, player.userId);
      if (!owned.length) {
        this.log(game, `Карта: ${player.name} избежал разрушения (нет улиц)`, "info");
        game.phase = "await_end_turn";
        return;
      }
      const target = owned[Math.floor(Math.random() * owned.length)];
      if (target.shield) {
        target.shield = false;
        this.log(game, `Карта: щит спасает ${target.name} от разрушения`, "warning");
      } else {
        target.level = Math.max(0, target.level - 1);
        this.log(game, `Карта: ${target.name} теряет 1 уровень`, "danger");
      }
      game.phase = "await_end_turn";
      return;
    }

    this.log(game, `Карта: ${player.name} откатывается на 3 клетки`, "warning");
    this.movePlayer(game, player, -3, false);
    await this.resolveLanding(game, player);
  }

  private async applyChaosCard(game: GameState, player: GamePlayer) {
    const variant = Math.floor(Math.random() * 3);

    if (variant === 0) {
      const destination = Math.floor(Math.random() * BOARD_SIZE);
      player.position = destination;
      this.log(game, `Карта хаоса: ${player.name} телепортируется`, "warning");
      await this.resolveLanding(game, player);
      return;
    }

    if (variant === 1) {
      const opponents = game.players.filter((p) => p.userId !== player.userId && p.status !== "bankrupt");
      if (!opponents.length) {
        this.log(game, "Карта хаоса не сработала: нет соперников", "info");
        game.phase = "await_end_turn";
        return;
      }
      const target = opponents[Math.floor(Math.random() * opponents.length)];
      const swing = Math.round(game.entryFee * 0.15);
      player.balance -= swing;
      target.balance += swing;
      this.log(game, `Карта хаоса: ${player.name} переводит ${target.name} 🪙 ${swing}`, "warning");
      this.processDebt(game, player, "После карты хаоса");
      game.phase = "await_end_turn";
      return;
    }

    const targetProperty = this.getRandomOwnedProperty(game, player.userId, true);
    if (!targetProperty) {
      this.log(game, "Карта хаоса: нет вражеской улицы для атаки", "info");
      game.phase = "await_end_turn";
      return;
    }
    if (targetProperty.shield) {
      targetProperty.shield = false;
      this.log(game, `Карта хаоса: щит на ${targetProperty.name} поглощает удар`, "warning");
    } else {
      targetProperty.level = Math.max(0, targetProperty.level - 1);
      this.log(game, `Карта хаоса: ${targetProperty.name} теряет уровень`, "danger");
    }
    game.phase = "await_end_turn";
  }

  private async applyPositiveCard(game: GameState, player: GamePlayer) {
    const variant = Math.floor(Math.random() * 4);

    if (variant === 0) {
      const reward = Math.round(game.entryFee * 0.2);
      player.balance += reward;
      this.log(game, `Карта: ${player.name} получает премию 🪙 ${reward}`, "success");
      game.phase = "await_end_turn";
      return;
    }

    if (variant === 1) {
      player.jailFreeCards += 1;
      this.log(game, `Карта: ${player.name} получает карту выхода из тюрьмы`, "success");
      game.phase = "await_end_turn";
      return;
    }

    if (variant === 2) {
      const mine = this.getOwnedProperties(game, player.userId);
      if (!mine.length) {
        this.log(game, "Карта: щит не выдан (нет улиц)", "info");
      } else {
        const target = mine[Math.floor(Math.random() * mine.length)];
        target.shield = true;
        this.log(game, `Карта: ${player.name} получает щит на ${target.name}`, "success");
      }
      game.phase = "await_end_turn";
      return;
    }

    const mine = this.getOwnedProperties(game, player.userId).filter((property) => property.level < 5);
    if (!mine.length) {
      this.log(game, "Карта: бесплатное улучшение не применилось", "info");
      game.phase = "await_end_turn";
      return;
    }

    const target = mine[Math.floor(Math.random() * mine.length)];
    target.level += 1;
    this.log(game, `Карта: ${target.name} получает бесплатный апгрейд`, "success");
    game.phase = "await_end_turn";
  }

  private getRandomOwnedProperty(game: GameState, userId: string, fromOpponents: boolean) {
    const list = game.properties.filter((property) =>
      fromOpponents ? property.ownerId && property.ownerId !== userId : property.ownerId === userId
    );
    if (!list.length) return undefined;
    return list[Math.floor(Math.random() * list.length)];
  }

  private markPlayerBankrupt(game: GameState, userId: string, reason: string) {
    const player = game.players.find((item) => item.userId === userId);
    if (!player || player.status === "bankrupt") return;

    player.status = "bankrupt";
    player.bankruptAtRound = game.round;
    player.doublesInRow = 0;
    player.inJailTurns = 0;
    game.eliminatedOrder.push(player.userId);
    this.log(game, `${player.name} объявлен банкротом (${reason})`, "danger");

    for (const property of game.properties) {
      if (property.ownerId === player.userId) {
        property.ownerId = undefined;
        property.level = 0;
        property.shield = false;
      }
    }

    game.pendingTrades = game.pendingTrades.filter(
      (trade) => trade.fromPlayerId !== userId && trade.toPlayerId !== userId
    );
  }

  private processDebt(game: GameState, player: GamePlayer, reason: string) {
    if (player.status === "bankrupt") return;
    if (player.balance >= 0) {
      if (player.status === "debt") {
        player.status = "active";
      }
      return;
    }

    player.status = "debt";
    this.log(game, `${player.name} уходит в debt mode (${reason})`, "warning");

    while (player.balance < 0) {
      const assets = this.getOwnedProperties(game, player.userId).sort((a, b) => {
        const scoreA = a.basePrice + a.level * a.basePrice * 0.2;
        const scoreB = b.basePrice + b.level * b.basePrice * 0.2;
        return scoreA - scoreB;
      });
      const asset = assets[0];
      if (!asset) break;

      const salePrice = Math.round(asset.basePrice * 0.7 + asset.level * asset.basePrice * 0.25);
      player.balance += salePrice;
      this.log(game, `${player.name} продаёт ${asset.name} банку за 🪙 ${salePrice}`, "warning");
      asset.ownerId = undefined;
      asset.level = 0;
      asset.shield = false;
    }

    if (player.balance < 0) {
      this.markPlayerBankrupt(game, player.userId, "Не смог закрыть долг");
      return;
    }

    player.status = "active";
  }

  private findNextActivePlayer(game: GameState, currentUserId: string) {
    const activeOrder = game.players.filter(isActive);
    if (!activeOrder.length) return undefined;

    const currentIndex = activeOrder.findIndex((player) => player.userId === currentUserId);
    if (currentIndex < 0) {
      return activeOrder[0];
    }
    return activeOrder[(currentIndex + 1) % activeOrder.length];
  }

  private ownerHasColorSet(game: GameState, ownerId: string, color: PropertyState["color"]): boolean {
    const properties = game.properties.filter((property) => property.color === color);
    return properties.every((property) => property.ownerId === ownerId);
  }

  private movePlayer(game: GameState, player: GamePlayer, steps: number, grantStartBonus = true) {
    const old = player.position;
    const next = ((old + steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
    player.position = next;

    if (steps > 0 && grantStartBonus && old + steps >= BOARD_SIZE) {
      const bonus = Math.round(game.entryFee * START_BONUS_MULTIPLIER);
      player.balance += bonus;
      this.log(game, `${player.name} пересекает START и получает 🪙 ${bonus}`, "success");
    }
  }

  private sendToJail(game: GameState, player: GamePlayer, reason: string) {
    player.position = 5;
    player.status = "jailed";
    player.inJailTurns = 2;
    player.doublesInRow = 0;
    this.log(game, `${player.name} отправляется в тюрьму (${reason})`, "danger");
  }

  private validateTradeProperties(game: GameState, ownerId: string, propertyIds: string[]) {
    for (const propertyId of propertyIds) {
      const property = this.mustGetProperty(game, propertyId);
      if (property.ownerId !== ownerId) {
        throw new Error("Некорректный набор улиц в трейде");
      }
    }
  }

  private async evaluateGameEnd(room: RoomState) {
    const game = room.gameState;
    if (!game || game.status !== "playing") return;
    const active = game.players.filter(isActive);
    if (active.length <= 1 || game.round > game.maxRounds) {
      await this.finishGame(room);
    }
  }

  private async finishGame(room: RoomState) {
    const game = room.gameState;
    if (!game || game.status === "finished") return;
    game.status = "finished";
    room.status = "finished";
    game.phase = "await_end_turn";
    game.pendingPropertyId = undefined;
    game.pendingBuyoutPropertyId = undefined;
    game.currentTurnPlayerId = undefined;

    const nonBankrupt = game.players
      .filter((player) => player.status !== "bankrupt")
      .sort((a, b) => b.balance - a.balance);
    const bankruptIds = [...game.eliminatedOrder].reverse();
    const bankruptPlayers = bankruptIds
      .map((id) => game.players.find((player) => player.userId === id))
      .filter((player): player is GamePlayer => Boolean(player));

    const ranking = [...nonBankrupt, ...bankruptPlayers];
    const payoutBase = game.entryFee;

    const updates = ranking.map(async (player, index) => {
      const placement = index + 1;
      const payout =
        player.status === "bankrupt" ? 0 : Math.round((payoutBase * payoutPercent(placement)) / 100);

      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: player.userId },
          data: {
            balance: { increment: payout },
            gamesPlayed: { increment: 1 },
            wins: { increment: placement === 1 ? 1 : 0 },
            totalPayout: { increment: payout },
            totalEntryFees: { increment: game.entryFee }
          }
        }),
        this.prisma.matchResult.create({
          data: {
            userId: player.userId,
            placement,
            entryFee: game.entryFee,
            payout
          }
        })
      ]);
    });

    await Promise.all(updates);
    this.log(game, "Игра завершена. Выплаты начислены", "success");
  }

  private getOwnedProperties(game: GameState, userId: string) {
    return game.properties.filter((property) => property.ownerId === userId);
  }

  private randomDice() {
    return Math.floor(Math.random() * 6) + 1;
  }

  private log(game: GameState, text: string, level: GameLogEntry["level"]) {
    game.log.push({
      id: entryId(),
      text,
      level,
      createdAt: Date.now()
    });
    game.log = game.log.slice(-80);
  }

  private mustGetRoom(code: string): RoomState {
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error("Комната не найдена");
    }
    return room;
  }

  private getGameByCode(code: string): GameState {
    const room = this.mustGetRoom(code);
    if (!room.gameState) {
      throw new Error("Игра не запущена");
    }
    return room.gameState;
  }

  private getCurrentPlayer(game: GameState, userId: string): GamePlayer {
    if (game.currentTurnPlayerId !== userId) {
      throw new Error("Сейчас не ваш ход");
    }
    return this.mustGetPlayer(game, userId);
  }

  private mustGetPlayer(game: GameState, userId: string): GamePlayer {
    const player = game.players.find((item) => item.userId === userId);
    if (!player) {
      throw new Error("Игрок не найден");
    }
    return player;
  }

  private mustGetProperty(game: GameState, propertyId: string): PropertyState {
    const property = game.properties.find((item) => item.id === propertyId);
    if (!property) {
      throw new Error("Улица не найдена");
    }
    return property;
  }

  private async debitUserBalance(userId: string, amount: number): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, balance: { gte: amount } },
      data: { balance: { decrement: amount } }
    });
    return result.count > 0;
  }

  private async creditUserBalance(userId: string, amount: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } }
    });
  }
}

export const toRoomPayload = (room: RoomState) => ({
  code: room.code,
  hostId: room.hostId,
  entryFee: room.entryFee,
  maxPlayers: room.maxPlayers,
  status: room.status,
  players: room.players,
  gameState: room.gameState
});

export const ensurePlayer = async (
  prisma: PrismaClient,
  input: { userId?: string; name?: string; avatarUrl?: string; telegramId?: string }
) => {
  const fallbackName = input.name?.trim() || "Business Player";

  if (input.userId) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new Error("Пользователь не найден");
    }
    if (input.name || input.avatarUrl) {
      return prisma.user.update({
        where: { id: user.id },
        data: { name: fallbackName, avatarUrl: input.avatarUrl ?? user.avatarUrl ?? null }
      });
    }
    return user;
  }

  if (input.telegramId) {
    const existing = await prisma.user.findUnique({ where: { telegramId: input.telegramId } });
    if (existing) {
      return prisma.user.update({
        where: { id: existing.id },
        data: {
          name: fallbackName,
          avatarUrl: input.avatarUrl ?? existing.avatarUrl
        }
      });
    }
  }

  return prisma.user.create({
    data: {
      name: fallbackName,
      avatarUrl: input.avatarUrl,
      telegramId: input.telegramId
    }
  });
};

export const toParticipant = (user: {
  id: string;
  name: string;
  avatarUrl: string | null;
}): RoomParticipant => ({
  userId: user.id,
  name: user.name,
  avatarUrl: user.avatarUrl ?? undefined
});
