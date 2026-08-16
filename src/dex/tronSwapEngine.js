import { getTronWeb, getTrxBalance, getTrc20Balance } from "../network/tronClient";
import { deriveTronKeyPair } from "../wallet/tronWallet";
import { toBaseUnits, fromBaseUnits } from "../wallet/units";
import { getTronToken, SUNSWAP_V2_ROUTER } from "./tronTokens";
import { recordSwapPending, markSwapConfirmed, markSwapFailed } from "../db/dexRepo";

// Max TRX the swap tx is allowed to burn in fees before TronWeb aborts
// it client-side — Tron fees are bandwidth+energy, not a gas auction
// like EVM, but a feeLimit is still required as a safety cap.
const FEE_LIMIT_SUN = 150_000_000; // 150 TRX ceiling
const DEADLINE_WINDOW_SECONDS = 20 * 60;

function buildPath(fromToken, toToken) {
  return [fromToken.pathAddress, toToken.pathAddress];
}

/**
 * Read-only quote — no private key needed, safe to call on every
 * keystroke (though the UI debounces it anyway). Queries the router's
 * getAmountsOut directly on-chain, which reflects the CURRENT pool
 * ratio — by the time a real swap executes this may have moved, which
 * is exactly what slippage tolerance protects against.
 */
export async function quoteTronSwap({ fromSymbol, toSymbol, humanAmount }) {
  const fromToken = getTronToken(fromSymbol);
  const toToken = getTronToken(toSymbol);
  const amountIn = toBaseUnits(humanAmount, fromToken.decimals);

  const tronWeb = getTronWeb(); // no private key — read-only instance
  const router = await tronWeb.contract().at(SUNSWAP_V2_ROUTER);
  const path = buildPath(fromToken, toToken);

  const amounts = await router.getAmountsOut(amountIn.toString(), path).call();
  const amountOut = BigInt(amounts[amounts.length - 1].toString());

  return {
    amountOutBaseUnits: amountOut,
    amountOutHuman: fromBaseUnits(amountOut, toToken.decimals),
    impliedPrice: humanAmount > 0 ? Number(fromBaseUnits(amountOut, toToken.decimals)) / Number(humanAmount) : null,
  };
}

