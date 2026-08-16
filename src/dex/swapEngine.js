import { ethers } from "ethers";
import { getProvider } from "../network/evmClient";
import { deriveEvmWallet } from "../wallet/evmWallet";
import { toBaseUnits, fromBaseUnits } from "../wallet/units";
import { getToken, getChainId } from "./tokens";
import { getSwapQuote, getSwapTx, getAllowance, getApproveTx } from "./oneInchClient";
import { recordSwapPending, markSwapConfirmed, markSwapFailed } from "../db/dexRepo";

const ERC20_APPROVE_ABI = ["function approve(address spender, uint256 amount) returns (bool)"];

/**
 * Quote-only — safe to call on every keystroke, no wallet/signing
 * involved. Returns human-readable amounts using each token's decimals.
 */
export async function quoteSwap({ chain, srcSymbol, dstSymbol, humanAmount }) {
  const src = getToken(chain, srcSymbol);
  const dst = getToken(chain, dstSymbol);
  const chainId = getChainId(chain);
  const amountBaseUnits = toBaseUnits(humanAmount, src.decimals);

  const quote = await getSwapQuote({ chainId, srcToken: src.address, dstToken: dst.address, amountBaseUnits });
  const dstAmountBaseUnits = BigInt(quote.dstAmount);
  return {
    dstAmountBaseUnits,
    dstAmountHuman: fromBaseUnits(dstAmountBaseUnits, dst.decimals),
    impliedPrice: humanAmount > 0 ? Number(fromBaseUnits(dstAmountBaseUnits, dst.decimals)) / Number(humanAmount) : null,
  };
}

/**
 * Full swap: approve (if needed) -> build swap tx -> sign -> broadcast ->
 * wait for confirmation. Every step that touches the chain is logged to
 * dex_swaps so a crash mid-flow still leaves a record with the tx hash
 * to check later, rather than silently losing track of a real tx.
 *
 * amountBaseUnits approval is EXACT, never unlimited (MaxUint256) — if
 * the 1inch router were ever compromised, an attacker can only move
 * what you approved for this one swap, not your entire balance.
 */
export async function executeSwap({ chain, srcSymbol, dstSymbol, humanAmount, mnemonic, index = 0, change = 0, passphrase = "", slippagePercent = 1 }) {
  const src = getToken(chain, srcSymbol);
  const dst = getToken(chain, dstSymbol);
  const chainId = getChainId(chain);
  const provider = getProvider(chain);
  const signer = deriveEvmWallet(mnemonic, index, change, passphrase).connect(provider);

  const amountBaseUnits = toBaseUnits(humanAmount, src.decimals);

  // 1. Balance check up front — fail fast with a clear message instead
  //    of a cryptic revert three steps later.
  if (src.isNative) {
    const bal = await provider.getBalance(signer.address);
    if (bal < amountBaseUnits) {
      throw new Error(`Insufficient ${src.symbol}. Have ${ethers.formatUnits(bal, src.decimals)}, need ${humanAmount}.`);
    }
  } else {
    const erc20 = new ethers.Contract(src.address, ["function balanceOf(address) view returns (uint256)"], provider);
    const bal = await erc20.balanceOf(signer.address);
    if (bal < amountBaseUnits) {
      throw new Error(`Insufficient ${src.symbol}. Have ${ethers.formatUnits(bal, src.decimals)}, need ${humanAmount}.`);
    }
  }

  // 2. Approval — only relevant for ERC20 sources, never for native ETH/BNB.
  if (!src.isNative) {
    const currentAllowance = await getAllowance({ chainId, tokenAddress: src.address, walletAddress: signer.address });
    if (currentAllowance < amountBaseUnits) {
      const approveTx = await getApproveTx({ chainId, tokenAddress: src.address, amountBaseUnits });
      const sentApprove = await signer.sendTransaction({
        to: approveTx.to,
        data: approveTx.data,
        value: approveTx.value ? BigInt(approveTx.value) : 0n,
      });
      const approveReceipt = await sentApprove.wait(1);
      if (approveReceipt.status !== 1) {
        throw new Error("Token approval transaction failed on-chain — swap not attempted.");
      }
    }
  }

  // 3. Quote + build the actual swap tx.
  const quote = await getSwapTx({
    chainId,
    srcToken: src.address,
    dstToken: dst.address,
    amountBaseUnits,
    fromAddress: signer.address,
    slippagePercent,
  });

  const txRequest = {
    to: quote.tx.to,
    data: quote.tx.data,
    value: BigInt(quote.tx.value || 0),
  };

  // 4. Sign + broadcast, recording as 'pending' BEFORE we await the
  //    receipt so a crash/app-kill mid-confirmation still leaves the
  //    tx hash in dex_swaps for the user to look up manually.
  const sent = await signer.sendTransaction(txRequest);
  await recordSwapPending({
    chain,
    srcSymbol,
    dstSymbol,
    srcAmountBaseUnits: amountBaseUnits,
    dstAmountEstimateBaseUnits: quote.dstAmount,
    slippagePercent,
    txHash: sent.hash,
  });

  try {
    const receipt = await sent.wait(1);
    if (receipt.status === 1) {
      await markSwapConfirmed(sent.hash, { dstAmountActualBaseUnits: quote.dstAmount });
      return { txHash: sent.hash, status: "confirmed", explorerUrl: explorerUrlFor(chain, sent.hash) };
    } else {
      await markSwapFailed(sent.hash);
      throw new Error(`Swap transaction reverted on-chain: ${sent.hash}`);
    }
  } catch (e) {
    await markSwapFailed(sent.hash);
    throw e;
  }
}

function explorerUrlFor(chain, txHash) {
  return chain === "bsc" ? `https://bscscan.com/tx/${txHash}` : `https://etherscan.io/tx/${txHash}`;
}
