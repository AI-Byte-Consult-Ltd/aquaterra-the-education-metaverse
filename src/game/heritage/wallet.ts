/*
 * The resident's browser wallet (EIP-1193: MetaMask, Crypto.com DeFi Wallet, Rabby, Trust,
 * Coinbase Wallet, or the browser inside a mobile wallet app). Only two things are asked:
 * the address, and a free signature of a text message. Nothing is ever sent from the wallet here;
 * the resident sends the old NFT to the vault from their own wallet app.
 */
interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
const provider = (): Eip1193 | null => (typeof window !== "undefined" ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) : null);

export const hasWalletApp = () => provider() !== null;

export type WalletResult<T> = { ok: true; value: T; error?: undefined } | { ok: false; value?: undefined; error: "no_wallet_app" | "rejected" };

export async function connectWallet(): Promise<WalletResult<string>> {
  const p = provider();
  if (!p) return { ok: false, error: "no_wallet_app" };
  try {
    const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
    return accounts?.[0] ? { ok: true, value: accounts[0].toLowerCase() } : { ok: false, error: "rejected" };
  } catch {
    return { ok: false, error: "rejected" };
  }
}

const toHex = (s: string) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

export async function signText(address: string, message: string): Promise<WalletResult<string>> {
  const p = provider();
  if (!p) return { ok: false, error: "no_wallet_app" };
  try {
    const sig = (await p.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
    return /^0x[0-9a-fA-F]{130}$/.test(sig) ? { ok: true, value: sig } : { ok: false, error: "rejected" };
  } catch {
    return { ok: false, error: "rejected" };
  }
}

/** Deep link that opens this page inside the MetaMask app on a phone without a wallet browser. */
export const metamaskLink = () => `https://metamask.app.link/dapp/${location.host}${location.pathname}`;
