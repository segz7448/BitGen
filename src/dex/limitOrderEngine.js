import { ethers } from "ethers";
import { getProvider } from "../network/evmClient";
import { deriveEvmWallet } from "../wallet/evmWallet";
import { toBaseUnits, fromBaseUnits } from "../wallet/units";
import { getToken, getChainId, NATIVE_PSEUDO_ADDRESS } from "./tokens";
import { getAllowance, getApproveTx, submitLimitOrder, getLimitOrderByHash } from "./oneInchClient";
import { recordLimitOrder, updateLimitOrderStatus, markLimitOrderCancelled, getOpenLimitOrders } from "../db/dexRepo";

/**
 * VERIFY_BEFORE_USE: the Limit Order Protocol v4 contract address below
 * is unset on purpose. 1inch has historically deployed LOP at the same
 * address across many EVM chains via deterministic (CREATE2) deployment,
 * but that must be confirmed per-chain against 1inch's own docs/GitHub
 * (https://github.com/1inch/limit-order-protocol) before this module is
 * used with real funds — signing an EIP-712 order against the wrong
 * verifyingContract produces a signature that's either rejected or,
 * worse, valid against a contract you didn't intend.
 *
 * Fill these in only after you've verified them yourself:
 *   ethereum: "0x...",
 *   bsc: "0x...",
 */
const LOP_CONTRACT_ADDRESS = {
  ethereum: null,
  bsc: null,
};

/**
 * VERIFY_BEFORE_USE: cancel ABI. LOP v4's cancellation function signature
 * has changed across versions (single order vs makerTraits-based bulk
 * cancel). Confirm the exact ABI against the deployed, verified contract
 * on Etherscan/BscScan for the address above before relying on this.
 */
const CANCEL_ABI = ["function cancelOrder(uint256 makerTraits, bytes32 orderHash)"];

const ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "receiver", type: "address" },
    { name: "makerAsset", type: "address" },
    { name: "takerAsset", type: "address" },
    { name: "makingAmount", type: "uint256" },
    { name: "takingAmount", type: "uint256" },
    { name: "makerTraits", type: "uint256" },
  ],
};

function requireLopAddress(chain) {
  const addr = LOP_CONTRACT_ADDRESS[chain];
  if (!addr) {
    throw new Error(
      `Limit Order Protocol contract address for ${chain} hasn't been verified/set yet. ` +
        `Open src/dex/limitOrderEngine.js, confirm the real address against 1inch's docs, and fill it in before creating limit orders.`
    );
  }
  return addr;
}

function randomSalt() {
  // 1inch orders need a unique salt to avoid hash collisions between
  // otherwise-identical orders. Random 128-bit value is plenty.
  const bytes = ethers.randomBytes(16);
  return BigInt(ethers.hexlify(bytes));
}

/**
 * Creates, signs, and submits a limit order: give `makerSymbol` at
 * `humanMakingAmount`, receive `takerSymbol`, willing to wait until
 * filled at that implied price or expiry (whichever comes first).
 *
 * This is 100% off-chain until filled — no gas paid to create it, only
 * an EIP-712 signature. Gas is paid by whoever fills it (or by you, if
 * you later cancel it on-chain).
 */
