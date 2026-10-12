import { ROOT, type Block, type Records } from "./store";
import { isTrashed } from "./tree";

export type Grade = "again" | "good" | "easy";
const DAY = 24 * 60 * 60 * 1000;

/**
 * When a card should come back after being answered. "Again" brings it back
 * in ten minutes and resets the gap; "good" roughly doubles the gap (first
 * time: one day); "easy" grows it faster (first time: four days).
 */
export function review(card: Block["card"], grade: Grade, now: number): NonNullable<Block["card"]> {
  if (grade === "again") return { interval: 0, due: now + 10 * 60 * 1000 };
  const previous = card?.interval ?? 0;
  const interval = grade === "good" ? Math.max(1, Math.round(previous * 2.2)) : Math.max(4, Math.round(previous * 3.5));
  return { interval, due: now + interval * DAY };
}

/** Every toggle with something inside it is a card: the toggle's line is the question, its contents the answer. */
export const isCard = (block: Block) => block.type === "toggle" && block.content.length > 0 && block.text.trim() !== "";

/** The cards to review now, the longest-waiting first. Cards never reviewed count as due. */
export function dueCards(records: Records, now: number): Block[] {
  return Object.values(records)
    .filter((block) => block.id !== ROOT && isCard(block) && (block.card?.due ?? 0) <= now && !isTrashed(records, block.id))
    .sort((a, b) => (a.card?.due ?? 0) - (b.card?.due ?? 0));
}
