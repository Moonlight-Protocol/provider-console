import { isAuthenticated, authenticate, clearPlatformAuth } from "../lib/api.ts";
import { isWalletConnected, connectWallet, getConnectedAddress, clearSession, initMasterSeed, isMasterSeedReady } from "../lib/wallet.ts";
import { identify, capture } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";
import { escapeHtml } from "../lib/dom.ts";
import { isAllowed, API_BASE_URL } from "../lib/config.ts";

export function loginView(): HTMLElement {
  const existingAddr = getConnectedAddress();
  if (isAuthenticated() && isMasterSeedReady() && (!existingAddr || isAllowed(existingAddr))) {
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
        <button id="signin-btn" class="btn-primary btn-wide">Sign In</button>
        <button id="change-wallet-btn" class="btn-link" style="margin-top:0.75rem;display:block;text-align:center;width:100%;color:var(--text-muted)">Use a different wallet</button>
      </div>

      <p id="login-error" class="error-text" style="text-align:center" hidden></p>
    </div>
  `;

  const connectStep = container.querySelector("#step-connect") as HTMLDivElement;
  const signinStep = container.querySelector("#step-signin") as HTMLDivElement;
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
    const originalText = btn.textContent;
    btn.disabled = true;
    errorEl.hidden = true;

    try {
      btn.textContent = "Setting up...";
      await initMasterSeed();
      // Freighter rejects consecutive signMessage calls without a delay between them.
      // initMasterSeed signs once, and authenticate() signs again immediately after.
      await new Promise(r => setTimeout(r, 1000));
      btn.textContent = "Authenticating...";
      await authenticate();
      capture("provider_login", { publicKey: getConnectedAddress() });

      const addr = getConnectedAddress();
      if (addr && !isAllowed(addr)) {
        renderInviteOnly(container, addr);
        return;
      }

      navigate("/");
    } catch (error) {
      let msg: string;
      if (error instanceof Error) {
        msg = error.message;
      } else if (typeof error === "object" && error !== null && "message" in error) {
        msg = String((error as { message: unknown }).message);
      } else {
        msg = error instanceof Error ? error.message : String(error);
      }
      errorEl.textContent = msg;
      errorEl.hidden = false;
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  return container;
}

function renderInviteOnly(container: HTMLElement, address: string): void {
  const truncated = address.length > 12
    ? `${address.slice(0, 6)}...${address.slice(-6)}`
    : address;

  container.innerHTML = `
    <div class="login-card" style="text-align:center">
      <img src="moonlight.png" alt="Moonlight" style="width:80px;margin:0 auto 1rem" />
      <h2 style="margin-bottom:0.5rem">This app is currently invite-only.</h2>
      <p class="mono" style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1.5rem">${escapeHtml(truncated)}</p>

      <form id="waitlist-form" style="display:flex;flex-direction:column;gap:0.75rem">
        <input
          type="email"
          id="waitlist-email"
          placeholder="your@email.com"
          required
          style="padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;font-size:0.9rem"
        />
        <button type="submit" class="btn-primary btn-wide">Join Waitlist</button>
      </form>

      <p id="waitlist-msg" style="margin-top:1rem;font-size:0.85rem" hidden></p>

      <a
        href="#"
        id="invite-disconnect"
        style="display:inline-block;margin-top:1.25rem;font-size:0.85rem;color:var(--text-muted)"
      >Disconnect</a>
    </div>
  `;

  const form = container.querySelector("#waitlist-form") as HTMLFormElement;
  const msgEl = container.querySelector("#waitlist-msg") as HTMLParagraphElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (container.querySelector("#waitlist-email") as HTMLInputElement).value.trim();
    if (!email) return;

    const btn = form.querySelector("button") as HTMLButtonElement;
    btn.disabled = true;
    msgEl.hidden = true;

    try {
      const res = await fetch(`${API_BASE_URL}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, walletPublicKey: address }),
      });
      if (!res.ok) throw new Error("Request failed");
      msgEl.style.color = "var(--success, #22c55e)";
      msgEl.textContent = "You're on the list!";
      msgEl.hidden = false;
      form.hidden = true;
    } catch {
      msgEl.style.color = "var(--error, #ef4444)";
      msgEl.textContent = "Something went wrong. Please try again.";
      msgEl.hidden = false;
      btn.disabled = false;
    }
  });

  container.querySelector("#invite-disconnect")?.addEventListener("click", (e) => {
    e.preventDefault();
    clearSession();
    clearPlatformAuth();
    navigate("/login");
  });
}
