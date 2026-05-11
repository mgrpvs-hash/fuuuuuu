import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  PLAYER_COLORS,
  boardPath,
  calculateRent,
  createInitialProperties,
  isOwnableTile,
  type GameEvent,
  type GameState,
  type PlayerState,
  type PropertyState,
  type TradeOffer,
} from "@monopoly/shared";
import { chanceCards, type ChanceCard } from "./cards";

const START_BALANCE = 1500;
const PASS_START_BONUS = 200;
const JAIL_INDEX = 10;
const JAIL_FEE = 100;
const MAX_HISTORY = 80;
const BUYOUT_MULTIPLIER = 1.5;

type TradeInput = Omit<TradeOffer, "id" | "createdAt" | "fromPlayerId">;

const shuffledCards = (): ChanceCard[] => {
  const cards = [...chanceCards];
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
};

export class GameEngine {
  private state: GameState;
  private deck: ChanceCard[];
  private pendingExtraTurnPlayerId: string | null = null;

  constructor(private readonly prisma: PrismaClient) {
    this.deck = shuffledCards();
    this.state = this.createWaitingState();
  }

  async init(): Promise<void> {
    await this.refreshLeaderboard();
  }

  getState(): GameState {
    return this.state;
  }

  addPlayer(socketId: string, playerName: string): PlayerState {
    if (this.state.status !== "waiting") {
      throw new Error("Game already started. Wait for next match.");
    }

    const cleanName = playerName.trim().slice(0, 24);
    if (!cleanName) {
      throw new Error("Player name is required.");
    }

    const duplicateName = this.state.players.find(
      (player) => player.name.toLowerCase() === cleanName.toLowerCase(),
    );
    if (duplicateName) {
      throw new Error("Name is already taken.");
    }

    const player: PlayerState = {
      id: randomUUID(),
      socketId,
      name: cleanName,
      color: PLAYER_COLORS[this.state.players.length % PLAYER_COLORS.length],
      position: 0,
      balance: START_BALANCE,
      hasRolledThisTurn: false,
      doublesCount: 0,
      inJail: false,
      jailTurns: 0,
      hasJailCard: false,
      isBankrupt: false,
      properties: [],
      wins: 0,
      lifetimeProfit: 0,
    };

    this.state.players.push(player);
    this.pushEvent(`${player.name} joined the table.`);
    return player;
  }

  removePlayerBySocket(socketId: string): void {
    const idx = this.state.players.findIndex((player) => player.socketId === socketId);
    if (idx === -1) {
      return;
    }

    const [player] = this.state.players.splice(idx, 1);
    this.pushEvent(`${player.name} left the table.`);

    if (this.state.currentTurnPlayerId === player.id) {
      this.advanceTurn();
    }

    if (this.state.players.length < 2 && this.state.status === "active") {
      this.state.status = "finished";
      this.state.currentTurnPlayerId = null;
      this.state.winnerId = null;
      this.state.canEndTurn = false;
      this.state.actionPrompt = null;
      this.pushEvent("Game finished: not enough players.");
    }
  }

  startGame(requestedByPlayerId: string): void {
    if (this.state.status !== "waiting") {
      throw new Error("Game has already started.");
    }

    if (this.state.players.length < 2) {
      throw new Error("Need at least 2 players.");
    }

    const requester = this.findPlayer(requestedByPlayerId);
    if (!requester) {
      throw new Error("Only joined players can start the game.");
    }

    for (const player of this.state.players) {
      player.position = 0;
      player.balance = START_BALANCE;
      player.hasRolledThisTurn = false;
      player.doublesCount = 0;
      player.inJail = false;
      player.jailTurns = 0;
      player.hasJailCard = false;
      player.isBankrupt = false;
      player.properties = [];
      player.lifetimeProfit = 0;
    }

    this.state.status = "active";
    this.state.startedAt = Date.now();
    this.state.turn = 1;
    this.state.currentTurnPlayerId = this.state.players[0]?.id ?? null;
    this.state.properties = createInitialProperties();
    this.state.latestEvent = null;
    this.state.history = [];
    this.state.lastDiceRoll = null;
    this.state.pendingTrade = null;
    this.state.freeParkingPot = 0;
    this.state.winnerId = null;
    this.state.canEndTurn = false;
    this.state.actionPrompt = null;
    this.pendingExtraTurnPlayerId = null;
    this.deck = shuffledCards();

    this.pushEvent("Game started. Good luck!");
    if (this.state.currentTurnPlayerId) {
      const firstPlayer = this.findPlayer(this.state.currentTurnPlayerId);
      if (firstPlayer) {
        this.pushEvent(`Turn 1: ${firstPlayer.name} to roll.`);
      }
    }
  }