async function waitForTronConfirmation(tronWeb, txid, { timeoutMs = 60_000, pollMs = 3_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await tronWeb.trx.getTransactionInfo(txid);
    if (info && info.id) {
      // receipt.result is absent (success) or 'FAILED' (reverted) on Tron
      const failed = info.receipt?.result && info.receipt.result !== "SUCCESS";
      return { confirmed: true, failed: !!failed, info };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { confirmed: false, failed: false, info: null };
}

/**
 * Full swap: balance check -> approve (if the source is a TRC20, not
 * native TRX) -> call the appropriate swapExactX-for-Y router function
 * -> poll for confirmation. Approval, like the EVM engine, is an EXACT
 * amount, never unlimited.
 */
export async function executeTronSwap({ fromSymbol, toSymbol, humanAmount, mnemonic, index = 0, change = 0, passphrase = "", slippagePercent = 1 }) {
  const fromToken = getTronToken(fromSymbol);
  const toToken = getTronToken(toSymbol);
  const amountIn = toBaseUnits(humanAmount, fromToken.decimals);

  const { privateKeyHex } = deriveTronKeyPair(mnemonic, index, change, passphrase);
  const tronWeb = getTronWeb(privateKeyHex);
  const myAddress = tronWeb.defaultAddress.base58;

  // Every Tron tx (including TRC20 approve/swap calls) burns TRX for
  // bandwidth/energy unless the account has staked resources — same
  // rule sendTrc20Transfer enforces in tronClient.js.
  const trxBalance = await getTrxBalance(myAddress);
  if (trxBalance === 0n) {
    throw new Error("This Tron address has 0 TRX. Swaps burn TRX for bandwidth/energy — send a small amount of TRX here first.");
  }

  // Balance check for the asset actually being swapped away.
  if (fromToken.isNative) {
    if (trxBalance < amountIn) {
      throw new Error(`Insufficient TRX. Have ${fromBaseUnits(trxBalance, 6)}, need ${humanAmount}.`);
    }
  } else {
    const bal = await getTrc20Balance(myAddress, fromToken.address);
    if (bal < amountIn) {
      throw new Error(`Insufficient ${fromToken.symbol}. Have ${fromBaseUnits(bal, fromToken.decimals)}, need ${humanAmount}.`);
    }
  }

  const path = buildPath(fromToken, toToken);
  const router = await tronWeb.contract().at(SUNSWAP_V2_ROUTER);

  // Quote fresh, right before building the tx, then apply slippage.
  const amountsOut = await router.getAmountsOut(amountIn.toString(), path).call();
  const quotedOut = BigInt(amountsOut[amountsOut.length - 1].toString());
  const slippageBps = BigInt(Math.round(slippagePercent * 100)); // percent -> basis points
  const amountOutMin = (quotedOut * (10_000n - slippageBps)) / 10_000n;
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_WINDOW_SECONDS;

  // Approval — only for TRC20 sources, never for native TRX.
  if (!fromToken.isNative) {
    const tokenContract = await tronWeb.contract().at(fromToken.address);
    const allowance = BigInt((await tokenContract.allowance(myAddress, SUNSWAP_V2_ROUTER).call()).toString());
    if (allowance < amountIn) {
      const approveTx = await tokenContract.approve(SUNSWAP_V2_ROUTER, amountIn.toString()).send({ feeLimit: FEE_LIMIT_SUN, shouldPollResponse: false });
      const approveResult = await waitForTronConfirmation(tronWeb, approveTx);
      if (!approveResult.confirmed || approveResult.failed) {
        throw new Error("Token approval failed or timed out — swap not attempted.");
      }
    }
  }

  let txid;
  if (fromToken.isNative) {
    // TRX -> Token: amount sent as callValue, not as a function arg.
    txid = await router
      .swapExactTRXForTokens(amountOutMin.toString(), path, myAddress, deadline)
      .send({ feeLimit: FEE_LIMIT_SUN, callValue: amountIn.toString(), shouldPollResponse: false });
  } else if (toToken.isNative) {
    // Token -> TRX
    txid = await router
      .swapExactTokensForTRX(amountIn.toString(), amountOutMin.toString(), path, myAddress, deadline)
      .send({ feeLimit: FEE_LIMIT_SUN, shouldPollResponse: false });
  } else {
    // Token -> Token
    txid = await router
      .swapExactTokensForTokens(amountIn.toString(), amountOutMin.toString(), path, myAddress, deadline)
      .send({ feeLimit: FEE_LIMIT_SUN, shouldPollResponse: false });
  }

  await recordSwapPending({
    chain: "tron",
    srcSymbol: fromSymbol,
    dstSymbol: toSymbol,
    srcAmountBaseUnits: amountIn,
    dstAmountEstimateBaseUnits: quotedOut,
    slippagePercent,
    txHash: txid,
  });

  const result = await waitForTronConfirmation(tronWeb, txid);
  if (!result.confirmed) {
    // Not necessarily failed — Tron can be slow under load. Left as
    // 'pending' in the DB; the user can check the explorer link.
    return { txHash: txid, status: "pending", explorerUrl: `https://tronscan.org/#/transaction/${txid}` };
  }
  if (result.failed) {
    await markSwapFailed(txid);
    throw new Error(`Swap reverted on-chain: ${txid}`);
  }

  await markSwapConfirmed(txid, { dstAmountActualBaseUnits: quotedOut });
  return { txHash: txid, status: "confirmed", explorerUrl: `https://tronscan.org/#/transaction/${txid}` };
}
