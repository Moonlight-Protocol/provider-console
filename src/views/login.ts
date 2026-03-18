import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/stellar-wallets-kit.mjs";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit/types.mjs";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter.module.mjs";
import "@creit.tech/stellar-wallets-kit/components/modal/stellar-wallets-modal.mjs";
import { requestStellarChallenge, verifyStellarChallenge, setToken, isAuthenticated } from "../lib/api.ts";
import { identify, capture } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";
import { ENVIRONMENT } from "../lib/config.ts";

let kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: ENVIRONMENT === "production" ? WalletNetwork.TESTNET : WalletNetwork.STANDALONE,
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
  }
  return kit;
}

export function loginView(): HTMLElement {
  if (isAuthenticated()) {
    navigate("/channels");
    return document.createElement("div");
  }

  const container = document.createElement("div");
  container.className = "login-container";
  container.innerHTML = `
    <div class="login-card">
      <h1>Provider Console</h1>
      <p>Connect your Stellar wallet to manage your provider instance.</p>
      <button id="connect-btn" class="btn-primary btn-wide">Connect Wallet</button>
      <p id="login-status" class="hint-text" hidden></p>
      <p id="login-error" class="error-text" hidden></p>
      <p class="hint-text">Supports Freighter, LOBSTR, xBull, and other Stellar wallets via WalletConnect.</p>
    </div>
  `;

  const btn = container.querySelector("#connect-btn") as HTMLButtonElement;
  const statusEl = container.querySelector("#login-status") as HTMLParagraphElement;
  const errorEl = container.querySelector("#login-error") as HTMLParagraphElement;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    errorEl.hidden = true;

    try {
      const walletKit = getKit();

      statusEl.textContent = "Connecting wallet...";
      statusEl.hidden = false;
      await walletKit.openModal({
        onWalletSelected: async (option) => {
          walletKit.setWallet(option.id);

          try {
            const { address: publicKey } = await walletKit.getAddress();
            statusEl.textContent = `Connected: ${publicKey.slice(0, 8)}...${publicKey.slice(-4)}`;

            // 1. Request SEP-10 challenge transaction
            statusEl.textContent = "Requesting challenge...";
            const { challenge } = await requestStellarChallenge(publicKey);

            // 2. Sign the challenge transaction with wallet
            statusEl.textContent = "Please approve the transaction in your wallet...";
            const { signedTxXdr } = await walletKit.signTransaction(challenge);

            // 3. Submit signed challenge and get JWT
            statusEl.textContent = "Verifying...";
            const { jwt } = await verifyStellarChallenge(signedTxXdr);

            setToken(jwt);
            identify(publicKey);
            capture("console_login", { publicKey, wallet: option.id });
            navigate("/channels");
          } catch (error) {
            console.error("[login] auth error:", error);
            errorEl.textContent = error instanceof Error ? error.message : String(error) || "Authentication failed";
            errorEl.hidden = false;
            statusEl.hidden = true;
            capture("console_login_failed");
          } finally {
            btn.disabled = false;
          }
        },
      });
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Failed to open wallet";
      errorEl.hidden = false;
      statusEl.hidden = true;
      btn.disabled = false;
    }
  });

  return container;
}
