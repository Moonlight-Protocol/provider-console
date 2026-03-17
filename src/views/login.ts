import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
  LOBSTR_ID,
  XBULL_ID,
} from "@creit.tech/stellar-wallets-kit";
import { requestChallenge, verifyChallenge, setToken, isAuthenticated } from "../lib/api.ts";
import { identify, capture } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";
import { ENVIRONMENT } from "../lib/config.ts";

let kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: ENVIRONMENT === "production" ? WalletNetwork.TESTNET : WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
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

      // 1. Open wallet modal and get address
      statusEl.textContent = "Connecting wallet...";
      statusEl.hidden = false;
      await walletKit.openModal({
        onWalletSelected: async (option) => {
          walletKit.setWallet(option.id);

          try {
            const { address: publicKey } = await walletKit.getAddress();

            statusEl.textContent = `Connected: ${publicKey.slice(0, 8)}...${publicKey.slice(-4)}`;

            // 2. Request challenge nonce
            statusEl.textContent = "Requesting challenge...";
            const { nonce } = await requestChallenge(publicKey);

            // 3. Sign nonce with wallet (SEP-53 signMessage)
            statusEl.textContent = "Please approve the signature in your wallet...";
            const { signedMessage } = await walletKit.signMessage(nonce, {
              address: publicKey,
            });

            // 4. Verify with server
            statusEl.textContent = "Verifying...";
            const { token } = await verifyChallenge(nonce, signedMessage, publicKey);

            setToken(token);
            identify(publicKey);
            capture("console_login", { publicKey, wallet: option.id });
            navigate("/channels");
          } catch (error) {
            errorEl.textContent = error instanceof Error ? error.message : "Authentication failed";
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
