import { ethers } from "ethers";
import { deriveEvmWallet } from "../wallet/evmWallet";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// Public RPC endpoints. These are shared/rate-limited — fine for a
// personal wallet, but swap in your own Infura/Alchemy/QuickNode/Ankr
// endpoint in settings if you hit rate limits or want reliability.
const CHAIN_CONFIG = {
  ethereum: {
    rpcUrls: ["https://eth.llamarpc.com", "https://rpc.ankr.com/eth", "https://ethereum.publicnode.com"],
    chainId: 1,
    explorerTxUrl: (txid) => `https://etherscan.io/tx/${txid}`,
  },
  bsc: {
    rpcUrls: ["https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io", "https://bsc.publicnode.com"],
    chainId: 56,
    explorerTxUrl: (txid) => `https://bscscan.com/tx/${txid}`,
  },
};

export function getProvider(chain) {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) throw new Error(`Unknown EVM chain: ${chain}`);
  return new ethers.JsonRpcProvider(cfg.rpcUrls[0], cfg.chainId);
}

/** Returns the raw base-unit balance (BigInt) — caller formats using the asset's decimals. */
export async function getErc20Balance(chain, walletAddress, contractAddress) {
  const provider = getProvider(chain);
  const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
  return contract.balanceOf(walletAddress);
}

/** Native coin balance (ETH or BNB) — needed because gas is paid in the native coin, not USDT. */
export async function getNativeBalance(chain, walletAddress) {
  const provider = getProvider(chain);
  return provider.getBalance(walletAddress);
}

/**
 * Sign and broadcast an ERC20/BEP20 transfer. amountBaseUnits must already
 * be in the token's smallest unit (e.g. 6 decimals for USDT on ETH/Tron,
 * 18 on BSC — see assets.js) — pass a BigInt or numeric string, never a
 * float, to avoid precision loss.
 *
 * Throws if the wallet's native-coin balance can't cover estimated gas —
 * gas is always paid in ETH/BNB even when moving USDT.
 */
export async function sendErc20Transfer({ chain, mnemonic, index, change = 0, passphrase = "", contractAddress, toAddress, amountBaseUnits }) {
  if (!ethers.isAddress(toAddress)) throw new Error("Invalid recipient address for this chain.");

  const provider = getProvider(chain);
  const signer = deriveEvmWallet(mnemonic, index, change, passphrase).connect(provider);
  const contract = new ethers.Contract(contractAddress, ERC20_ABI, signer);

  const nativeBalance = await provider.getBalance(signer.address);
  let gasEstimate;
  try {
    gasEstimate = await contract.transfer.estimateGas(toAddress, amountBaseUnits);
  } catch (e) {
    throw new Error(`Transfer would fail on-chain (bad address, zero balance, or paused contract): ${e.reason || e.message}`);
  }
  const feeData = await provider.getFeeData();
  const estCostWei = gasEstimate * (feeData.maxFeePerGas ?? feeData.gasPrice);
  if (nativeBalance < estCostWei) {
    const coin = chain === "bsc" ? "BNB" : "ETH";
    throw new Error(`Not enough ${coin} for gas. Need ~${ethers.formatEther(estCostWei)} ${coin}, have ${ethers.formatEther(nativeBalance)}.`);
  }

  const tx = await contract.transfer(toAddress, amountBaseUnits);
  const receipt = await tx.wait(1); // wait for 1 confirmation before returning
  return { txid: tx.hash, confirmed: receipt.status === 1, explorerUrl: CHAIN_CONFIG[chain].explorerTxUrl(tx.hash) };
}

export function explorerTxUrl(chain, txid) {
  return CHAIN_CONFIG[chain].explorerTxUrl(txid);
}