export async function createLimitOrder({
  chain,
  makerSymbol,
  takerSymbol,
  humanMakingAmount,
  humanTakingAmount,
  mnemonic,
  index = 0,
  change = 0,
  passphrase = "",
  expiresInSeconds,
}) {
  const verifyingContract = requireLopAddress(chain);
  const maker = getToken(chain, makerSymbol);
  const taker = getToken(chain, takerSymbol);
  const chainId = getChainId(chain);
  const provider = getProvider(chain);
  const signer = deriveEvmWallet(mnemonic, index, change, passphrase).connect(provider);

  if (maker.isNative || maker.address === NATIVE_PSEUDO_ADDRESS) {
    throw new Error("Native ETH/BNB can't be the maker asset in a limit order — wrap it first (WETH/WBNB) since LOP only handles ERC20s.");
  }

  const makingAmount = toBaseUnits(humanMakingAmount, maker.decimals);
  const takingAmount = toBaseUnits(humanTakingAmount, taker.decimals);

  // Limit orders need the SAME exact-amount approval treatment as swaps
  // — the LOP contract pulls funds from you only once a resolver fills
  // the order, but it still needs allowance set up front.
  const currentAllowance = await getAllowance({ chainId, tokenAddress: maker.address, walletAddress: signer.address });
  if (currentAllowance < makingAmount) {
    const approveTx = await getApproveTx({ chainId, tokenAddress: maker.address, amountBaseUnits: makingAmount });
    const sentApprove = await signer.sendTransaction({
      to: approveTx.to,
      data: approveTx.data,
      value: approveTx.value ? BigInt(approveTx.value) : 0n,
    });
    const approveReceipt = await sentApprove.wait(1);
    if (approveReceipt.status !== 1) throw new Error("Token approval failed — limit order not created.");
  }

  const order = {
    salt: randomSalt(),
    maker: signer.address,
    receiver: ethers.ZeroAddress, // ZeroAddress = pay out to `maker`
    makerAsset: maker.address,
    takerAsset: taker.address,
    makingAmount,
    takingAmount,
    makerTraits: 0n, // VERIFY_BEFORE_USE: encodes expiry/partial-fill flags in real v4 orders — 0 means defaults, confirm what "default" means before relying on an expiry
  };

  const domain = {
    name: "1inch Limit Order Protocol",
    version: "4",
    chainId,
    verifyingContract,
  };

  const signature = await signer.signTypedData(domain, ORDER_TYPES, order);
  const orderHash = ethers.TypedDataEncoder.hash(domain, ORDER_TYPES, order);

  const orderPayload = {
    orderHash,
    signature,
    data: {
      ...order,
      salt: order.salt.toString(),
      makingAmount: order.makingAmount.toString(),
      takingAmount: order.takingAmount.toString(),
      makerTraits: order.makerTraits.toString(),
    },
  };

  await submitLimitOrder({ chainId, orderPayload });

  const limitPrice = Number(fromBaseUnits(takingAmount, taker.decimals)) / Number(fromBaseUnits(makingAmount, maker.decimals));
  const expiryAt = expiresInSeconds ? Math.floor(Date.now() / 1000) + expiresInSeconds : null;

  await recordLimitOrder({
    chain,
    orderHash,
    makerSymbol,
    takerSymbol,
    makingAmountBaseUnits: makingAmount,
    takingAmountBaseUnits: takingAmount,
    limitPrice,
    expiryAt,
    rawOrder: orderPayload,
  });

  return { orderHash, limitPrice };
}

/**
 * Cancels an open order on-chain. Costs real gas (this is the one part
 * of the limit-order flow that isn't free) — the order is only truly
 * dead once this tx confirms; until then a resolver could still fill it.
 */
export async function cancelLimitOrder({ chain, orderHash, mnemonic, index = 0, change = 0, passphrase = "" }) {
  const verifyingContract = requireLopAddress(chain);
  const provider = getProvider(chain);
  const signer = deriveEvmWallet(mnemonic, index, change, passphrase).connect(provider);
  const contract = new ethers.Contract(verifyingContract, CANCEL_ABI, signer);

  const tx = await contract.cancelOrder(0n, orderHash); // VERIFY_BEFORE_USE: makerTraits arg — see CANCEL_ABI note above
  const receipt = await tx.wait(1);
  if (receipt.status !== 1) throw new Error("Cancel transaction reverted on-chain.");

  await markLimitOrderCancelled(orderHash, tx.hash);
  return { txHash: tx.hash };
}

/**
 * Polls 1inch's orderbook for status changes on every locally-tracked
 * open order. Call this on a timer or on screen focus — fills happen
 * off-app (a resolver bot fills it whenever it wants), so there's no
 * push notification for it without your own indexer.
 */
export async function refreshOpenOrderStatuses(chain) {
  const chainId = getChainId(chain);
  const open = await getOpenLimitOrders();
  for (const row of open.filter((o) => o.chain === chain)) {
    try {
      const remote = await getLimitOrderByHash({ chainId, orderHash: row.order_hash });
      // VERIFY_BEFORE_USE: exact status field name/values from the
      // orderbook API — adjust this mapping once confirmed live.
      if (remote?.status && remote.status !== "open") {
        await updateLimitOrderStatus(row.order_hash, remote.status);
      }
    } catch {
      // Order not found remotely can mean filled-and-pruned, cancelled,
      // or a transient API error — don't flip local status on a single
      // failed lookup, just skip and retry next poll.
    }
  }
}
