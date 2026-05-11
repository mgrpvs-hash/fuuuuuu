import type { PlayerColor, ProfileResponse, SessionPlayer } from "@monopoly/shared";
import { prisma } from "./db";

export const guestNames = [
  "Guest Falcon",
  "Guest Nova",
  "Guest Titan",
  "Guest Comet",
  "Guest Luna",
  "Guest Storm"
];

export const avatarPool = ["🦊", "🦁", "🐼", "🐸", "🦉", "🐯"];
export const colorPool: PlayerColor[] = ["yellow", "blue", "red", "green", "purple", "orange"];

export interface PlayerIdentity extends SessionPlayer {}

const randomFrom = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

export const buildGuestIdentity = (): PlayerIdentity => {
  const suffix = Math.floor(Math.random() * 900 + 100);
  return {
    id: `guest_${Math.random().toString(36).slice(2, 10)}`,
    name: `${randomFrom(guestNames)} #${suffix}`,
    avatar: randomFrom(avatarPool),
    color: randomFrom(colorPool)
  };
};

export const ensurePlayer = async (identity: PlayerIdentity) => {
  return prisma.player.upsert({
    where: { id: identity.id },
    update: {
      name: identity.name,
      avatar: identity.avatar,
      color: identity.color
    },
    create: {
      id: identity.id,
      name: identity.name,
      avatar: identity.avatar,
      color: identity.color,
      balance: 5000
    }
  });
};

export const getProfile = async (playerId: string): Promise<ProfileResponse | null> => {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return null;
  }

  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    color: player.color as PlayerColor,
    balance: player.balance,
    gamesPlayed: player.gamesPlayed,
    wins: player.wins,
    losses: player.losses,
    totalProfit: player.totalProfit,
    bestWin: player.bestWin
  };
};
