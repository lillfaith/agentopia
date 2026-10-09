import { useEffect, useState } from "react";
import type { Achievement, CoinEntry } from "../../../shared/types";
import { WEARABLES } from "../../../shared/cosmetics";
import { DEMO, api } from "../api/client";
import { useTown } from "../state/store";
import { useTheme } from "../theme-engine/ThemeContext";
import { Badge, Drawer, Empty, timeAgo } from "./common";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const SHOP_ITEMS = WEARABLES.filter((w) => w.price);

/** Coins, achievements and the cosmetics shop. */
export function RewardsPanel() {
  const theme = useTheme();
  const close = useTown((s) => s.openPanel);
  const push = useTown((s) => s.pushToast);
  const load = useTown((s) => s.load);
  const rewards = useTown((s) => s.snapshot!.rewards);
  const [detail, setDetail] = useState<{ ledger: CoinEntry[]; achievements: Achievement[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (DEMO) return;
    api.rewards().then(setDetail, () => setDetail({ ledger: [], achievements: [] }));
  }, [rewards.balance]);
  const buy = async (id: string) => {
    setBusy(id);
    try {
      await api.buyItem(id);
      push({ tone: "good", text: "Bought! Find it in any villager's wardrobe ✨" });
      await load();
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  const owned = new Set(rewards.owned);
  return (
    <Drawer side="left" title="Rewards & shop" icon={theme.ui.icons.rewards} onClose={() => close(null)} wide>
      <section className="card">
        <div className="row between">
          <h3>✨ {rewards.balance} coins</h3>
          <small className="muted">
            {rewards.earnedToday}/{rewards.dailyCap} earned from tasks today
          </small>
        </div>
        <p className="muted small">
          Villagers earn coins for real, verified work: a task that finished with a live Claude call and a real answer. Simulated, failed or repeated tasks don't count. Coins buy cosmetics only and have no cash
          value.
        </p>
      </section>

      <section className="card">
        <h3>Boutique</h3>
        <div className="item-grid">
          {SHOP_ITEMS.map((w) => (
            <div key={w.id} className={`item ${owned.has(w.id) ? "on" : ""}`} title={w.description}>
              <span className="item-icon">{w.icon}</span>
              <span>{w.name}</span>
              {owned.has(w.id) ? (
                <small className="muted">Owned</small>
              ) : (
                <button className="btn primary" disabled={DEMO || busy !== null || rewards.balance < w.price!} onClick={() => buy(w.id)}>
                  ✨ {w.price}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Achievements</h3>
        {!detail && <p className="muted">Loading…</p>}
        {detail?.achievements.map((a) => (
          <div key={a.id} className="row between">
            <span>
              {a.unlockedAt ? "🏆" : "🔒"} <b>{a.name}</b> <small className="muted">— {a.description}</small>
            </span>
            <Badge tone={a.unlockedAt ? "good" : "muted"}>+{a.coins}</Badge>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Coin history</h3>
        {detail && !detail.ledger.length && <Empty>No coins yet. Assign a task and watch your villagers earn their first ones.</Empty>}
        {detail?.ledger.map((e) => (
          <div key={e.id} className="row between">
            <span>{e.reason}</span>
            <span className="row gap-s">
              <small className="muted">{timeAgo(e.ts)}</small>
              <Badge tone={e.amount > 0 ? "good" : e.amount < 0 ? "accent" : "muted"}>{e.amount > 0 ? `+${e.amount}` : e.amount}</Badge>
            </span>
          </div>
        ))}
      </section>
    </Drawer>
  );
}
