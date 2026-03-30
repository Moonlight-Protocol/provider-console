import { clearPlatformAuth } from "../lib/api.ts";
import { clearSession } from "../lib/wallet.ts";
import { resetAnalytics } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";
import { escapeHtml } from "../lib/dom.ts";

declare const __APP_VERSION__: string;
const appVersion: string = escapeHtml(__APP_VERSION__);

export function renderNav(): HTMLElement {
  const nav = document.createElement("nav");
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="#/" class="nav-brand" style="text-decoration:none">Provider Console <span class="version-badge">v${appVersion}</span></a>
      <div class="nav-links">
        <a href="#/">Home</a>
        <button id="logout-btn" class="btn-link">Logout</button>
      </div>
    </div>
  `;

  nav.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearPlatformAuth();
    clearSession();
    resetAnalytics();
    navigate("/login");
  });

  return nav;
}