  resetGame(playerId: string): void {
    const requester = this.findPlayer(playerId);
    if (!requester) {
      throw new Error("Only joined players can reset.");
    }

    if (this.state.status !== "finished") {
      throw new Error("Game can be reset only after finish.");
    }

    for (const player of this.state.players) {
      player.position = 0;
      player.balance = START_BALANCE;
      player.hasRolledThisTurn = false;
      player.doublesCount = 0;
      player.inJail = false;
      player.jailTurns = 0;
      player.hasJailCard = false;
      player.isBankrupt = false;
      player.properties = [];
      player.lifetimeProfit = 0;
    }

    this.state.status = "waiting";
    this.state.startedAt = null;
    this.state.turn = 0;
    this.state.currentTurnPlayerId = null;
    this.state.properties = createInitialProperties();
    this.state.latestEvent = null;
    this.state.history = [];
    this.state.freeParkingPot = 0;
    this.state.pendingTrade = null;
    this.state.actionPrompt = null;
    this.state.lastDiceRoll = null;
    this.state.canEndTurn = false;
    this.state.winnerId = null;
    this.pendingExtraTurnPlayerId = null;
    this.deck = shuffledCards();

    this.pushEvent(`${requester.name} reset the match. Ready for a new game.`);
  }

  rollDice(playerId: string): void {
    const player = this.assertCurrentTurn(playerId);

    if (this.state.actionPrompt?.playerId === playerId) {
      throw new Error("Resolve current action first.");
    }

    if (player.hasRolledThisTurn) {
      throw new Error("Only one dice roll is allowed per turn.");
    }

    if (player.isBankrupt) {
      throw new Error("Bankrupt player cannot roll.");
    }

    const dieA = this.randomDie();
    const dieB = this.randomDie();
    const total = dieA + dieB;
    const isDouble = dieA === dieB;

    player.hasRolledThisTurn = true;
    this.state.lastDiceRoll = [dieA, dieB];
    this.state.canEndTurn = false;
    this.state.pendingTrade = null;

    this.pushEvent(`${player.name} rolled ${dieA} + ${dieB}.`);

    if (player.inJail) {
      this.handleJailRoll(player, isDouble, total);
      return;
    }

    if (isDouble) {
      player.doublesCount += 1;
    } else {
      player.doublesCount = 0;
    }

    if (player.doublesCount >= 3) {
      this.sendToJail(player, "Rolled three doubles in a row.");
      this.state.canEndTurn = true;
      return;
    }

    this.movePlayer(player, total);
    this.resolveLanding(player, "dice");

    if (player.isBankrupt) {
      this.state.canEndTurn = true;
      return;
    }

    if (this.state.actionPrompt?.playerId === player.id) {
      this.pendingExtraTurnPlayerId = isDouble ? player.id : null;
      return;
    }

    if (isDouble && !player.inJail) {
      player.hasRolledThisTurn = false;
      this.pendingExtraTurnPlayerId = player.id;
      this.pushEvent(`${player.name} rolled doubles and gets another roll.`);
      return;
    }

    this.pendingExtraTurnPlayerId = null;
    this.state.canEndTurn = true;
  }

