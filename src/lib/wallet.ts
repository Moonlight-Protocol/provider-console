/**
 * Wallet integration and auth state.
 * Copied from council-console — same pattern.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/stellar-wallets-kit.mjs";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit/types.mjs";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter.module.mjs";
import "@creit.tech/stellar-wallets-kit/components/modal/stellar-wallets-modal.mjs";
import { STELLAR_NETWORK } from "./config.ts";

const STORAGE_KEY = "provider_admin_address";

let kit: StellarWalletsKit | null = null;
let connectedAddress: string | null = null;

function getWalletNetwork(): WalletNetwork {
  switch (STELLAR_NETWORK) {
    case "mainnet": return WalletNetwork.PUBLIC;
    case "standalone": return WalletNetwork.STANDALONE;
    default: return WalletNetwork.TESTNET;
  }
}

function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: getWalletNetwork(),
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
  }
  return kit;
}

export function getConnectedAddress(): string | null {
  if (!connectedAddress) {
    connectedAddress = localStorage.getItem(STORAGE_KEY);
  }
  return connectedAddress;
}

export function isWalletConnected(): boolean {
  return !!getConnectedAddress();
}

// --- Master seed (sessionStorage — persists across refreshes, cleared on tab close) ---
const SEED_KEY = "master_seed";
let masterSeed: Uint8Array | null = null;

// Restore from sessionStorage on module load
{
  const stored = sessionStorage.getItem(SEED_KEY);
  if (stored) {
    try {
      masterSeed = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    } catch {
      // Corrupted base64 — clear and proceed without seed
      sessionStorage.removeItem(SEED_KEY);
      masterSeed = null;
    }
  }
}

/**
 * Derive the master seed from a single wallet signature.
 * Must be called once per session before any key derivation.
 */
export async function initMasterSeed(): Promise<void> {
  const signature = await signMessage("Moonlight: authorize master key");
  if (!signature || signature.length < 10) {
    throw new Error("Invalid signature: too short or empty");
  }
  const normalized = signature.replace(/-/g, "+").replace(/_/g, "/");
  const sigBytes = Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
  masterSeed = new Uint8Array(await crypto.subtle.digest("SHA-256", sigBytes));
  sessionStorage.setItem(SEED_KEY, btoa(String.fromCharCode(...masterSeed)));
}

export function getMasterSeed(): Uint8Array {
  if (!masterSeed) throw new Error("Master seed not initialized. Sign in first.");
  return masterSeed;
}

export function isMasterSeedReady(): boolean {
  return masterSeed !== null;
}

export function clearSession(): void {
  connectedAddress = null;
  masterSeed = null;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SEED_KEY);
}

export function getNetworkPassphrase(): string {
  switch (STELLAR_NETWORK) {
    case "mainnet": return "Public Global Stellar Network ; September 2015";
    case "standalone": return "Standalone Network ; February 2017";
    default: return "Test SDF Network ; September 2015";
  }
}

/**
 * Open wallet modal, connect, and store the address.
 * Returns the public key.
 */
export function connectWallet(): Promise<string> {
  const walletKit = getKit();

  return new Promise((resolve, reject) => {
    walletKit.openModal({
      onWalletSelected: async (option) => {
        walletKit.setWallet(option.id);
        try {
          const { address } = await walletKit.getAddress();
          connectedAddress = address;
          localStorage.setItem(STORAGE_KEY, address);
          resolve(address);
        } catch (err) {
          reject(err);
        }
      },
    }).catch(reject);
  });
}

/**
 * Sign an arbitrary message with the connected wallet (SEP-53).
 * Used for challenge-response authentication with the provider platform.
 */
interface WalletKitWithSignMessage {
  signMessage(
    message: string,
    opts: { address: string; networkPassphrase: string },
  ): Promise<SignMessageResult>;
}

interface SignMessageResult {
  signedMessage: string;
  signerAddress?: string;
  error?: string;
}

export async function signMessage(message: string): Promise<string> {
  // Double cast: StellarWalletsKit's type definitions don't include signMessage,
  // but the runtime implementation exposes it via the active module's SEP-43 method.
  const walletKit = getKit() as unknown as WalletKitWithSignMessage;
  const address = getConnectedAddress();
  if (!address) throw new Error("Wallet not connected");

  const result = await walletKit.signMessage(message, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });

  if (result.error) throw new Error(result.error);
  if (typeof result.signedMessage === "string") return result.signedMessage;

  throw new Error("Unexpected signMessage response");
}

/**
 * Derive a deterministic PP keypair from the master seed.
 * SHA-256(masterSeed + "pp" + index) → Ed25519 seed.
 * No wallet interaction — pure math.
 */
export async function derivePpKeypair(index: number): Promise<{ publicKey: string; secretKey: string }> {
  const seed = getMasterSeed();
  const encoder = new TextEncoder();
  const input = new Uint8Array([...seed, ...encoder.encode("pp"), ...encoder.encode(String(index))]);
  const derived = new Uint8Array(await crypto.subtle.digest("SHA-256", input));

  const { Keypair } = await import("stellar-base");
  const { Buffer } = await import("buffer");
  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(derived));
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Sign a transaction XDR with the connected wallet.
 */
export async function signTransaction(xdr: string): Promise<string> {
  const walletKit = getKit();
  const address = getConnectedAddress();
  if (!address) throw new Error("No wallet connected");

  const { signedTxXdr } = await walletKit.signTransaction(xdr, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });

  return signedTxXdr;
}
