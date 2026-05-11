import { CHANCE_CARDS, CardTemplate, GameState, PlayerState } from "@monopoly/shared";
import { getPropertyState, randomInt } from "./helpers";

function sampleCard(): CardTemplate {
  const index = randomInt(0, CHANCE_CARDS.length - 1);
  return CHANCE_CARDS[index]!;
}

function randomOwnedProperty(game: GameState, ownerId: string) {
  const owned = game.properties.filter((property) => property.ownerId === ownerId);
  if (!owned.length) {
    return undefined;
  }
  return owned[randomInt(0, owned.length - 1)];
}

function randomEnemy(game: GameState, playerId: string): PlayerState | undefined {
  const enemies = game.players.filter((player) => !player.isBankrupt && player.id !== playerId);
  if (!enemies.length) {
    return undefined;
  }
  return enemies[randomInt(0, enemies.length - 1)];
}

export function drawAndApplyCard(game: GameState, player: PlayerState) {
  const card = sampleCard();
  const amount = Math.round((card.value ?? 0) * game.economyMultiplier);
  let effectText = card.description;

  switch (card.effectType) {
    case "money":
      player.balance += amount;
      effectText = amount >= 0 ? `Получено 🪙 ${amount}` : `Потеряно 🪙 ${Math.abs(amount)}`;
      break;
    case "pay_all": {
      const enemies = game.players.filter((p) => !p.isBankrupt && p.id !== player.id);
      let paidTotal = 0;
      for (const enemy of enemies) {
        enemy.balance += amount;
        player.balance -= amount;
        paidTotal += amount;
      }
      effectText = `Игрок заплатил всем: 🪙 ${paidTotal}`;
      break;
    }
    case "receive_from_all": {
      const enemies = game.players.filter((p) => !p.isBankrupt && p.id !== player.id);
      let received = 0;
      for (const enemy of enemies) {
        enemy.balance -= amount;
        player.balance += amount;
        received += amount;
      }
      effectText = `Все заплатили игроку: 🪙 ${received}`;
      break;
    }
    case "skip_turns":
      player.skipTurns += Math.max(1, card.value ?? 1);
      effectText = `Пропускает ходов: ${Math.max(1, card.value ?? 1)}`;
      break;
    case "cannot_upgrade_turns":
      player.cannotUpgradeTurns += Math.max(1, card.value ?? 1);
      effectText = `Улучшения заблокированы на ${Math.max(1, card.value ?? 1)} хода`;
      break;
    case "go_to_jail":
      player.position = 10;
      player.inJail = true;
      player.jailAttempts = 0;
      player.doubleStreak = 0;
      effectText = "Отправлен в тюрьму";
      break;
    case "lose_shield": {
      const ownWithShield = game.properties.filter((p) => p.ownerId === player.id && p.shielded);
      if (ownWithShield.length) {
        const target = ownWithShield[randomInt(0, ownWithShield.length - 1)]!;
        target.shielded = false;
        effectText = `Щит снят с ${game.board[target.cellIndex]?.name}`;
      } else {
        effectText = "Щитов не было";
      }
      break;
    }
    case "downgrade_property": {
      const property = randomOwnedProperty(game, player.id);
      if (property && property.level > 0) {
        property.level -= 1;
        effectText = `Уровень улицы снижен: ${game.board[property.cellIndex]?.name}`;
      } else {
        effectText = "Нет улиц для понижения";
      }
      break;
    }
    case "reset_property": {
      const property = randomOwnedProperty(game, player.id);
      if (property) {
        property.level = 0;
        property.totalUpgradeSpent = 0;
        effectText = `Улица сброшена до уровня 0: ${game.board[property.cellIndex]?.name}`;
      } else {
        effectText = "Нет улиц для сброса";
      }
      break;
    }
    case "steal_money": {
      const enemy = randomEnemy(game, player.id);
      if (enemy) {
        enemy.balance -= amount;
        player.balance += amount;
        effectText = `Украдено 🪙 ${amount} у ${enemy.name}`;
      } else {
        effectText = "Нет соперников для кражи";
      }
      break;
    }
    case "swap_random_property": {
      const enemy = randomEnemy(game, player.id);
      if (!enemy) {
        effectText = "Нет соперников для обмена";
        break;
      }
      const mine = randomOwnedProperty(game, player.id);
      const theirs = randomOwnedProperty(game, enemy.id);
      if (!mine || !theirs) {
        effectText = "Недостаточно улиц для обмена";
        break;
      }
      mine.ownerId = enemy.id;
      theirs.ownerId = player.id;
      player.properties = player.properties.filter((id) => id !== mine.cellIndex).concat(theirs.cellIndex);
      enemy.properties = enemy.properties.filter((id) => id !== theirs.cellIndex).concat(mine.cellIndex);
      effectText = `Случайный обмен улицами с ${enemy.name}`;
      break;
    }
    case "steal_random_property": {
      const enemy = randomEnemy(game, player.id);
      if (!enemy) {
        effectText = "Нет соперников для кражи";
        break;
      }
      const target = randomOwnedProperty(game, enemy.id);
      if (!target) {
        effectText = "У соперников нет улиц";
        break;
      }
      if (target.shielded) {
        target.shielded = false;
        effectText = `Щит ${enemy.name} снят, кража заблокирована`;
      } else {
        target.ownerId = player.id;
        enemy.properties = enemy.properties.filter((id) => id !== target.cellIndex);
        player.properties.push(target.cellIndex);
        effectText = `Украдена улица ${game.board[target.cellIndex]?.name}`;
      }
      break;
    }
    case "break_enemy_upgrade": {
      const enemy = randomEnemy(game, player.id);
      if (!enemy) {
        effectText = "Нет соперников";
        break;
      }
      const target = randomOwnedProperty(game, enemy.id);
      if (!target) {
        effectText = "Нет цели";
        break;
      }
      if (target.shielded) {
        target.shielded = false;
        effectText = `Щит на ${game.board[target.cellIndex]?.name} разрушен`;
      } else if (target.level > 0) {
        target.level -= 1;
        effectText = `Улица ${game.board[target.cellIndex]?.name} потеряла 1 уровень`;
      } else {
        effectText = "Улица уже без улучшений";
      }
      break;
    }
    case "delete_enemy_property": {
      const enemy = randomEnemy(game, player.id);
      if (!enemy) {
        effectText = "Нет соперников";
        break;
      }
      const target = randomOwnedProperty(game, enemy.id);
      if (!target) {
        effectText = "Нет цели";
        break;
      }
      if (target.shielded) {
        target.shielded = false;
        effectText = `Щит на ${game.board[target.cellIndex]?.name} разрушен`;
      } else {
        target.ownerId = null;
        target.level = 0;
        target.totalUpgradeSpent = 0;
        enemy.properties = enemy.properties.filter((id) => id !== target.cellIndex);
        effectText = `Улица ${game.board[target.cellIndex]?.name} удалена в банк`;
      }
      break;
    }
    case "remove_enemy_shield": {
      const shielded = game.properties.filter((property) => property.ownerId !== player.id && property.shielded);
      if (shielded.length) {
        const target = shielded[randomInt(0, shielded.length - 1)]!;
        target.shielded = false;
        effectText = `Снят щит с ${game.board[target.cellIndex]?.name}`;
      } else {
        effectText = "Щитов у соперников нет";
      }
      break;
    }
    case "freeze_property": {
      const enemy = randomEnemy(game, player.id);
      if (!enemy) {
        effectText = "Нет соперников";
        break;
      }
      const target = randomOwnedProperty(game, enemy.id);
      if (!target) {
        effectText = "Нет цели";
        break;
      }
      target.frozenTurns += Math.max(1, card.value ?? 2);
      effectText = `Улица ${game.board[target.cellIndex]?.name} заморожена`;
      break;
    }
    case "teleport": {
      const newCell = randomInt(0, game.board.length - 1);
      player.position = newCell;
      effectText = `Телепорт на ${game.board[newCell]?.name}`;
      break;
    }
    case "gain_shield": {
      const target = randomOwnedProperty(game, player.id);
      if (target) {
        target.shielded = true;
        effectText = `Щит установлен на ${game.board[target.cellIndex]?.name}`;
      } else {
        effectText = "Нет улиц для щита";
      }
      break;
    }
    case "free_upgrade": {
      const target = randomOwnedProperty(game, player.id);
      if (target && target.level < 5) {
        target.level += 1;
        effectText = `Бесплатное улучшение: ${game.board[target.cellIndex]?.name}`;
      } else {
        effectText = "Нет улицы для улучшения";
      }
      break;
    }
    case "jail_free_card":
      player.getOutOfJailCards += 1;
      effectText = "Получена карта выхода из тюрьмы";
      break;
    case "buyout_discount":
      player.buyoutDiscountTurns += Math.max(1, card.value ?? 2);
      effectText = `Скидка на выкуп на ${Math.max(1, card.value ?? 2)} хода`;
      break;
    default:
      break;
  }

  const teleportedProperty = getPropertyState(game, player.position);
  if (teleportedProperty?.frozenTurns && teleportedProperty.frozenTurns > 0) {
    teleportedProperty.frozenTurns -= 1;
  }

  return {
    card,
    effectText
  };
}
