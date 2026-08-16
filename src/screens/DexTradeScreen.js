import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colors, spacing } from "../theme";
import { loadMnemonic, loadPassphrase } from "../wallet/secureSeed";
import { isWatchOnly } from "../wallet/walletMode";
import { listTokens } from "../dex/tokens";
import { quoteSwap, executeSwap } from "../dex/swapEngine";
import { createLimitOrder, cancelLimitOrder, refreshOpenOrderStatuses } from "../dex/limitOrderEngine";
import { getAllLimitOrders, getSwapHistory } from "../db/dexRepo";
import { listTronTokens } from "../dex/tronTokens";
import { quoteTronSwap, executeTronSwap } from "../dex/tronSwapEngine";
import { checkWatchOrders } from "../dex/tronLimitWatcher";
import { createWatchOrder, getAllWatchOrders, cancelWatchOrder } from "../db/tronWatchRepo";

const CHAINS = [
  { key: "ethereum", label: "Ethereum" },
  { key: "bsc", label: "BSC" },
  { key: "tron", label: "Tron" },
];

export default function DexTradeScreen() {
  const [chain, setChain] = useState("ethereum");
  const [mode, setMode] = useState("swap"); // 'swap' | 'limit'
  const [watchOnly, setWatchOnly] = useState(false);

  useEffect(() => {
    isWatchOnly().then(setWatchOnly);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(3) }}>
      {watchOnly && (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>
            Watch-only wallet — no private key on this device. Swaps and limit orders need to sign transactions, so
            they won't work here.
          </Text>
        </View>
      )}

      <View style={styles.warnBanner}>
        <Text style={styles.warnText}>
          Real on-chain trading. Swaps cost real gas and are irreversible once broadcast. Double-check amounts before
          confirming.
        </Text>
      </View>

      <View style={styles.segmented}>
        {CHAINS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.segment, chain === c.key && styles.segmentActive]}
            onPress={() => setChain(c.key)}
          >
            <Text style={[styles.segmentText, chain === c.key && styles.segmentTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.segmented}>
        <TouchableOpacity style={[styles.segment, mode === "swap" && styles.segmentActive]} onPress={() => setMode("swap")}>
          <Text style={[styles.segmentText, mode === "swap" && styles.segmentTextActive]}>Swap</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segment, mode === "limit" && styles.segmentActive]} onPress={() => setMode("limit")}>
          <Text style={[styles.segmentText, mode === "limit" && styles.segmentTextActive]}>
            {chain === "tron" ? "Watch Order" : "Limit Order"}
          </Text>
        </TouchableOpacity>
      </View>

      {chain === "tron" ? (
        mode === "swap" ? (
          <TronSwapPanel disabled={watchOnly} />
        ) : (
          <TronWatchPanel disabled={watchOnly} />
        )
      ) : mode === "swap" ? (
        <SwapPanel chain={chain} disabled={watchOnly} />
      ) : (
        <LimitOrderPanel chain={chain} disabled={watchOnly} />
      )}
    </ScrollView>
  );
}

