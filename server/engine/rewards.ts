import { createHash } from "node:crypto";
import type { Achievement, CoinEntry, RewardsSummary, Task } from "../../shared/types.js";
import { WEARABLES } from "../../shared/cosmetics.js";
import { transaction } from "../db/database.js";
import type { Store } from "../db/store.js";
import { startOfUtcDay } from "./budget.js";

/**
 * Town coins.
 *
 * - Earned ONLY by the server, for verified work: a task that completed with at
 *   least one real (live, request-id-bearing) model call and a non-trivial output.
 *   Simulated, failed and cancelled tasks earn nothing. There is no endpoint that
 *   grants coins and no self-reported metric (revenue, sales…) is ever rewarded.
 * - Idempotent: the ledger's unique `ref` makes each task reward, achievement
 *   and purchase happen at most once, whatever retries or restarts occur.
 * - Anti-farming: a daily cap on task coins, reduced coins for delegated
 *   subtasks, and no coins for repeating the same brief within 24 hours.
 * - No cash value: coins buy cosmetics only and can't be bought, sold or withdrawn.
 */

export const TASK_COINS = 10;
export const DELEGATED_TASK_COINS = 5;
export const DELIVERABLE_BONUS = 15;
export const DAILY_TASK_COIN_CAP = 150;
const MIN_OUTPUT_CHARS = 80;
const MIN_OUTPUT_TOKENS = 50;

interface AchievementDef {
  id: string;
  name: string;
  description: string;
  coins: number;
  /** Checked after each rewarded task. */
  unlocked: (s: { verifiedTasks: number; deliverables: number; projectDone: boolean }) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first-task", name: "First day on the job", description: "A villager finished their first real task.", coins: 25, unlocked: (s) => s.verifiedTasks >= 1 },
  { id: "tasks-10", name: "Busy bees", description: "10 real tasks finished.", coins: 50, unlocked: (s) => s.verifiedTasks >= 10 },
  { id: "tasks-50", name: "Bustling town", description: "50 real tasks finished.", coins: 150, unlocked: (s) => s.verifiedTasks >= 50 },
  { id: "first-deliverable", name: "Special delivery", description: "A campaign delivered its final deliverable.", coins: 50, unlocked: (s) => s.deliverables >= 1 },
  { id: "project-done", name: "Team effort", description: "Three real tasks finished within one project.", coins: 40, unlocked: (s) => s.projectDone },
];

const now = () => new Date().toISOString();
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function insert(store: Store, e: { amount: number; reason: string; ref: string; kind: string; contentKey?: string | null }): boolean {
  const res = store.db
    .prepare("INSERT OR IGNORE INTO coin_ledger (ts, amount, reason, ref, kind, content_key) VALUES (?, ?, ?, ?, ?, ?)")
    .run(now(), e.amount, e.reason, e.ref, e.kind, e.contentKey ?? null);
  return Number(res.changes) > 0;
}