  endTurn(playerId: string): void {
    this.assertCurrentTurn(playerId);

    if (!this.state.canEndTurn) {
      throw new Error("You cannot end the turn now.");
    }

    if (this.state.actionPrompt?.playerId === playerId) {
      throw new Error("Resolve action before ending turn.");
    }

    this.state.pendingTrade = null;
    this.advanceTurn();
  }

  buyProperty(playerId: string): void {
    const player = this.assertCurrentTurn(playerId);
    const prompt = this.assertPrompt(playerId, "buy");
    const property = this.getProperty(prompt.propertyId);

    if (property.ownerId) {
      throw new Error("Property is no longer available.");
    }

    this.debitToBank(player, property.price, `${player.name} bought ${property.name}.`);
    if (player.isBankrupt) {
      return;
    }

    property.ownerId = player.id;
    property.upgradeLevel = 0;
    property.shield = false;
    player.properties.push(property.id);

    this.pushEvent(`${player.name} purchased ${property.name} for $${property.price}.`);
    this.clearPromptAndFinish(player);
  }

  upgradeProperty(playerId: string): void {
    const player = this.assertCurrentTurn(playerId);
    const prompt = this.assertPrompt(playerId, "upgrade");
    const property = this.getProperty(prompt.propertyId);

    if (property.ownerId !== player.id) {
      throw new Error("Only owner can upgrade.");
    }

    if (property.upgradeLevel >= 5) {
      throw new Error("Property is already at max level.");
    }

    const upgradeCost = property.upgradeCosts[property.upgradeLevel] ?? property.upgradeCosts.at(-1) ?? 200;
    this.debitToBank(player, upgradeCost, `${player.name} upgraded ${property.name}.`);
    if (player.isBankrupt) {
      return;
    }

    property.upgradeLevel += 1;
    this.pushEvent(`${player.name} upgraded ${property.name} to level ${property.upgradeLevel}.`);
    this.clearPromptAndFinish(player);
  }

  buyoutProperty(playerId: string): void {
    const buyer = this.assertCurrentTurn(playerId);
    const prompt = this.assertPrompt(playerId, "buyout");
    const property = this.getProperty(prompt.propertyId);
    const currentOwner = property.ownerId ? this.findPlayerOrThrow(property.ownerId) : null;

    if (!currentOwner || currentOwner.id === buyer.id) {
      throw new Error("Invalid buyout target.");
    }

    if (property.shield) {
      property.shield = false;
      this.pushEvent(`Shield on ${property.name} absorbed a buyout attack.`);
      this.clearPromptAndFinish(buyer);
      return;
    }

    const buyoutPrice = Math.round(property.price * BUYOUT_MULTIPLIER + property.upgradeLevel * 90);
    this.transferMoney(buyer, currentOwner, buyoutPrice, `${buyer.name} bought out ${property.name}.`);
    if (buyer.isBankrupt) {
      return;
    }

    currentOwner.properties = currentOwner.properties.filter((id) => id !== property.id);
    buyer.properties.push(property.id);
    property.ownerId = buyer.id;
    property.shield = false;

    this.pushEvent(
      `${buyer.name} bought out ${property.name} from ${currentOwner.name} for $${buyoutPrice}.`,
    );
    this.clearPromptAndFinish(buyer);
  }

  skipAction(playerId: string): void {
    const player = this.assertCurrentTurn(playerId);
    if (!this.state.actionPrompt || this.state.actionPrompt.playerId !== playerId) {
      throw new Error("No action to skip.");
    }

    const skipped = this.getProperty(this.state.actionPrompt.propertyId);
    this.pushEvent(`${player.name} skipped action on ${skipped.name}.`);
    this.clearPromptAndFinish(player);
  }

  payToLeaveJail(playerId: string): void {
    const player = this.assertCurrentTurn(playerId);
    if (!player.inJail) {
      throw new Error("Player is not in jail.");
    }

    if (player.hasRolledThisTurn) {
      throw new Error("You cannot pay after rolling.");
    }

    this.debitToBank(player, JAIL_FEE, `${player.name} paid to leave jail.`);
    if (player.isBankrupt) {
      return;
    }

    player.inJail = false;
    player.jailTurns = 0;
    this.pushEvent(`${player.name} paid $${JAIL_FEE} and left jail.`);
  }

