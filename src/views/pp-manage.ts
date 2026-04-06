import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { navigate } from "../lib/router.ts";
import { getCouncilMembership, getTreasury, type CouncilMembership, type TreasuryData } from "../lib/api.ts";

function truncate(key: string): string {
  return key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
}

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  const ppPublicKey = sessionStorage.getItem("selected_pp");

  if (!ppPublicKey) {
    navigate("/home");
    return el;
  }

  el.innerHTML = `
    <a href="#/home" class="btn-link" style="margin-bottom:1rem;display:inline-block">&larr; All Providers</a>
    <h2 style="margin-bottom:0.25rem">Provider</h2>
    <p class="mono" style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1.5rem;word-break:break-all">${escapeHtml(ppPublicKey)}</p>
    <div id="pp-loading" style="color:var(--text-muted)">Loading...</div>
    <div id="pp-content" hidden></div>
  `;

  const loadingEl = el.querySelector("#pp-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#pp-content") as HTMLDivElement;

  Promise.allSettled([
    getCouncilMembership(ppPublicKey),
    getTreasury(),
  ]).then(([membershipResult, treasuryResult]) => {
    loadingEl.hidden = true;
    contentEl.hidden = false;

    const membership = membershipResult.status === "fulfilled" ? membershipResult.value : null;
    const treasury = treasuryResult.status === "fulfilled" ? treasuryResult.value : null;

    const xlm = treasury?.balances.find((b) => b.asset_type === "native");
    const balance = xlm ? parseFloat(xlm.balance).toFixed(2) : "0.00";
    const funded = xlm ? parseFloat(xlm.balance) > 0 : false;

    const config = membership?.config as {
      channels?: Array<{ assetCode: string }>;
    } | null;

    const assets = (config?.channels || []).map((ch) =>
      `<span class="badge badge-active" style="margin-right:0.25rem">${escapeHtml(ch.assetCode)}</span>`
    ).join("");

    contentEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;max-width:700px">
        <div class="stat-card ${funded ? "active" : ""}" style="padding:1.25rem">
          <span class="stat-label">Treasury</span>
          <span class="stat-value" style="margin:0.5rem 0">${escapeHtml(balance)} XLM</span>
          ${funded
            ? '<span class="badge badge-active">Funded</span>'
            : '<button id="fund-btn" class="btn-primary" style="margin-top:0.5rem">Fund Account</button>'
          }
        </div>

        ${membership
          ? `<div class="stat-card ${membership.status === "ACTIVE" ? "active" : "pending"}" style="padding:1.25rem">
              <span class="stat-label">Council</span>
              <span class="stat-value" style="font-size:1.1rem;margin:0.5rem 0">${escapeHtml(membership.councilName || "Council")}</span>
              <span class="badge badge-${membership.status === "ACTIVE" ? "active" : "pending"}">${escapeHtml(membership.status)}</span>
              ${assets ? `<div style="margin-top:0.5rem">${assets}</div>` : ""}
            </div>`
          : `<div class="stat-card" style="padding:1.25rem">
              <span class="stat-label">Council</span>
              <p style="color:var(--text-muted);font-size:0.85rem;margin:0.5rem 0">Not joined yet. Use the Join button on the providers list.</p>
            </div>`
        }
      </div>

      ${membership?.status === "ACTIVE" && funded ? `
        <div style="margin-top:2rem;padding:1.25rem;background:rgba(34,197,94,0.08);border:1px solid var(--active);border-radius:8px">
          <p style="color:var(--active);font-weight:600;margin-bottom:0.25rem">Provider is active</p>
          <p style="font-size:0.85rem;color:var(--text-muted)">This provider is configured and ready to process transactions.</p>
        </div>
      ` : ""}
    `;

    contentEl.querySelector("#fund-btn")?.addEventListener("click", () => navigate("/setup/fund"));
  });

  return el;
}

export const ppManageView = page(renderContent);
