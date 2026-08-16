import { useSyncExternalStore, useRef, useCallback } from "react";

/**
 * Minimal pub-sub store. Not a full state-management library — just enough
 * to let independent pieces of UI subscribe to a *slice* of shared state
 * and re-render only when that slice actually changes, instead of the
 * whole screen re-rendering (or re-fetching) whenever anything updates.
 *
 * Usage:
 *   const store = createStore({ a: 1, b: 2 });
 *   store.setState({ a: 2 });                    // shallow-merges into state
 *   store.setState((s) => ({ a: s.a + 1 }));      // functional update
 *   store.getState();                             // read current state
 *   store.subscribe(listener);                    // low-level, prefer useStoreSlice
 */
export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(patch) {
    const partial = typeof patch === "function" ? patch(state) : patch;
    const next = { ...state, ...partial };
    // Skip the notify pass entirely if nothing actually changed — avoids
    // waking up every subscriber for a no-op tick (e.g. a socket message
    // that didn't move the price).
    let changed = false;
    for (const key in next) {
      if (next[key] !== state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = next;
    listeners.forEach((l) => l(state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Subscribe a component to exactly the slice of a store it needs.
 *
 * `selector` picks the slice out of the full state (e.g. `s => s.ticker.usd`
 * or `s => s.connection`). The component only re-renders when the *selected*
 * value changes (by shallow equality for objects, Object.is for
 * primitives) — a WebSocket tick that updates unrelated state in the same
 * store never touches this component.
 *
 * Built on useSyncExternalStore, so it's safe with concurrent rendering
 * and tears correctly on store updates that happen outside React (e.g. a
 * WebSocket onmessage handler).
 */
export function useStoreSlice(store, selector, isEqual = shallowEqual) {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const cached = useRef({ has: false, value: undefined });

  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store.getState());
    if (!cached.current.has || !isEqualRef.current(cached.current.value, next)) {
      cached.current = { has: true, value: next };
    }
    return cached.current.value;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