  useJailCard(playerId: string): void {
    const player = this.assertCurrentTurn(playerId);
    if (!player.inJail) {
      throw new Error("Player is not in jail.");
    }

    if (!player.hasJailCard) {
      throw new Error("No jail card available.");
    }

    player.hasJailCard = false;
    player.inJail = false;
    player.jailTurns = 0;
    this.pushEvent(`${player.name} used a jail card and left jail.`);
  }

  requestTrade(playerId: string, input: TradeInput): void {
    const sender = this.findPlayerOrThrow(playerId);
    const receiver = this.findPlayerOrThrow(input.toPlayerId);

    if (sender.id === receiver.id) {
      throw new Error("Cannot trade with yourself.");
    }

    if (sender.isBankrupt || receiver.isBankrupt) {
      throw new Error("Bankrupt players cannot trade.");
    }

    if (this.state.pendingTrade) {
      throw new Error("Another trade is already pending.");
    }

    this.assertOwnership(sender, input.offeredPropertyIds);
    this.assertOwnership(receiver, input.requestedPropertyIds);

    if (input.offeredMoney < 0 || input.requestedMoney < 0) {
      throw new Error("Money amounts must be non-negative.");
    }

    this.state.pendingTrade = {
      id: randomUUID(),
      fromPlayerId: sender.id,
      toPlayerId: receiver.id,
      offeredPropertyIds: input.offeredPropertyIds,
      requestedPropertyIds: input.requestedPropertyIds,
      offeredMoney: input.offeredMoney,
      requestedMoney: input.requestedMoney,
      createdAt: Date.now(),
    };

    this.pushEvent(`${sender.name} offered a trade to ${receiver.name}.`);
  }

  respondTrade(playerId: string, accept: boolean): void {
    const trade = this.state.pendingTrade;
    if (!trade) {
      throw new Error("No trade request found.");
    }

    if (trade.toPlayerId !== playerId) {
      throw new Error("Only trade recipient can respond.");
    }

    const from = this.findPlayerOrThrow(trade.fromPlayerId);
    const to = this.findPlayerOrThrow(trade.toPlayerId);

    if (!accept) {
      this.pushEvent(`${to.name} declined trade from ${from.name}.`);
      this.state.pendingTrade = null;
      return;
    }

    this.assertOwnership(from, trade.offeredPropertyIds);
    this.assertOwnership(to, trade.requestedPropertyIds);

    if (from.balance < trade.offeredMoney) {
      throw new Error(`${from.name} no longer has enough cash.`);
    }
    if (to.balance < trade.requestedMoney) {
      throw new Error(`${to.name} no longer has enough cash.`);
    }

    if (trade.offeredMoney > 0) {
      this.transferMoney(from, to, trade.offeredMoney, `${from.name} sent cash in trade.`);
    }
    if (trade.requestedMoney > 0) {
      this.transferMoney(to, from, trade.requestedMoney, `${to.name} sent cash in trade.`);
    }

    this.transferOwnership(from, to, trade.offeredPropertyIds);
    this.transferOwnership(to, from, trade.requestedPropertyIds);

    this.pushEvent(`${to.name} accepted trade from ${from.name}.`);
    this.state.pendingTrade = null;
  }

  async refreshLeaderboard(): Promise<void> {
    const [wins, profits] = (await Promise.all([
      this.prisma.playerStats.findMany({
        orderBy: [{ wins: "desc" }, { totalProfit: "desc" }],
        take: 10,
      }),
      this.prisma.playerStats.findMany({
        orderBy: [{ totalProfit: "desc" }, { wins: "desc" }],
        take: 10,
      }),
    ])) as Array<Array<{ playerName: string; wins: number; totalProfit: number }>>;

    this.state.leaderboard.byWins = wins.map((entry) => ({
      playerName: entry.playerName,
      wins: entry.wins,
      totalProfit: entry.totalProfit,
    }));
    this.state.leaderboard.byProfit = profits.map((entry) => ({
      playerName: entry.playerName,
      wins: entry.wins,
      totalProfit: entry.totalProfit,
    }));
  }

