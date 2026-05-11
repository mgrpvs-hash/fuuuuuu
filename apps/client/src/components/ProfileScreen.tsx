import type { ProfileState } from "@monopoly/shared";

interface ProfileScreenProps {
  profile: ProfileState | null;
}

export function ProfileScreen({ profile }: ProfileScreenProps) {
  if (!profile) {
    return (
      <div className="glass-panel rounded-card border p-4 text-sm text-emerald-300">
        Профиль загружается...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-card border p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gold/45 bg-panel text-2xl">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} className="h-full w-full rounded-full object-cover" alt={profile.name} />
            ) : (
              profile.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gold">{profile.name}</h2>
            <div className="text-sm text-emerald-100">Текущий баланс: 🪙 {profile.balance}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Stat title="Игры сыграно" value={profile.gamesPlayed} />
        <Stat title="Побед" value={profile.wins} />
        <Stat title="Поражений" value={profile.losses} />
        <Stat title="Win rate" value={`${profile.winRate}%`} />
        <Stat title="Общая прибыль" value={`🪙 ${profile.totalProfit}`} />
        <Stat title="Лучший выигрыш" value={`🪙 ${profile.bestWin}`} />
      </div>

      <div className="glass-panel rounded-card border p-4">
        <div className="text-sm text-emerald-100">Платежи (MVP заглушка)</div>
        <div className="mt-3 flex gap-2">
          <button className="rounded-xl bg-gradient-to-r from-green to-gold px-4 py-2 text-sm font-semibold text-black">
            Пополнить
          </button>
          <button className="rounded-xl border border-borderSoft bg-panel px-4 py-2 text-sm text-emerald-100">
            Вывести
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="glass-panel rounded-card border p-3">
      <div className="text-xs uppercase tracking-wide text-emerald-300">{title}</div>
      <div className="mt-1 text-lg font-semibold text-gold">{value}</div>
    </div>
  );
}
