import { Keypair } from "stellar-base";
import { requestChallenge, verifyChallenge, setToken, isAuthenticated } from "../lib/api.ts";
import { identify, capture } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";

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
      <p>Sign in with your Ed25519 key to manage your provider instance.</p>
      <div class="form-group">
        <label for="secret-key">Secret Key (S...)</label>
        <input type="password" id="secret-key" placeholder="S..." autocomplete="off" />
      </div>
      <button id="login-btn" class="btn-primary">Sign In</button>
      <p id="login-error" class="error-text" hidden></p>
      <p class="hint-text">Your secret key is used locally to sign the challenge. It is never sent to the server.</p>
    </div>
  `;

  const btn = container.querySelector("#login-btn") as HTMLButtonElement;
  const input = container.querySelector("#secret-key") as HTMLInputElement;
  const errorEl = container.querySelector("#login-error") as HTMLParagraphElement;

  btn.addEventListener("click", async () => {
    const secretKey = input.value.trim();
    if (!secretKey) return;

    btn.disabled = true;
    btn.textContent = "Signing...";
    errorEl.hidden = true;

    try {
      const keypair = Keypair.fromSecret(secretKey);
      const publicKey = keypair.publicKey();

      // 1. Request challenge
      const { nonce } = await requestChallenge(publicKey);

      // 2. Sign nonce
      const nonceBuffer = Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0));
      const sigBuffer = keypair.sign(nonceBuffer);
      const signature = btoa(String.fromCharCode(...sigBuffer));

      // 3. Verify and get token
      const { token } = await verifyChallenge(nonce, signature, publicKey);

      setToken(token);
      identify(publicKey);
      capture("console_login", { publicKey });
      navigate("/channels");
    } catch (error) {
      errorEl.textContent = error instanceof Error ? error.message : "Authentication failed";
      errorEl.hidden = false;
      capture("console_login_failed");
    } finally {
      // Clear sensitive data from input
      input.value = "";
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  });

  // Allow Enter key
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btn.click();
  });

  return container;
}
