import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_CURRENCY,
  getDisplayCurrency,
  setDisplayCurrency,
} from "../wallet/currencyPref";

/**
 * Loads the persisted display currency (defaulting to USD, never silently
 * falling back to whatever currency happened to be on screen last) and
 * exposes a setter that both updates local state and writes through to
 * the settings table, so every screen using this hook stays in sync after
 * a change instead of reverting to NGN/EUR/etc. on next navigation.
 */
export function useDisplayCurrency() {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    getDisplayCurrency()
      .then((c) => {
        if (mounted) setCurrencyState(c);
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const changeCurrency = useCallback(async (next) => {
    setCurrencyState(next); // optimistic — dropdown feels instant
    try {
      await setDisplayCurrency(next);
    } catch (e) {
      // Persist failed — revert to whatever's actually stored so the UI
      // doesn't claim a currency that didn't save.
      const stored = await getDisplayCurrency();
      setCurrencyState(stored);
    }
  }, []);

  return { currency, setCurrency: changeCurrency, loaded };
}
