/**
 * Tron has no mature, widely-used equivalent of 1inch's Limit Order
 * Protocol — no off-chain-signed, on-chain-settled resting order book
 * with a resolver network filling it for you. Building a real one from
 * scratch would mean writing and auditing a custom settlement contract,
 * which is a much bigger and riskier undertaking than wiring up an
 * existing, audited protocol.
 *
 * This module is the honest fallback instead: a CLIENT-SIDE watcher.
 * It stores your target price locally, polls the live SunSwap quote,
 * and fires a real swap the moment the condition is met.
 *
 * This is fundamentally weaker than a true resting on-chain order:
 *   - No funds are locked or committed until the moment it fires —
 *     someone could spend the balance elsewhere and the fire will fail.
 *   - It ONLY works while this app is running and polling. Close the
 *     app, lose connectivity, or let the phone kill it in the
 *     background, and a price crossing during that window is missed
 *     entirely — nothing was ever placed on-chain.
 *   - There's no resolver/MEV-searcher network racing to fill you at
 *     the best available moment; it fires on whatever price your own
 *     poll happened to see.
 * The UI (DexTradeScreen.js) must keep saying this plainly, not bury it
 * in a tooltip.
 */

import { quoteTronSwap, executeTronSwap } from "./tronSwapEngine";
import { getWatchingOrders, markWatchOrderFilled, markWatchOrderFailed } from "../db/tronWatchRepo";

const conditionMet = (direction, currentPrice, targetPrice) =>
  direction === "above" ? currentPrice >= targetPrice : currentPrice <= targetPrice;

/**
 * Call this on a timer (e.g. every 15-30s while the app is foregrounded
 * — matching this app's existing poll cadence for Tron in
 * realtime/tronRealtime.js) or on screen focus. Checks every 'watching'
 * order's live price and fires a real swap for any that qualify.
 *
 * Requires the wallet's mnemonic to actually execute a fire — pass it
 * in fresh from secureSeed rather than caching it in memory here.
 */
export async function checkWatchOrders({ mnemonic, passphrase = "", index = 0, change = 0 }) {
  const orders = await getWatchingOrders();
  const fired = [];

  for (const order of orders) {
    try {
      const quote = await quoteTronSwap({
        fromSymbol: order.from_symbol,
        toSymbol: order.to_symbol,
        humanAmount: order.human_amount_in,
      });
      if (quote.impliedPrice == null) continue;

      if (conditionMet(order.direction, quote.impliedPrice, order.target_price)) {
        try {
          const result = await executeTronSwap({
            fromSymbol: order.from_symbol,
            toSymbol: order.to_symbol,
            humanAmount: order.human_amount_in,
            mnemonic,
            passphrase,
            index,
            change,
            slippagePercent: order.slippage_percent,
          });
          await markWatchOrderFilled(order.id, result.txHash);
          fired.push({ order, result });
        } catch (fireError) {
          // Price condition was met but the actual swap failed (e.g.
          // insufficient balance, price moved past slippage tolerance
          // by execution time). Mark failed rather than leaving it
          // silently 'watching' forever and retrying every poll.
          await markWatchOrderFailed(order.id);
        }
      }
    } catch {
      // Quote fetch failed (network blip) — leave this order
      // 'watching' and just try again next poll cycle.
    }
  }

  return fired;
}
