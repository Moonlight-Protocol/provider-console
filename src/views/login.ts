import { isAuthenticated, authenticate, clearPlatformAuth } from "../lib/api.ts";
import { isWalletConnected, connectWallet, getConnectedAddress, clearSession } from "../lib/wallet.ts";
import { identify, capture } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";
import { escapeHtml } from "../lib/dom.ts";

export function loginView(): HTMLElement {
  if (isAuthenticated()) {
    navigate("/");
    return document.createElement("div");
  }

  const container = document.createElement("div");
  container.className = "login-container";

  const walletConnected = isWalletConnected();
  const address = getConnectedAddress();

  container.innerHTML = `
    <div class="login-card">
      <h1>Provider Console</h1>

      <div id="step-connect" ${walletConnected ? 'hidden' : ''}>
        <p>Connect your Stellar wallet to get started.</p>
        <button id="connect-btn" class="btn-primary btn-wide">Connect Wallet</button>
      </div>

      <div id="step-signin" ${walletConnected ? '' : 'hidden'}>
        <p>Connected as:</p>
        <p class="mono" style="font-size:0.8rem;word-break:break-all;margin-bottom:1rem;color:var(--text-muted)">${escapeHtml(address || "")}</p>
        <p>Sign a message to authenticate with the provider platform.</p>
        <button id="signin-btn" class="btn-primary btn-wide">Sign In</button>
        <button id="change-wallet-btn" class="btn-link" style="margin-top:0.75rem;display:block;text-align:center;width:100%;color:var(--text-muted)">Use a different wallet</button>
      </div>

      <p id="login-status" class="hint-text" hidden></p>
      <p id="login-error" class="error-text" hidden></p>
    </div>
  `;

  const connectStep = container.querySelector("#step-connect") as HTMLDivElement;
  const signinStep = container.querySelector("#step-signin") as HTMLDivElement;
  const statusEl = container.querySelector("#login-status") as HTMLParagraphElement;
  const errorEl = container.querySelector("#login-error") as HTMLParagraphElement;

  // Change wallet: clear session and go back to step 1
  container.querySelector("#change-wallet-btn")?.addEventListener("click", () => {
    clearSession();
    clearPlatformAuth();
    connectStep.hidden = false;
    signinStep.hidden = true;
    errorEl.hidden = true;
    (container.querySelector("#connect-btn") as HTMLButtonElement).disabled = false;
  });

  // Step 1: Connect Wallet
  container.querySelector("#connect-btn")?.addEventListener("click", async () => {
    const btn = container.querySelector("#connect-btn") as HTMLButtonElement;
    btn.disabled = true;
    errorEl.hidden = true;

    try {
      const publicKey = await connectWallet();
      identify(publicKey);

      // Show step 2 with the public key
      connectStep.hidden = true;
      signinStep.hidden = false;
      const addrEl = signinStep.querySelector(".mono") as HTMLElement;
      addrEl.textContent = publicKey;

      capture("provider_wallet_connected", { publicKey });
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Failed to connect wallet";
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });

  // Step 2: Sign In (platform auth)
  container.querySelector("#signin-btn")?.addEventListener("click", async () => {
    const btn = container.querySelector("#signin-btn") as HTMLButtonElement;
    btn.disabled = true;
    errorEl.hidden = true;
    statusEl.textContent = "Waiting for signature...";
    statusEl.hidden = false;

    try {
      await authenticate();
      capture("provider_login", { publicKey: getConnectedAddress() });
      navigate("/");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Authentication failed";
      errorEl.textContent = msg;
      errorEl.hidden = false;
      statusEl.hidden = true;
      btn.disabled = false;
    }
  });

  return container;
}