export function coinBalance(store: Store): number {
  return Number((store.db.prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM coin_ledger").get() as { b: number }).b);
}

function taskCoinsToday(store: Store): number {
  return Number((store.db.prepare("SELECT COALESCE(SUM(amount), 0) AS c FROM coin_ledger WHERE kind = 'task' AND ts >= ?").get(startOfUtcDay().toISOString()) as { c: number }).c);
}

export function ownedItems(store: Store): string[] {
  return (store.db.prepare("SELECT item_id FROM owned_items ORDER BY acquired_at").all() as { item_id: string }[]).map((r) => r.item_id);
}

export function rewardsSummary(store: Store): RewardsSummary {
  return { balance: coinBalance(store), earnedToday: taskCoinsToday(store), dailyCap: DAILY_TASK_COIN_CAP, owned: ownedItems(store) };
}

export function ledger(store: Store, limit = 50): CoinEntry[] {
  return (store.db.prepare("SELECT id, ts, amount, reason, ref FROM coin_ledger ORDER BY id DESC LIMIT ?").all(limit) as unknown as CoinEntry[]).map((r) => ({ ...r, id: Number(r.id), amount: Number(r.amount) }));
}

export function achievements(store: Store): Achievement[] {
  const unlocked = new Map((store.db.prepare("SELECT id, unlocked_at FROM achievements").all() as { id: string; unlocked_at: string }[]).map((r) => [r.id, r.unlocked_at]));
  return ACHIEVEMENTS.map(({ id, name, description, coins }) => ({ id, name, description, coins, unlockedAt: unlocked.get(id) ?? null }));
}

/** Why a completed task earns nothing, or null if it is verified real work. */
export function unverifiedReason(task: Task): string | null {
  if (task.status !== "completed") return "not completed";
  if (task.simulated || task.execution.mode !== "live" || !task.execution.lastRequestId) return "no live model call";
  if ((task.output ?? "").trim().length < MIN_OUTPUT_CHARS || task.execution.outputTokens < MIN_OUTPUT_TOKENS) return "output too short";
  return null;
}

/** Award coins for a just-completed task (idempotent; safe to call more than once). */
export function rewardTask(store: Store, taskId: string, simulated: boolean): number {
  const task = store.getTask(taskId);
  if (!task || simulated || unverifiedReason(task)) return 0;
  const contentKey = createHash("sha256").update(`${normalize(task.title)}\n${normalize(task.instructions)}`).digest("hex");
  let earned = 0;
  transaction(store.db, () => {
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const repeat = store.db.prepare("SELECT 1 FROM coin_ledger WHERE content_key = ? AND ts >= ? LIMIT 1").get(contentKey, dayAgo);
    // Subtasks an agent delegated (via the tool) earn less, so delegation fan-out isn't a coin farm.
    const base = task.delegationDepth > 0 ? DELEGATED_TASK_COINS : TASK_COINS;
    const wf = task.workflowId ? store.getWorkflow(task.workflowId) : null;
    const bonus = wf?.finalTaskId === task.id ? DELIVERABLE_BONUS : 0;
    const room = Math.max(0, DAILY_TASK_COIN_CAP - taskCoinsToday(store));
    const amount = repeat ? 0 : Math.min(room, base + bonus);
    const reason = repeat
      ? `“${task.title}” (same brief as a recent task — no coins)`
      : amount < base + bonus
        ? `“${task.title}” (daily coin cap reached)`
        : bonus
          ? `Delivered “${wf!.title}”`
          : `Finished “${task.title}”`;
    // Written even at 0 coins so each task is settled exactly once. Repeats carry no content key and don't count towards achievements.
    if (insert(store, { amount, reason, ref: `task:${task.id}`, kind: "task", contentKey: repeat ? null : contentKey })) earned = amount;
  });
  if (earned > 0) store.addEvent({ type: "reward.earned", agentId: task.agentId, taskId: task.id, message: `🪙 +${earned} coins — ${task.title}`, data: { coins: earned } });
  checkAchievements(store);
  return earned;
}

export function checkAchievements(store: Store): void {
  const verifiedTasks = Number((store.db.prepare("SELECT COUNT(*) AS n FROM coin_ledger WHERE kind = 'task' AND content_key IS NOT NULL").get() as { n: number }).n);
  const deliverables = store.listWorkflows(500).filter((w) => w.status === "completed" && w.finalTaskId && store.db.prepare("SELECT 1 FROM coin_ledger WHERE ref = ? AND content_key IS NOT NULL").get(`task:${w.finalTaskId}`)).length;
  const projectDone = !!store.db
    .prepare(
      `SELECT t.project_id FROM tasks t JOIN coin_ledger l ON l.ref = 'task:' || t.id
       WHERE t.project_id IS NOT NULL AND l.content_key IS NOT NULL GROUP BY t.project_id HAVING COUNT(*) >= 3 LIMIT 1`,
    )
    .get();
  for (const a of ACHIEVEMENTS) {
    if (!a.unlocked({ verifiedTasks, deliverables, projectDone })) continue;
    let fresh = false;
    transaction(store.db, () => {
      fresh = Number(store.db.prepare("INSERT OR IGNORE INTO achievements (id, unlocked_at) VALUES (?, ?)").run(a.id, now()).changes) > 0;
      if (fresh) insert(store, { amount: a.coins, reason: `Achievement: ${a.name}`, ref: `achievement:${a.id}`, kind: "achievement" });
    });
    if (fresh) store.addEvent({ type: "reward.earned", message: `🏆 ${a.name} — +${a.coins} coins`, data: { achievement: a.id, coins: a.coins } });
  }
}

/** Buy a cosmetic with coins. Atomic: the balance check and the debit happen in one transaction. */
export function buyItem(store: Store, itemId: string): { ok: true; balance: number } | { ok: false; error: string } {
  const item = WEARABLES.find((w) => w.id === itemId);
  if (!item || !item.price) return { ok: false, error: "That item isn't sold in the shop" };
  let result: { ok: true; balance: number } | { ok: false; error: string } = { ok: false, error: "Purchase failed" };
  transaction(store.db, () => {
    if (store.db.prepare("SELECT 1 FROM owned_items WHERE item_id = ?").get(itemId)) {
      result = { ok: false, error: "You already own this" };
      return;
    }
    const balance = coinBalance(store);
    if (balance < item.price!) {
      result = { ok: false, error: `Not enough coins (${balance} of ${item.price})` };
      return;
    }
    store.db.prepare("INSERT INTO owned_items (item_id, acquired_at) VALUES (?, ?)").run(itemId, now());
    insert(store, { amount: -item.price!, reason: `Bought ${item.name}`, ref: `purchase:${itemId}`, kind: "purchase" });
    result = { ok: true, balance: balance - item.price! };
  });
  if (result.ok) store.addEvent({ type: "system.notice", message: `🛍️ Bought ${item.name} for ${item.price} coins`, data: { itemId } });
  return result;
}

/** Shop items an appearance change would newly wear without owning them. */
export function unownedWearables(store: Store, before: Record<string, string | undefined>, after: Record<string, string | undefined>): string[] {
  const owned = new Set(ownedItems(store));
  return Object.entries(after)
    .filter(([slot, id]) => id && id !== before[slot])
    .map(([, id]) => WEARABLES.find((w) => w.id === id))
    .filter((w): w is NonNullable<typeof w> => !!w && !!w.price && !owned.has(w.id))
    .map((w) => w.name);
}