  async persistResults(): Promise<void> {
    const winnerId = this.state.winnerId;
    await Promise.all(
      this.state.players.map((player) =>
        this.prisma.playerStats.upsert({
          where: { playerName: player.name },
          create: {
            playerName: player.name,
            gamesPlayed: 1,
            wins: player.id === winnerId ? 1 : 0,
            totalProfit: player.lifetimeProfit,
          },
          update: {
            gamesPlayed: { increment: 1 },
            wins: player.id === winnerId ? { increment: 1 } : undefined,
            totalProfit: { increment: player.lifetimeProfit },
          },
        }),
      ),
    );
    await this.refreshLeaderboard();
  }

  private createWaitingState(): GameState {
    return {
      id: "default-room",
      status: "waiting",
      startedAt: null,
      turn: 0,
      currentTurnPlayerId: null,
      players: [],
      properties: createInitialProperties(),
      latestEvent: null,
      history: [],
      freeParkingPot: 0,
      pendingTrade: null,
      actionPrompt: null,
      lastDiceRoll: null,
      canEndTurn: false,
      winnerId: null,
      leaderboard: {
        byWins: [],
        byProfit: [],
      },
    };
  }

  private randomDie(): number {
    return Math.floor(Math.random() * 6) + 1;
  }

  private assertPrompt(playerId: string, type: "buy" | "upgrade" | "buyout") {
    const prompt = this.state.actionPrompt;
    if (!prompt || prompt.playerId !== playerId || prompt.type !== type) {
      throw new Error("Requested action is not available.");
    }
    return prompt;
  }

  private assertCurrentTurn(playerId: string): PlayerState {
    if (this.state.status !== "active") {
      throw new Error("Game is not active.");
    }

    if (this.state.currentTurnPlayerId !== playerId) {
      throw new Error("Not your turn.");
    }

    return this.findPlayerOrThrow(playerId);
  }

  private findPlayer(playerId: string): PlayerState | undefined {
    return this.state.players.find((player) => player.id === playerId);
  }

  private findPlayerOrThrow(playerId: string): PlayerState {
    const player = this.findPlayer(playerId);
    if (!player) {
      throw new Error("Player not found.");
    }
    return player;
  }

  private getProperty(propertyId: string): PropertyState {
    const property = this.state.properties[propertyId];
    if (!property) {
      throw new Error("Property not found.");
    }
    return property;
  }

  private pushEvent(message: string): void {
    const event: GameEvent = {
      id: randomUUID(),
      createdAt: Date.now(),
      message,
    };

    this.state.latestEvent = event;
    this.state.history = [...this.state.history, event].slice(-MAX_HISTORY);
  }

  private movePlayer(player: PlayerState, steps: number): void {
    const previousPosition = player.position;
    const rawPosition = player.position + steps;
    let wrappedPosition = rawPosition % 40;
    if (wrappedPosition < 0) {
      wrappedPosition += 40;
    }

    if (steps > 0 && rawPosition >= 40) {
      const laps = Math.floor(rawPosition / 40);
      const bonus = laps * PASS_START_BONUS;
      player.balance += bonus;
      player.lifetimeProfit += bonus;
      this.pushEvent(`${player.name} passed START and collected $${bonus}.`);
    }

    player.position = wrappedPosition;
    this.pushEvent(`${player.name} moved from ${previousPosition} to ${wrappedPosition}.`);
  }

  private moveToPosition(player: PlayerState, position: number): void {
    const previousPosition = player.position;
    if (position < previousPosition) {
      player.balance += PASS_START_BONUS;
      player.lifetimeProfit += PASS_START_BONUS;
      this.pushEvent(`${player.name} passed START and collected $${PASS_START_BONUS}.`);
    }

    player.position = position;
    this.pushEvent(`${player.name} moved to ${position}.`);
  }