function SwapPanel({ chain, disabled }) {
  const tokens = listTokens(chain);
  const [srcSymbol, setSrcSymbol] = useState(tokens[0].symbol);
  const [dstSymbol, setDstSymbol] = useState(tokens[tokens.length - 1].symbol);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    setSrcSymbol(listTokens(chain)[0].symbol);
    setDstSymbol(listTokens(chain)[listTokens(chain).length - 1].symbol);
    setQuote(null);
  }, [chain]);

  useFocusEffect(
    useCallback(() => {
      getSwapHistory(20).then(setHistory).catch(() => {});
    }, [])
  );

  useEffect(() => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || srcSymbol === dstSymbol) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(() => {
      quoteSwap({ chain, srcSymbol, dstSymbol, humanAmount: amount })
        .then((q) => !cancelled && setQuote(q))
        .catch((e) => !cancelled && setQuote({ error: e.message }))
        .finally(() => !cancelled && setQuoting(false));
    }, 500); // debounce — quote is a real API call, no point firing on every keystroke
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [chain, srcSymbol, dstSymbol, amount]);

  const flip = () => {
    setSrcSymbol(dstSymbol);
    setDstSymbol(srcSymbol);
    setQuote(null);
  };

  const submit = async () => {
    if (!quote || quote.error) return;
    Alert.alert(
      "Confirm swap",
      `Swap ${amount} ${srcSymbol} for ~${quote.dstAmountHuman} ${dstSymbol} on ${chain}.\n\nSlippage tolerance: ${slippage}%\n\nThis broadcasts a real transaction and cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Swap",
          onPress: async () => {
            setSwapping(true);
            try {
              const mnemonic = await loadMnemonic();
              const passphrase = await loadPassphrase();
              const result = await executeSwap({
                chain,
                srcSymbol,
                dstSymbol,
                humanAmount: amount,
                mnemonic,
                passphrase,
                slippagePercent: parseFloat(slippage) || 1,
              });
              setAmount("");
              setQuote(null);
              getSwapHistory(20).then(setHistory).catch(() => {});
              Alert.alert("Swap confirmed", `Tx: ${result.txHash}\n\n${result.explorerUrl}`);
            } catch (e) {
              Alert.alert("Swap failed", e.message || "Something went wrong.");
            } finally {
              setSwapping(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View>
      <TokenRow label="From" tokens={tokens} selected={srcSymbol} onSelect={setSrcSymbol} amount={amount} onAmount={setAmount} editable />
      <TouchableOpacity style={styles.flipBtn} onPress={flip}>
        <Text style={styles.flipText}>⇅ Flip</Text>
      </TouchableOpacity>
      <TokenRow
        label="To (estimated)"
        tokens={tokens}
        selected={dstSymbol}
        onSelect={setDstSymbol}
        amount={quote && !quote.error ? quote.dstAmountHuman : ""}
        editable={false}
      />

      <Text style={styles.inputLabel}>Slippage tolerance (%)</Text>
      <TextInput style={styles.smallInput} keyboardType="decimal-pad" value={slippage} onChangeText={setSlippage} />

      {quoting && <ActivityIndicator color={colors.orange} style={{ marginTop: spacing(2) }} />}
      {quote?.error && <Text style={styles.errorText}>{quote.error}</Text>}

      <TouchableOpacity
        style={[styles.submitBtn, (disabled || swapping || !quote || quote.error) && styles.submitDisabled]}
        onPress={submit}
        disabled={disabled || swapping || !quote || quote.error}
      >
        {swapping ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.submitText}>Swap</Text>}
      </TouchableOpacity>

      {history.length > 0 && (
        <View style={{ marginTop: spacing(3) }}>
          <Text style={styles.sectionTitle}>Recent swaps</Text>
          {history.map((h) => (
            <View key={h.id} style={styles.historyRow}>
              <Text style={styles.historyText}>
                {h.src_symbol} → {h.dst_symbol} · {h.status}
              </Text>
              <Text style={styles.historySub}>{h.tx_hash?.slice(0, 12)}…</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function LimitOrderPanel({ chain, disabled }) {
  const tokens = listTokens(chain).filter((t) => !t.isNative); // native can't be maker asset — see limitOrderEngine.js
  const [makerSymbol, setMakerSymbol] = useState(tokens[0]?.symbol);
  const [takerSymbol, setTakerSymbol] = useState(listTokens(chain)[listTokens(chain).length - 1].symbol);
  const [makingAmount, setMakingAmount] = useState("");
  const [takingAmount, setTakingAmount] = useState("");
  const [creating, setCreating] = useState(false);
  const [orders, setOrders] = useState([]);

  const loadOrders = useCallback(() => {
    getAllLimitOrders(50).then((all) => setOrders(all.filter((o) => o.chain === chain))).catch(() => {});
  }, [chain]);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
      refreshOpenOrderStatuses(chain).then(loadOrders).catch(() => {});
    }, [chain, loadOrders])
  );

  const create = async () => {
    if (!makingAmount || !takingAmount) {
      Alert.alert("Missing amounts", "Enter both the amount you're giving and the amount you want to receive.");
      return;
    }
    Alert.alert(
      "Confirm limit order",
      `Give ${makingAmount} ${makerSymbol}, receive ${takingAmount} ${takerSymbol} once filled.\n\nThis is a real on-chain order — a token approval transaction (real gas) may be needed first.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: async () => {
            setCreating(true);
            try {
              const mnemonic = await loadMnemonic();
              const passphrase = await loadPassphrase();
              await createLimitOrder({
                chain,
                makerSymbol,
                takerSymbol,
                humanMakingAmount: makingAmount,
                humanTakingAmount: takingAmount,
                mnemonic,
                passphrase,
              });
              setMakingAmount("");
              setTakingAmount("");
              loadOrders();
              Alert.alert("Order created", "Your limit order is now resting on-chain and will fill when a resolver matches your price.");
            } catch (e) {
              Alert.alert("Order failed", e.message || "Something went wrong.");
            } finally {
              setCreating(false);
            }
          },
        },
      ]
    );
  };

  const cancel = async (orderHash) => {
    Alert.alert("Cancel order", "This sends a real on-chain transaction (costs gas) to cancel. Continue?", [
      { text: "Back", style: "cancel" },
      {
        text: "Cancel order",
        style: "destructive",
        onPress: async () => {
          try {
            const mnemonic = await loadMnemonic();
            const passphrase = await loadPassphrase();
            await cancelLimitOrder({ chain, orderHash, mnemonic, passphrase });
            loadOrders();
          } catch (e) {
            Alert.alert("Cancel failed", e.message || "Something went wrong.");
          }
        },
      },
    ]);
  };

  return (
    <View>
      <TokenRow label="Give (maker)" tokens={tokens} selected={makerSymbol} onSelect={setMakerSymbol} amount={makingAmount} onAmount={setMakingAmount} editable />
      <TokenRow
        label="Receive (taker)"
        tokens={listTokens(chain)}
        selected={takerSymbol}
        onSelect={setTakerSymbol}
        amount={takingAmount}
        onAmount={setTakingAmount}
        editable
      />

      <TouchableOpacity style={[styles.submitBtn, (disabled || creating) && styles.submitDisabled]} onPress={create} disabled={disabled || creating}>
        {creating ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.submitText}>Create Limit Order</Text>}
      </TouchableOpacity>

      <View style={{ marginTop: spacing(3) }}>
        <Text style={styles.sectionTitle}>Your orders on {chain}</Text>
        {orders.length === 0 && <Text style={styles.historySub}>No orders yet.</Text>}
        {orders.map((o) => (
          <View key={o.order_hash} style={styles.historyRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.historyText}>
                {o.maker_symbol} → {o.taker_symbol} · {o.status}
              </Text>
              <Text style={styles.historySub}>@ {o.limit_price.toFixed(6)}</Text>
            </View>
            {o.status === "open" && (
              <TouchableOpacity onPress={() => cancel(o.order_hash)}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function TronSwapPanel({ disabled }) {
  const tokens = listTronTokens();
  const [fromSymbol, setFromSymbol] = useState(tokens[0].symbol);
  const [toSymbol, setToSymbol] = useState(tokens[tokens.length - 1].symbol);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [history, setHistory] = useState([]);

  useFocusEffect(
    useCallback(() => {
      getSwapHistory(20).then((all) => setHistory(all.filter((h) => h.chain === "tron"))).catch(() => {});
    }, [])
  );

  useEffect(() => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || fromSymbol === toSymbol) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(() => {
      quoteTronSwap({ fromSymbol, toSymbol, humanAmount: amount })
        .then((q) => !cancelled && setQuote(q))
        .catch((e) => !cancelled && setQuote({ error: e.message }))
        .finally(() => !cancelled && setQuoting(false));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fromSymbol, toSymbol, amount]);

  const flip = () => {
    setFromSymbol(toSymbol);
    setToSymbol(fromSymbol);
    setQuote(null);
  };

  const submit = async () => {
    if (!quote || quote.error) return;
    Alert.alert(
      "Confirm swap",
      `Swap ${amount} ${fromSymbol} for ~${quote.amountOutHuman} ${toSymbol} via SunSwap.\n\nSlippage tolerance: ${slippage}%\n\nThis broadcasts a real transaction and cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Swap",
          onPress: async () => {
            setSwapping(true);
            try {
              const mnemonic = await loadMnemonic();
              const passphrase = await loadPassphrase();
              const result = await executeTronSwap({
                fromSymbol,
                toSymbol,
                humanAmount: amount,
                mnemonic,
                passphrase,
                slippagePercent: parseFloat(slippage) || 1,
              });
              setAmount("");
              setQuote(null);
              getSwapHistory(20).then((all) => setHistory(all.filter((h) => h.chain === "tron"))).catch(() => {});
              Alert.alert(result.status === "confirmed" ? "Swap confirmed" : "Swap broadcast", `Tx: ${result.txHash}\n\n${result.explorerUrl}`);
            } catch (e) {
              Alert.alert("Swap failed", e.message || "Something went wrong.");
            } finally {
              setSwapping(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View>
      <TokenRow label="From" tokens={tokens} selected={fromSymbol} onSelect={setFromSymbol} amount={amount} onAmount={setAmount} editable />
      <TouchableOpacity style={styles.flipBtn} onPress={flip}>
        <Text style={styles.flipText}>⇅ Flip</Text>
      </TouchableOpacity>
      <TokenRow
        label="To (estimated)"
        tokens={tokens}
        selected={toSymbol}
        onSelect={setToSymbol}
        amount={quote && !quote.error ? quote.amountOutHuman : ""}
        editable={false}
      />

      <Text style={styles.inputLabel}>Slippage tolerance (%)</Text>
      <TextInput style={styles.smallInput} keyboardType="decimal-pad" value={slippage} onChangeText={setSlippage} />

      {quoting && <ActivityIndicator color={colors.orange} style={{ marginTop: spacing(2) }} />}
      {quote?.error && <Text style={styles.errorText}>{quote.error}</Text>}

      <TouchableOpacity
        style={[styles.submitBtn, (disabled || swapping || !quote || quote.error) && styles.submitDisabled]}
        onPress={submit}
        disabled={disabled || swapping || !quote || quote.error}
      >
        {swapping ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.submitText}>Swap</Text>}
      </TouchableOpacity>

      {history.length > 0 && (
        <View style={{ marginTop: spacing(3) }}>
          <Text style={styles.sectionTitle}>Recent Tron swaps</Text>
          {history.map((h) => (
            <View key={h.id} style={styles.historyRow}>
              <Text style={styles.historyText}>
                {h.src_symbol} → {h.dst_symbol} · {h.status}
              </Text>
              <Text style={styles.historySub}>{h.tx_hash?.slice(0, 12)}…</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function TronWatchPanel({ disabled }) {
  const tokens = listTronTokens();
  const [fromSymbol, setFromSymbol] = useState(tokens[0].symbol);
  const [toSymbol, setToSymbol] = useState(tokens[tokens.length - 1].symbol);
  const [amount, setAmount] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState("above");
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [orders, setOrders] = useState([]);

  const loadOrders = useCallback(() => {
    getAllWatchOrders(50).then(setOrders).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  const create = async () => {
    if (!amount || !targetPrice) {
      Alert.alert("Missing fields", "Enter an amount and a target price.");
      return;
    }
    setCreating(true);
    try {
      await createWatchOrder({
        fromSymbol,
        toSymbol,
        humanAmountIn: amount,
        targetPrice: parseFloat(targetPrice),
        direction,
      });
      setAmount("");
      setTargetPrice("");
      loadOrders();
    } catch (e) {
      Alert.alert("Couldn't create watch order", e.message || "Something went wrong.");
    } finally {
      setCreating(false);
    }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const mnemonic = await loadMnemonic();
      const passphrase = await loadPassphrase();
      const fired = await checkWatchOrders({ mnemonic, passphrase });
      loadOrders();
      if (fired.length > 0) {
        Alert.alert("Order(s) fired", `${fired.length} watch order(s) executed a real swap.`);
      } else {
        Alert.alert("Checked", "No watch orders met their target price yet.");
      }
    } catch (e) {
      Alert.alert("Check failed", e.message || "Something went wrong.");
    } finally {
      setChecking(false);
    }
  };

  const cancel = async (id) => {
    await cancelWatchOrder(id);
    loadOrders();
  };

  return (
    <View>
      <View style={styles.warnBanner}>
        <Text style={styles.warnText}>
          Not a real on-chain order. Nothing is locked or placed on-chain until it fires. It only fires while this
          app is open and you (or a scheduled check) trigger it — it can miss a price move if the app isn't running.
        </Text>
      </View>

      <TokenRow label="Give (from)" tokens={tokens} selected={fromSymbol} onSelect={setFromSymbol} amount={amount} onAmount={setAmount} editable />
      <TokenRow label="Receive (to)" tokens={tokens} selected={toSymbol} onSelect={setToSymbol} amount="" editable={false} />

      <Text style={styles.inputLabel}>Fire when price ({toSymbol} per {fromSymbol}) is</Text>
      <View style={styles.segmented}>
        <TouchableOpacity style={[styles.segment, direction === "above" && styles.segmentActive]} onPress={() => setDirection("above")}>
          <Text style={[styles.segmentText, direction === "above" && styles.segmentTextActive]}>≥ target</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segment, direction === "below" && styles.segmentActive]} onPress={() => setDirection("below")}>
          <Text style={[styles.segmentText, direction === "below" && styles.segmentTextActive]}>≤ target</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.inputLabel}>Target price</Text>
      <TextInput style={styles.smallInput} keyboardType="decimal-pad" value={targetPrice} onChangeText={setTargetPrice} placeholder="0.0" placeholderTextColor={colors.subtext} />

      <TouchableOpacity style={[styles.submitBtn, (disabled || creating) && styles.submitDisabled]} onPress={create} disabled={disabled || creating}>
        {creating ? <ActivityIndicator color="#0B0B0F" /> : <Text style={styles.submitText}>Create Watch Order</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.checkBtn, (disabled || checking) && styles.submitDisabled]} onPress={checkNow} disabled={disabled || checking}>
        {checking ? <ActivityIndicator color={colors.orange} /> : <Text style={styles.checkBtnText}>Check now</Text>}
      </TouchableOpacity>

      <View style={{ marginTop: spacing(3) }}>
        <Text style={styles.sectionTitle}>Your watch orders</Text>
        {orders.length === 0 && <Text style={styles.historySub}>No watch orders yet.</Text>}
        {orders.map((o) => (
          <View key={o.id} style={styles.historyRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.historyText}>
                {o.human_amount_in} {o.from_symbol} → {o.to_symbol} · {o.status}
              </Text>
              <Text style={styles.historySub}>
                fire when {o.direction === "above" ? "≥" : "≤"} {o.target_price}
              </Text>
            </View>
            {o.status === "watching" && (
              <TouchableOpacity onPress={() => cancel(o.id)}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function TokenRow({ label, tokens, selected, onSelect, amount, onAmount, editable }) {
  return (
    <View style={{ marginBottom: spacing(2) }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="0.0"
          placeholderTextColor={colors.subtext}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={onAmount}
          editable={editable}
        />
        <View style={styles.tokenPicker}>
          {tokens.map((t) => (
            <TouchableOpacity key={t.symbol} style={[styles.tokenChip, selected === t.symbol && styles.tokenChipActive]} onPress={() => onSelect(t.symbol)}>
              <Text style={[styles.tokenChipText, selected === t.symbol && styles.tokenChipTextActive]}>{t.symbol}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  warnBanner: { backgroundColor: "#2A2210", borderRadius: 10, borderWidth: 1, borderColor: colors.orange, padding: spacing(1.5), marginBottom: spacing(2) },
  warnText: { color: colors.orange, fontSize: 12, lineHeight: 17 },
  segmented: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: spacing(2) },
  segment: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  segmentActive: { backgroundColor: colors.orange },
  segmentText: { color: colors.subtext, fontSize: 13, fontWeight: "700" },
  segmentTextActive: { color: "#0B0B0F" },
  inputLabel: { color: colors.subtext, fontSize: 12, marginBottom: spacing(0.75) },
  row: { gap: spacing(1) },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.75), color: colors.text, fontSize: 18 },
  smallInput: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing(1.25), color: colors.text, fontSize: 14, width: 100 },
  tokenPicker: { flexDirection: "row", gap: spacing(1) },
  tokenChip: { paddingHorizontal: spacing(1.5), paddingVertical: spacing(0.75), borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  tokenChipActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  tokenChipText: { color: colors.subtext, fontSize: 12, fontWeight: "600" },
  tokenChipTextActive: { color: "#0B0B0F" },
  flipBtn: { alignSelf: "center", marginVertical: spacing(0.5) },
  flipText: { color: colors.orange, fontSize: 13, fontWeight: "600" },
  errorText: { color: colors.red, fontSize: 12, marginTop: spacing(1) },
  submitBtn: { borderRadius: 14, paddingVertical: spacing(2), alignItems: "center", backgroundColor: colors.orange, marginTop: spacing(2) },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: "#0B0B0F", fontSize: 16, fontWeight: "700" },
  checkBtn: { borderRadius: 14, paddingVertical: spacing(1.5), alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.orange, marginTop: spacing(1) },
  checkBtnText: { color: colors.orange, fontSize: 14, fontWeight: "700" },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: spacing(1) },
  historyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing(1), borderBottomWidth: 1, borderBottomColor: colors.border },
  historyText: { color: colors.text, fontSize: 13 },
  historySub: { color: colors.subtext, fontSize: 11, marginTop: 2 },
  cancelLink: { color: colors.red, fontSize: 12, fontWeight: "600" },
});
