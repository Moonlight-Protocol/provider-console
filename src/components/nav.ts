import { clearToken } from "../lib/api.ts";
import { resetAnalytics } from "../lib/analytics.ts";
import { navigate } from "../lib/router.ts";

declare const __APP_VERSION__: string;
const appVersion: string = __APP_VERSION__;

export function renderNav(): HTMLElement {
  const nav = document.createElement("nav");
  nav.innerHTML = `
    <div class="nav-inner">
      <span class="nav-brand">Provider Console <span class="version-badge">v${appVersion}</span></span>
      <div class="nav-links">
        <a href="#/channels">Channels</a>
        <a href="#/operations">Operations</a>
        <a href="#/mempool">Mempool</a>
        <a href="#/treasury">Treasury</a>
        <a href="#/audit">Audit Export</a>
        <a href="#/analytics">Analytics</a>
        <button id="logout-btn" class="btn-link">Logout</button>
      </div>
    </div>
  `;

  nav.querySelector("#logout-btn")?.addEventListener("click", () => {
    clearToken();
    resetAnalytics();
    navigate("/login");
  });

  return nav;
}
