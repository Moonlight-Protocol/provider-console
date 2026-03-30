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

export function clearSession(): void {
  connectedAddress = null;
  localStorage.removeItem(STORAGE_KEY);
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
