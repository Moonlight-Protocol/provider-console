import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { navigate } from "../lib/router.ts";
import { getCouncilMembership, getTreasury } from "../lib/api.ts";

interface SetupState {
  council: { status: "none" | "pending" | "active"; name?: string };
  treasury: { status: "none" | "funded" | "loading"; balance?: string };
}

async function loadState(): Promise<SetupState> {
  const [membership, treasury] = await Promise.allSettled([
    getCouncilMembership(),
    getTreasury(),
  ]);

  const councilState: SetupState["council"] = { status: "none" };
  if (membership.status === "fulfilled" && membership.value) {
    if (membership.value.status === "ACTIVE") {
      councilState.status = "active";
      councilState.name = membership.value.councilName ?? undefined;
    } else if (membership.value.status === "PENDING") {
      councilState.status = "pending";
      councilState.name = membership.value.councilName ?? undefined;
    }
  }

  const treasuryState: SetupState["treasury"] = { status: "none" };
  if (treasury.status === "fulfilled" && treasury.value) {
    const xlm = treasury.value.balances.find(
      (b) => b.asset_type === "native",
    );
    const bal = xlm ? parseFloat(xlm.balance) : 0;
    treasuryState.status = bal > 0 ? "funded" : "none";
    treasuryState.balance = bal.toFixed(2);
  }

  return { council: councilState, treasury: treasuryState };
}

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<div id="home-loading" style="color:var(--text-muted);margin:2rem 0">Loading setup status...</div><div id="home-content" hidden></div>`;

  const loadingEl = el.querySelector("#home-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#home-content") as HTMLDivElement;

  loadState()
    .then((state) => {
      loadingEl.hidden = true;

      // If both are complete, show the dashboard
      if (state.council.status === "active" && state.treasury.status === "funded") {
        navigate("/dashboard");
        return;
      }

      contentEl.hidden = false;
      contentEl.innerHTML = `
        <h2 style="margin-bottom:0.5rem">Setup your provider</h2>
        <p style="color:var(--text-muted);margin-bottom:1.5rem">Complete both steps to start operating.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;max-width:700px">
          ${renderTreasuryCard(state.treasury)}
          ${renderCouncilCard(state.council)}
        </div>
      `;

      // Wire actions
      contentEl.querySelector("#fund-btn")?.addEventListener("click", () => navigate("/setup/fund"));
      contentEl.querySelector("#join-btn")?.addEventListener("click", () => navigate("/setup/join"));


    })
    .catch((err) => {
      loadingEl.hidden = true;
      contentEl.hidden = false;
      contentEl.innerHTML = `<p class="error-text">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
    });

  return el;
}

function renderTreasuryCard(state: SetupState["treasury"]): string {
  if (state.status === "funded") {
    return `
      <div class="stat-card active" style="padding:1.5rem">
        <span class="stat-label">Treasury</span>
        <span class="stat-value" style="font-size:1.2rem;margin:0.5rem 0">${escapeHtml(state.balance || "0")} XLM</span>
        <span class="badge badge-active">Ready to operate</span>
      </div>
    `;
  }

  return `
    <div class="stat-card" style="padding:1.5rem">
      <span class="stat-label">Treasury</span>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:0.5rem 0">Fund your provider's OpEx account to cover network fees.</p>
      <button id="fund-btn" class="btn-primary" style="margin-top:0.5rem">Fund Account</button>
    </div>
  `;
}

function renderCouncilCard(state: SetupState["council"]): string {
  if (state.status === "active") {
    return `
      <div class="stat-card active" style="padding:1.5rem">
        <span class="stat-label">Council</span>
        <span class="stat-value" style="font-size:1.2rem;margin:0.5rem 0">${escapeHtml(state.name || "Council")}</span>
        <span class="badge badge-active">Active</span>
      </div>
    `;
  }

  if (state.status === "pending") {
    return `
      <div class="stat-card pending" style="padding:1.5rem">
        <span class="stat-label">Council</span>
        <span class="stat-value" style="font-size:1.2rem;margin:0.5rem 0">${escapeHtml(state.name || "Council")}</span>
        <span class="badge badge-pending">Pending approval</span>
      </div>
    `;
  }

  return `
    <div class="stat-card" style="padding:1.5rem">
      <span class="stat-label">Council</span>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:0.5rem 0">Join a council to start processing transactions.</p>
      <button id="join-btn" class="btn-primary" style="margin-top:0.5rem">Join Council</button>
    </div>
  `;
}

export const homeView = page(renderContent);