  private resolveLanding(player: PlayerState, source: "dice" | "card"): void {
    if (player.isBankrupt) {
      return;
    }

    const tile = boardPath[player.position];

    if (tile.type === "go_to_jail") {
      this.sendToJail(player, "Landed on GO TO JAIL.");
      return;
    }

    if (tile.type === "tax") {
      this.debitToBank(player, tile.amount, `${player.name} paid tax.`);
      this.state.freeParkingPot += tile.amount;
      this.pushEvent(`${tile.name}: $${tile.amount} moved to Free Parking pot.`);
      return;
    }

    if (tile.type === "free_parking" && this.state.freeParkingPot > 0) {
      const reward = this.state.freeParkingPot;
      this.state.freeParkingPot = 0;
      player.balance += reward;
      player.lifetimeProfit += reward;
      this.pushEvent(`${player.name} collected $${reward} from Free Parking.`);
      return;
    }

    if (tile.type === "chance") {
      this.resolveCard(player);
      return;
    }

    if (!isOwnableTile(tile)) {
      if (tile.type === "jail") {
        this.pushEvent(`${player.name} is just visiting jail.`);
      }
      return;
    }

    const property = this.getProperty(String(tile.index));

    if (!property.ownerId) {
      this.state.actionPrompt = {
        playerId: player.id,
        propertyId: property.id,
        type: "buy",
      };
      this.pushEvent(`${property.name} is available for purchase.`);
      return;
    }

    if (property.ownerId === player.id) {
      if (property.upgradeLevel < 5) {
        this.state.actionPrompt = {
          playerId: player.id,
          propertyId: property.id,
          type: "upgrade",
        };
        this.pushEvent(`You can upgrade ${property.name}.`);
      }
      return;
    }

    const owner = this.findPlayerOrThrow(property.ownerId);
    const entryFeeMultiplier = 1 + Math.floor(this.state.turn / 8) * 0.1;
    const rent = calculateRent(property, entryFeeMultiplier);
    this.transferMoney(player, owner, rent, `${player.name} paid rent for ${property.name}.`);

    if (!player.isBankrupt) {
      this.state.actionPrompt = {
        playerId: player.id,
        propertyId: property.id,
        type: "buyout",
        targetOwnerId: owner.id,
        rentDue: rent,
      };
      this.pushEvent(`${player.name} may attempt to buy out ${property.name}.`);
    }

    if (source === "card") {
      this.pushEvent(`Card movement resolved on ${property.name}.`);
    }
  }

  private handleJailRoll(player: PlayerState, isDouble: boolean, total: number): void {
    if (isDouble) {
      player.inJail = false;
      player.jailTurns = 0;
      player.doublesCount = 1;
      this.pushEvent(`${player.name} rolled doubles and escaped jail.`);
      this.movePlayer(player, total);
      this.resolveLanding(player, "dice");
      if (!this.state.actionPrompt) {
        player.hasRolledThisTurn = false;
        this.pendingExtraTurnPlayerId = player.id;
        this.pushEvent(`${player.name} still gets an extra roll due to doubles.`);
      } else {
        this.pendingExtraTurnPlayerId = player.id;
      }
      return;
    }

    player.jailTurns += 1;
    player.doublesCount = 0;
    this.pushEvent(`${player.name} failed to roll doubles in jail (attempt ${player.jailTurns}/3).`);

    if (player.jailTurns >= 3) {
      this.debitToBank(player, JAIL_FEE, `${player.name} paid mandatory jail release fee.`);
      if (player.isBankrupt) {
        this.state.canEndTurn = true;
        return;
      }
      player.inJail = false;
      player.jailTurns = 0;
      this.pushEvent(`${player.name} paid $${JAIL_FEE} after third jail turn and moves.`);
      this.movePlayer(player, total);
      this.resolveLanding(player, "dice");
      if (!this.state.actionPrompt) {
        this.state.canEndTurn = true;
      }
      return;
    }

    this.state.canEndTurn = true;
  }

