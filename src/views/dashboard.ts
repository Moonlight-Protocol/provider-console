import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { getCouncilMembership, getTreasury } from "../lib/api.ts";
import { navigate } from "../lib/router.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<div id="dash-loading" style="color:var(--text-muted);margin:2rem 0">Loading...</div><div id="dash-content" hidden></div>`;

  const loadingEl = el.querySelector("#dash-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#dash-content") as HTMLDivElement;

  const ppPublicKey = sessionStorage.getItem("selected_pp") || "";
  if (!ppPublicKey) {
    navigate("/home");
    return el;
  }
  Promise.all([getCouncilMembership(ppPublicKey), getTreasury()])
    .then(([membership, treasury]) => {
      loadingEl.hidden = true;
      contentEl.hidden = false;

      const xlm = treasury.balances.find((b) => b.asset_type === "native");
      const balance = xlm ? parseFloat(xlm.balance).toFixed(2) : "0.00";

      const config = membership?.config as {
        channels?: Array<{ assetCode: string }>;
        jurisdictions?: Array<{ countryCode: string; label: string | null }>;
      } | null;

      const assets = (config?.channels || []).map((ch) =>
        `<span class="badge badge-active" style="margin-right:0.25rem">${escapeHtml(ch.assetCode)}</span>`
      ).join("");

      const flags = (config?.jurisdictions || []).map((j) => {
        const flag = j.countryCode.toUpperCase().replace(/./g, (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
        return `<span title="${escapeHtml(j.label || j.countryCode)}" style="font-size:1.1rem">${flag}</span>`;
      }).join(" ");

      contentEl.innerHTML = `
        <h2 style="margin-bottom:1.5rem">Dashboard</h2>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;max-width:700px">
          <div class="stat-card active" style="padding:1.25rem">
            <span class="stat-label">Council</span>
            <span class="stat-value" style="font-size:1.1rem;margin:0.5rem 0">${escapeHtml(membership?.councilName || "Council")}</span>
            <div style="margin-top:0.25rem">${flags}</div>
            <div style="margin-top:0.5rem">${assets}</div>
          </div>

          <div class="stat-card active" style="padding:1.25rem">
            <span class="stat-label">Treasury</span>
            <span class="stat-value" style="margin:0.5rem 0">${escapeHtml(balance)} XLM</span>
            <span class="badge badge-active">Operational</span>
          </div>
        </div>

        <div style="margin-top:2rem;padding:1.25rem;background:rgba(34,197,94,0.08);border:1px solid var(--active);border-radius:8px">
          <p style="color:var(--active);font-weight:600;margin-bottom:0.25rem">Provider is active</p>
          <p style="font-size:0.85rem;color:var(--text-muted)">Your provider is configured and ready to process transactions.</p>
        </div>
      `;
    })
    .catch((err) => {
      loadingEl.hidden = true;
      contentEl.hidden = false;
      contentEl.innerHTML = `<p class="error-text">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
    });

  return el;
}

export const dashboardView = page(renderContent);
