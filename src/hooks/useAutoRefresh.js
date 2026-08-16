import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Silent background polling for "no manual refresh needed" screens.
 *
 * Runs `callback` immediately, then every `intervalMs`, for as long as
 * `enabled` is true (wire this to screen focus so hidden screens don't
 * poll). Automatically pauses the interval while the app is backgrounded
 * and fires one immediate catch-up call the moment it returns to the
 * foreground, so data is never more than one interval stale without the
 * user ever having to pull-to-refresh.
 *
 * `callback` is called with a single `{ silent }` flag: false on the very
 * first call (mount / re-enable / foreground-return), true on every
 * regular tick after that — callers can use this to show a loading state
 * only on the first call and update quietly in the background afterward.
 */
export function useAutoRefresh(callback, intervalMs, enabled = true) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer = null;

    const run = (silent) => {
      if (cancelled) return;
      savedCallback.current({ silent });
    };

    const schedule = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => run(true), intervalMs);
    };

    run(false);
    schedule();

    const sub = AppState.addEventListener("change", (nextState) => {
      if (cancelled) return;
      if (nextState === "active") {
        run(false); // catch up immediately, not silently, on foreground
        schedule();
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs, enabled]);
}