  private resolveCard(player: PlayerState): void {
    const card = this.deck.shift();
    if (!card) {
      this.deck = shuffledCards();
      this.resolveCard(player);
      return;
    }
    this.deck.push(card);

    this.pushEvent(`${player.name} drew a ${card.category.toUpperCase()} card: ${card.title}`);

    switch (card.effect.kind) {
      case "money": {
        if (card.effect.amount >= 0) {
          player.balance += card.effect.amount;
          player.lifetimeProfit += card.effect.amount;
          this.pushEvent(`${player.name} received $${card.effect.amount}.`);
        } else {
          this.debitToBank(player, Math.abs(card.effect.amount), `${player.name} paid from card effect.`);
        }
        break;
      }
      case "move_to": {
        this.moveToPosition(player, card.effect.index);
        this.resolveLanding(player, "card");
        break;
      }
      case "move_by": {
        this.movePlayer(player, card.effect.steps);
        this.resolveLanding(player, "card");
        break;
      }
      case "go_to_jail": {
        this.sendToJail(player, "Card sent player to jail.");
        break;
      }
      case "collect_from_each": {
        for (const other of this.state.players) {
          if (other.id !== player.id && !other.isBankrupt) {
            this.transferMoney(other, player, card.effect.amount, `${player.name} collected from all players.`);
          }
        }
        break;
      }
      case "pay_each": {
        for (const other of this.state.players) {
          if (other.id !== player.id && !other.isBankrupt) {
            this.transferMoney(player, other, card.effect.amount, `${player.name} paid all players.`);
          }
        }
        break;
      }
      case "free_jail_card": {
        player.hasJailCard = true;
        this.pushEvent(`${player.name} received a Get Out of Jail card.`);
        break;
      }
      case "random_teleport": {
        const randomIndex = Math.floor(Math.random() * 40);
        this.moveToPosition(player, randomIndex);
        this.resolveLanding(player, "card");
        break;
      }
      case "free_shield": {
        const ownProps = player.properties
          .map((propertyId) => this.getProperty(propertyId))
          .filter((property) => !property.shield);
        if (ownProps.length === 0) {
          this.pushEvent(`${player.name} has no property available for shield.`);
          break;
        }
        const target = ownProps[Math.floor(Math.random() * ownProps.length)];
        target.shield = true;
        this.pushEvent(`${player.name} gained a shield on ${target.name}.`);
        break;
      }
      default:
        break;
    }
  }

  private debitToBank(player: PlayerState, amount: number, contextMessage: string): void {
    if (amount <= 0) {
      return;
    }
    player.balance -= amount;
    player.lifetimeProfit -= amount;
    this.pushEvent(`${contextMessage} (-$${amount})`);
    if (player.balance < 0) {
      this.bankruptPlayer(player, "Could not cover payment to bank.");
    }
  }

  private transferMoney(from: PlayerState, to: PlayerState, amount: number, contextMessage: string): void {
    if (amount <= 0 || from.isBankrupt || to.isBankrupt) {
      return;
    }

    from.balance -= amount;
    from.lifetimeProfit -= amount;
    to.balance += amount;
    to.lifetimeProfit += amount;

    this.pushEvent(`${contextMessage} ($${amount} -> ${to.name})`);

    if (from.balance < 0) {
      this.bankruptPlayer(from, "Could not pay another player.");
    }
  }

  private sendToJail(player: PlayerState, reason: string): void {
    player.position = JAIL_INDEX;
    player.inJail = true;
    player.jailTurns = 0;
    player.doublesCount = 0;
    player.hasRolledThisTurn = true;
    this.state.actionPrompt = null;
    this.pendingExtraTurnPlayerId = null;
    this.pushEvent(`${player.name} sent to jail. ${reason}`);
  }

