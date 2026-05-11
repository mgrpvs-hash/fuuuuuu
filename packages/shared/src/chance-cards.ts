export type ChanceCardEffect =
  | "money_minus_100"
  | "money_minus_150"
  | "money_minus_200"
  | "pay_each_50"
  | "pay_richest_150"
  | "skip_turn"
  | "downgrade_random_own"
  | "reset_random_own"
  | "lose_random_shield"
  | "go_to_jail"
  | "no_upgrade_2_turns"
  | "repair_tax"
  | "steal_100_from_richest"
  | "all_pay_you_50"
  | "swap_random_property"
  | "steal_random_property"
  | "downgrade_random_enemy"
  | "delete_random_enemy_property"
  | "remove_enemy_shield"
  | "freeze_enemy_property"
  | "teleport_random"
  | "teleport_to_own"
  | "x2_rent_3_turns"
  | "money_plus_100"
  | "money_plus_150"
  | "money_plus_200"
  | "gain_shield"
  | "free_upgrade"
  | "jail_free_card"
  | "buyout_discount";

export interface ChanceCard {
  id: string;
  label: string;
  effect: ChanceCardEffect;
}

export const chanceCards: ChanceCard[] = [
  { id: "c01", label: "-100", effect: "money_minus_100" },
  { id: "c02", label: "-150", effect: "money_minus_150" },
  { id: "c03", label: "-200", effect: "money_minus_200" },
  { id: "c04", label: "Заплати каждому игроку 50", effect: "pay_each_50" },
  { id: "c05", label: "Заплати самому богатому 150", effect: "pay_richest_150" },
  { id: "c06", label: "Пропусти следующий ход", effect: "skip_turn" },
  { id: "c07", label: "Понизь уровень случайной своей улицы", effect: "downgrade_random_own" },
  { id: "c08", label: "Сбрось случайную свою улицу до 0", effect: "reset_random_own" },
  { id: "c09", label: "Потеряй щит на случайной своей улице", effect: "lose_random_shield" },
  { id: "c10", label: "Отправляйся в тюрьму", effect: "go_to_jail" },
  { id: "c11", label: "Нельзя улучшать улицы 2 хода", effect: "no_upgrade_2_turns" },
  { id: "c12", label: "Налог на ремонт", effect: "repair_tax" },
  { id: "c13", label: "Укради 100 у самого богатого", effect: "steal_100_from_richest" },
  { id: "c14", label: "Все игроки платят тебе по 50", effect: "all_pay_you_50" },
  { id: "c15", label: "Поменяйся случайной улицей", effect: "swap_random_property" },
  { id: "c16", label: "Укради случайную улицу", effect: "steal_random_property" },
  { id: "c17", label: "Сломай уровень на чужой улице", effect: "downgrade_random_enemy" },
  { id: "c18", label: "Удали случайную чужую улицу", effect: "delete_random_enemy_property" },
  { id: "c19", label: "Сними щит с чужой улицы", effect: "remove_enemy_shield" },
  { id: "c20", label: "Заморозь чужую улицу на 2 хода", effect: "freeze_enemy_property" },
  { id: "c21", label: "Телепорт на случайную клетку", effect: "teleport_random" },
  { id: "c22", label: "Телепорт на свою улицу", effect: "teleport_to_own" },
  { id: "c23", label: "x2 аренда на 3 хода", effect: "x2_rent_3_turns" },
  { id: "c24", label: "+100", effect: "money_plus_100" },
  { id: "c25", label: "+150", effect: "money_plus_150" },
  { id: "c26", label: "+200", effect: "money_plus_200" },
  { id: "c27", label: "Получи щит", effect: "gain_shield" },
  { id: "c28", label: "Бесплатное улучшение", effect: "free_upgrade" },
  { id: "c29", label: "Карта выхода из тюрьмы", effect: "jail_free_card" },
  { id: "c30", label: "Скидка 50% на выкуп", effect: "buyout_discount" }
];
