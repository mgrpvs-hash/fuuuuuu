export type CardCategory = "negative" | "chaos" | "positive";

export type CardEffect =
  | { kind: "money"; amount: number }
  | { kind: "move_to"; index: number }
  | { kind: "move_by"; steps: number }
  | { kind: "go_to_jail" }
  | { kind: "collect_from_each"; amount: number }
  | { kind: "pay_each"; amount: number }
  | { kind: "free_jail_card" }
  | { kind: "random_teleport" }
  | { kind: "free_shield" };

export interface ChanceCard {
  id: string;
  category: CardCategory;
  title: string;
  effect: CardEffect;
}

export const chanceCards: ChanceCard[] = [
  { id: "neg-1", category: "negative", title: "Tax audit: pay $50", effect: { kind: "money", amount: -50 } },
  { id: "neg-2", category: "negative", title: "Repair fees: pay $100", effect: { kind: "money", amount: -100 } },
  { id: "neg-3", category: "negative", title: "Court penalty: pay $150", effect: { kind: "money", amount: -150 } },
  { id: "neg-4", category: "negative", title: "Go directly to jail", effect: { kind: "go_to_jail" } },
  { id: "neg-5", category: "negative", title: "Maintenance bill: pay $200", effect: { kind: "money", amount: -200 } },
  { id: "neg-6", category: "negative", title: "Street repairs: pay each player $25", effect: { kind: "pay_each", amount: 25 } },
  { id: "neg-7", category: "negative", title: "Backpedal three spaces", effect: { kind: "move_by", steps: -3 } },
  { id: "neg-8", category: "negative", title: "Luxury surcharge: pay $75", effect: { kind: "money", amount: -75 } },
  { id: "neg-9", category: "negative", title: "Emergency loan payment: pay $120", effect: { kind: "money", amount: -120 } },
  { id: "neg-10", category: "negative", title: "Court summons: move to jail", effect: { kind: "go_to_jail" } },
  { id: "neg-11", category: "negative", title: "Utility disaster: pay $90", effect: { kind: "money", amount: -90 } },
  { id: "neg-12", category: "negative", title: "Missed rent collection: pay $60", effect: { kind: "money", amount: -60 } },
  { id: "chaos-1", category: "chaos", title: "Teleport to START", effect: { kind: "move_to", index: 0 } },
  { id: "chaos-2", category: "chaos", title: "Move 5 spaces forward", effect: { kind: "move_by", steps: 5 } },
  { id: "chaos-3", category: "chaos", title: "Move 4 spaces backward", effect: { kind: "move_by", steps: -4 } },
  { id: "chaos-4", category: "chaos", title: "Collect $20 from each player", effect: { kind: "collect_from_each", amount: 20 } },
  { id: "chaos-5", category: "chaos", title: "Pay each player $15", effect: { kind: "pay_each", amount: 15 } },
  { id: "chaos-6", category: "chaos", title: "Random teleport", effect: { kind: "random_teleport" } },
  { id: "chaos-7", category: "chaos", title: "Move to FREE PARKING", effect: { kind: "move_to", index: 20 } },
  { id: "chaos-8", category: "chaos", title: "Move to nearest utility lane", effect: { kind: "move_to", index: 28 } },
  { id: "chaos-9", category: "chaos", title: "Move to nearest railroad", effect: { kind: "move_to", index: 35 } },
  { id: "chaos-10", category: "chaos", title: "Slip backwards by 2 spaces", effect: { kind: "move_by", steps: -2 } },
  { id: "chaos-11", category: "chaos", title: "Gain one property shield", effect: { kind: "free_shield" } },
  { id: "pos-1", category: "positive", title: "Dividend payout: receive $60", effect: { kind: "money", amount: 60 } },
  { id: "pos-2", category: "positive", title: "Bonus payout: receive $100", effect: { kind: "money", amount: 100 } },
  { id: "pos-3", category: "positive", title: "Inheritance: receive $200", effect: { kind: "money", amount: 200 } },
  { id: "pos-4", category: "positive", title: "Advance to Boardwalk", effect: { kind: "move_to", index: 39 } },
  { id: "pos-5", category: "positive", title: "Get Out of Jail card", effect: { kind: "free_jail_card" } },
  { id: "pos-6", category: "positive", title: "Lucky trip to START", effect: { kind: "move_to", index: 0 } },
  { id: "pos-7", category: "positive", title: "Gain one property shield", effect: { kind: "free_shield" } },
];