  private clearPromptAndFinish(player: PlayerState): void {
    this.state.actionPrompt = null;

    if (player.isBankrupt) {
      this.state.canEndTurn = true;
      return;
    }

    if (this.pendingExtraTurnPlayerId === player.id) {
      this.pendingExtraTurnPlayerId = null;
      player.hasRolledThisTurn = false;
      this.state.canEndTurn = false;
      this.pushEvent(`${player.name} can roll again due to doubles.`);
      return;
    }

    this.state.canEndTurn = true;
  }

  private advanceTurn(): void {
    const activePlayers = this.state.players.filter((player) => !player.isBankrupt);
    if (activePlayers.length <= 1) {
      this.finishGame();
      return;
    }

    const currentId = this.state.currentTurnPlayerId;
    const players = this.state.players;
    const currentIndex = Math.max(
      players.findIndex((player) => player.id === currentId),
      0,
    );

    let candidate: PlayerState | null = null;
    for (let offset = 1; offset <= players.length; offset += 1) {
      const next = players[(currentIndex + offset) % players.length];
      if (!next.isBankrupt) {
        candidate = next;
        break;
      }
    }

    if (!candidate) {
      this.finishGame();
      return;
    }

    this.state.currentTurnPlayerId = candidate.id;
    this.state.turn += 1;
    this.state.canEndTurn = false;
    this.state.actionPrompt = null;
    this.pendingExtraTurnPlayerId = null;

    for (const player of this.state.players) {
      player.hasRolledThisTurn = false;
      if (player.id !== candidate.id) {
        player.doublesCount = 0;
      }
    }

    this.pushEvent(`Turn ${this.state.turn}: ${candidate.name} to roll.`);
  }

  private bankruptPlayer(player: PlayerState, reason: string): void {
    if (player.isBankrupt) {
      return;
    }

    player.isBankrupt = true;
    player.balance = 0;
    player.doublesCount = 0;
    player.inJail = false;
    player.jailTurns = 0;

    for (const propertyId of player.properties) {
      const property = this.getProperty(propertyId);
      property.ownerId = null;
      property.upgradeLevel = 0;
      property.shield = false;
    }
    player.properties = [];

    if (this.state.pendingTrade) {
      if (
        this.state.pendingTrade.fromPlayerId === player.id ||
        this.state.pendingTrade.toPlayerId === player.id
      ) {
        this.state.pendingTrade = null;
      }
    }

    if (this.state.actionPrompt?.playerId === player.id) {
      this.state.actionPrompt = null;
    }

    this.pushEvent(`${player.name} is bankrupt. ${reason}`);
    this.finishGame();
  }

  private finishGame(): void {
    if (this.state.status !== "active") {
      return;
    }

    const alive = this.state.players.filter((player) => !player.isBankrupt);
    if (alive.length > 1) {
      return;
    }

    if (alive.length === 1) {
      this.state.winnerId = alive[0].id;
      this.pushEvent(`${alive[0].name} wins the game!`);
    } else {
      this.state.winnerId = null;
      this.pushEvent("Game ended without a winner.");
    }

    this.state.status = "finished";
    this.state.currentTurnPlayerId = null;
    this.state.canEndTurn = false;
    this.state.actionPrompt = null;
    this.pendingExtraTurnPlayerId = null;

    void this.persistResults().catch((error) => {
      this.pushEvent(`Failed to persist results: ${(error as Error).message}`);
    });
  }

  private assertOwnership(owner: PlayerState, propertyIds: string[]): void {
    for (const propertyId of propertyIds) {
      if (!owner.properties.includes(propertyId)) {
        throw new Error(`${owner.name} does not own property ${propertyId}.`);
      }
    }
  }

  private transferOwnership(from: PlayerState, to: PlayerState, propertyIds: string[]): void {
    for (const propertyId of propertyIds) {
      const property = this.getProperty(propertyId);
      if (property.ownerId !== from.id) {
        throw new Error(`Property ${property.name} changed owner during trade.`);
      }

      property.ownerId = to.id;
      from.properties = from.properties.filter((id) => id !== propertyId);
      to.properties.push(propertyId);
    }
  }
}
